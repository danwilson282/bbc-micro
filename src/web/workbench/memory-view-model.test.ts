import { TestBus } from '../../memory/test-bus';
import { testBusTarget } from './debug-target';
import {
  BYTES_PER_ROW,
  buildMemoryView,
  parseHexAddress,
  parseHexByte,
  rowStart,
  stepPage,
  summariseWrites,
} from './memory-view-model';

function playground(): { bus: TestBus; target: ReturnType<typeof testBusTarget> } {
  const bus = new TestBus();
  return { bus, target: testBusTarget(bus) };
}

describe('testBusTarget', () => {
  it('peek returns the byte the bus holds', () => {
    const { bus, target } = playground();
    bus.write(0x7c00, 0x48);
    expect(target.peek(0x7c00)).toBe(0x48);
  });

  it('poke stores a byte the CPU would then read', () => {
    const { bus, target } = playground();
    target.poke(0x7c05, 0x21);
    expect(bus.read(0x7c05)).toBe(0x21);
  });

  it('peek and poke mask to 16 address lines and 8 data lines', () => {
    const { target } = playground();
    target.poke(0x17c20, 0x148);
    expect(target.peek(0x7c20)).toBe(0x48);
  });
});

describe('rowStart', () => {
  it('aligns an address down to the start of its 16-byte row', () => {
    expect(rowStart(0x7c1d)).toBe(0x7c10);
    expect(rowStart(0x7c10)).toBe(0x7c10);
    expect(rowStart(0xffff)).toBe(0xfff0);
  });
});

describe('stepPage', () => {
  it('moves forward and back by one page (&100 bytes)', () => {
    expect(stepPage(0x7c00, 1)).toBe(0x7d00);
    expect(stepPage(0x7c00, -1)).toBe(0x7b00);
  });

  it('wraps at the ends of the 64K address space', () => {
    expect(stepPage(0x0000, -1)).toBe(0xff00);
    expect(stepPage(0xff00, 1)).toBe(0x0000);
  });
});

