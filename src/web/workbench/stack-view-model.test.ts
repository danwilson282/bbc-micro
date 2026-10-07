import { TestBus } from '../../memory/test-bus';
import { playgroundTarget } from './debug-target';
import { STACK_FREE_ROWS, STACK_MAX_ROWS, buildStackView, type StackByte, type StackRow } from './stack-view-model';

/** A playground target with S set and some bytes in page 1. */
function playground(s: number, bytes: Readonly<Record<number, number>> = {}): ReturnType<typeof playgroundTarget> {
  const bus = new TestBus();
  for (const [address, value] of Object.entries(bytes)) bus.write(Number(address), value);
  const target = playgroundTarget(bus);
  target.cpu.regs.s = s;
  return target;
}

function bytesOf(rows: readonly StackRow[]): StackByte[] {
  return rows.filter((row): row is StackByte => row.kind === 'byte');
}

function addresses(rows: readonly StackRow[]): (number | string)[] {
  return rows.map((row) => (row.kind === 'byte' ? row.address : 'gap'));
}

describe('the stack summary', () => {
  it('says the stack is empty when S = &FF, and where the next push goes', () => {
    const view = buildStackView(playground(0xff));
    expect(view.depth).toBe(0);
    expect(view.summary).toBe('S = &FF · empty · next push → &01FF');
  });

  it('counts &FF − S bytes in use, and says where the next push and pull go', () => {
    const view = buildStackView(playground(0xfc));
    expect(view.depth).toBe(3);
    expect(view.summary).toBe('S = &FC · 3 bytes in use · next push → &01FC · next pull ← &01FD');
  });

  it('says "1 byte" for one', () => {
    expect(buildStackView(playground(0xfe)).summary).toBe('S = &FE · 1 byte in use · next push → &01FE · next pull ← &01FF');
  });
});

describe('the RTS hint', () => {
  it('reads the next two pulls as a return address and adds 1, the way RTS does', () => {
    const view = buildStackView(playground(0xfd, { 0x01fe: 0x09, 0x01ff: 0x04 }));
    expect(view.rts).toBe('RTS now → &040A (pulls 09 04, + 1)');
  });

  it('uses the two bytes nearest S when calls are nested', () => {
    const view = buildStackView(playground(0xfb, { 0x01fc: 0x26, 0x01fd: 0x04, 0x01fe: 0x12, 0x01ff: 0x04 }));
    expect(view.rts).toBe('RTS now → &0427 (pulls 26 04, + 1)');
  });

  it('wraps &FFFF + 1 to &0000', () => {
    expect(buildStackView(playground(0xfd, { 0x01fe: 0xff, 0x01ff: 0xff })).rts).toBe('RTS now → &0000 (pulls FF FF, + 1)');
  });

  it('is absent with fewer than two bytes in use', () => {
    expect(buildStackView(playground(0xff)).rts).toBeUndefined();
    expect(buildStackView(playground(0xfe)).rts).toBeUndefined();
  });
});

describe('the stack rows', () => {
  it('run from &01FF down to three free slots below S, bottom of the stack first', () => {
    const view = buildStackView(playground(0xfc));
    expect(addresses(view.rows)).toEqual([0x01ff, 0x01fe, 0x01fd, 0x01fc, 0x01fb, 0x01fa, 0x01f9]);
    expect(STACK_FREE_ROWS).toBe(3);
  });

  it('mark bytes above S as used, S as the next push, the byte above S as the next pull, and the rest as free', () => {
    const rows = bytesOf(buildStackView(playground(0xfc)).rows);
    expect(rows.map((r) => r.slot)).toEqual(['used', 'used', 'used', 'next-push', 'free', 'free', 'free']);
    expect(rows.map((r) => r.isTop)).toEqual([false, false, true, false, false, false, false]);
  });

  it('show each byte in hex and binary, read through peek', () => {
    const rows = bytesOf(buildStackView(playground(0xfe, { 0x01ff: 0x3d })).rows);
    expect(rows[0]).toMatchObject({ address: 0x01ff, label: '01FF', value: 0x3d, hex: '3D', binary: '%0011 1101' });
  });

  it('stop at &0100 when S is near the bottom of page 1', () => {
    const rows = bytesOf(buildStackView(playground(0x01)).rows);
    expect(rows.at(-1)?.address).toBe(0x0100);
    expect(rows.at(-2)).toMatchObject({ address: 0x0101, slot: 'next-push' });
  });

  it('elide the middle of a deep stack, keeping &01FF and the area round S', () => {
    const view = buildStackView(playground(0x40));
    expect(view.rows.length).toBe(STACK_MAX_ROWS);
    expect(addresses(view.rows).slice(0, 5)).toEqual([0x01ff, 0x01fe, 0x01fd, 0x01fc, 'gap']);
    expect(addresses(view.rows).slice(-4)).toEqual([0x0140, 0x013f, 0x013e, 0x013d]);
    const gap = view.rows[4];
    // &01FF..&013D is 195 rows; 19 are shown
    expect(gap).toEqual({ kind: 'gap', count: 195 - 19, text: '⋮ 176 more' });
  });

  it('show the whole stack when it fits, with no gap', () => {
    const view = buildStackView(playground(0xff - (STACK_MAX_ROWS - STACK_FREE_ROWS - 1)));
    expect(view.rows).toHaveLength(STACK_MAX_ROWS);
    expect(view.rows.every((row) => row.kind === 'byte')).toBe(true);
  });
});

describe('the changed and written marks', () => {
  it('mark bytes that differ from the previous view', () => {
    const target = playground(0xff);
    const before = buildStackView(target);
    target.cpu.push(0x11);
    const after = bytesOf(buildStackView(target, { previous: before }).rows);
    expect(after.filter((r) => r.changed).map((r) => r.address)).toEqual([0x01ff]);
  });

  it('mark a byte the CPU wrote even if the value did not change', () => {
    const rows = bytesOf(buildStackView(playground(0xfe), { written: new Set([0x01ff]) }).rows);
    expect(rows[0]).toMatchObject({ address: 0x01ff, written: true, changed: false });
    expect(rows[1]?.written).toBe(false);
  });
});