describe('buildMemoryView', () => {
  it('shows the requested number of rows, 16 bytes each, from an aligned start', () => {
    const { target } = playground();
    const view = buildMemoryView(target, 0x7c1d, 16);
    expect(view.start).toBe(0x7c10);
    expect(view.rows).toHaveLength(16);
    expect(view.rows.map((r) => r.label).slice(0, 3)).toEqual(['7C10', '7C20', '7C30']);
    for (const row of view.rows) expect(row.cells).toHaveLength(BYTES_PER_ROW);
  });

  it('formats each cell as two hex digits and knows its address', () => {
    const { bus, target } = playground();
    bus.write(0x7c05, 0xa9);
    const cell = buildMemoryView(target, 0x7c00, 1).rows[0]?.cells[5];
    expect(cell).toEqual({ address: 0x7c05, value: 0xa9, hex: 'A9', changed: false, written: false, isPc: false });
  });

  it('marks the cell PC points at, and no other', () => {
    const { target } = playground();
    const view = buildMemoryView(target, 0x0400, 16, { pc: 0x0413 });
    const marked = view.rows.flatMap((r) => r.cells.filter((c) => c.isPc).map((c) => c.address));
    expect(marked).toEqual([0x0413]);
  });

  it('shows printable ASCII in the text column and "." for everything else', () => {
    const { bus, target } = playground();
    bus.load(0x7c00, Array.from('HELLO, BBC MICRO', (c) => c.charCodeAt(0)));
    bus.write(0x7c10, 0x0d); // carriage return: not printable
    const view = buildMemoryView(target, 0x7c00, 2);
    expect(view.rows[0]?.ascii).toBe('HELLO, BBC MICRO');
    expect(view.rows[1]?.ascii).toBe('.'.repeat(16));
  });

  it('wraps from row &FFF0 to row &0000, as the address bus does', () => {
    const { bus, target } = playground();
    bus.write(0x0000, 0x77);
    const view = buildMemoryView(target, 0xfff0, 2);
    expect(view.rows.map((r) => r.label)).toEqual(['FFF0', '0000']);
    expect(view.rows[1]?.cells[0]?.value).toBe(0x77);
  });

  it('marks only the bytes that differ from the previous view', () => {
    const { target } = playground();
    const before = buildMemoryView(target, 0x7c00, 16);
    target.poke(0x7c05, 0x21);
    target.poke(0x7cff, 0x01);
    const after = buildMemoryView(target, 0x7c00, 16, { previous: before });
    const changed = after.rows.flatMap((r) => r.cells.filter((c) => c.changed).map((c) => c.address));
    expect(changed).toEqual([0x7c05, 0x7cff]);
  });

  it('marks nothing as changed when the previous view started somewhere else', () => {
    const { target } = playground();
    const before = buildMemoryView(target, 0x7b00, 16);
    target.poke(0x7c05, 0x21);
    const after = buildMemoryView(target, 0x7c00, 16, { previous: before });
    expect(after.rows.some((r) => r.cells.some((c) => c.changed))).toBe(false);
  });

  it('marks the bytes the CPU wrote, whether or not their value changed', () => {
    const { bus, target } = playground();
    bus.write(0x7c04, 0x4f);
    const before = buildMemoryView(target, 0x7c00, 16);
    bus.write(0x7c28, 0x48); // a write that changes the byte
    bus.write(0x7c04, 0x4f); // a write of the value already there
    const after = buildMemoryView(target, 0x7c00, 16, { previous: before, written: new Set([0x7c28, 0x7c04]) });
    const cells = after.rows.flatMap((r) => r.cells);
    expect(cells.filter((c) => c.written).map((c) => c.address)).toEqual([0x7c04, 0x7c28]);
    expect(cells.filter((c) => c.changed).map((c) => c.address)).toEqual([0x7c28]);
  });

  it('reads memory through peek only, never through the side-effecting bus read', () => {
    const peeked: number[] = [];
    const target = {
      name: 'spy',
      peek: (address: number): number => {
        peeked.push(address);
        return 0;
      },
      poke: (): void => undefined,
    };
    buildMemoryView(target, 0xfe40, 1);
    expect(peeked).toEqual(Array.from({ length: 16 }, (_, i) => 0xfe40 + i));
  });
});

describe('summariseWrites', () => {
  it('lists each write as "&address ← &value", oldest first', () => {
    const records = [
      { address: 0x7c28, value: 0x48 },
      { address: 0x0070, value: 0x00 },
    ];
    expect(summariseWrites(records, 2)).toEqual({
      items: [
        { address: 0x7c28, text: '&7C28 ← &48' },
        { address: 0x0070, text: '&0070 ← &00' },
      ],
      more: 0,
    });
  });

  it('says how many more writes there were than the recorder kept', () => {
    expect(summariseWrites([{ address: 0x3000, value: 0x01 }], 5).more).toBe(4);
  });

  it('is empty when nothing was written', () => {
    expect(summariseWrites([], 0)).toEqual({ items: [], more: 0 });
  });
});

describe('parseHexByte', () => {
  it.each([
    ['48', 0x48],
    ['&48', 0x48],
    ['$48', 0x48],
    ['0x48', 0x48],
    ['ff', 0xff],
    ['7', 0x07],
    ['  &a9 ', 0xa9],
  ])('accepts %p as &%s', (text, expected) => {
    expect(parseHexByte(text)).toBe(expected);
  });

  it.each(['', '&', '0x', 'G1', '123', '&100', '-1', '4 8', '1.5'])(
    'rejects %p instead of masking it into a byte',
    (text) => {
      expect(parseHexByte(text)).toBeUndefined();
    },
  );
});

describe('parseHexAddress', () => {
  it.each([
    ['7C00', 0x7c00],
    ['&FE40', 0xfe40],
    ['$fffc', 0xfffc],
    ['0x0', 0x0000],
    ['d9cd', 0xd9cd],
  ])('accepts %p as a 16-bit address', (text, expected) => {
    expect(parseHexAddress(text)).toBe(expected);
  });

  it.each(['', '&', '10000', 'XYZ', '&-1'])('rejects %p', (text) => {
    expect(parseHexAddress(text)).toBeUndefined();
  });
});
