import { MODE7_COLUMNS, MODE7_ROWS, MODE7_SCREEN_START, mode7Text } from './mode7-text';

/** A 64K array as memory, for peek. */
function memory(): Uint8Array {
  return new Uint8Array(0x10000);
}

function put(mem: Uint8Array, address: number, text: string): void {
  for (let i = 0; i < text.length; i++) mem[address + i] = text.charCodeAt(i);
}

describe('mode7Text: MODE 7 screen memory read as text', () => {
  it('the screen is 40 × 25 bytes = 1,000, from &7C00 to &7FE7', () => {
    expect(MODE7_SCREEN_START).toBe(0x7c00);
    expect(MODE7_COLUMNS * MODE7_ROWS).toBe(1000);
  });

  it('gives 25 rows of exactly 40 characters', () => {
    const rows = mode7Text((a) => memory()[a] ?? 0);
    expect(rows).toHaveLength(25);
    for (const row of rows) expect(row).toHaveLength(40);
  });

  it('row r, column c is the byte at &7C00 + r × 40 + c: "B" at &7C28 starts row 1', () => {
    const mem = memory();
    put(mem, 0x7c28, 'BBC Computer 32K');
    const rows = mode7Text((a) => mem[a] ?? 0);
    expect(rows[1]).toBe('BBC Computer 32K'.padEnd(40));
  });

  it('the last cell, row 24 column 39, is &7FE7', () => {
    const mem = memory();
    mem[0x7fe7] = 0x5a; // Z
    expect(mode7Text((a) => mem[a] ?? 0)[24]?.at(-1)).toBe('Z');
  });

  it('control codes (&00-&1F and &80-&9F) show as spaces, as they do on screen', () => {
    const mem = memory();
    mem[0x7c00] = 0x81; // alphanumeric red
    mem[0x7c01] = 0x41;
    mem[0x7c02] = 0x0d;
    mem[0x7c03] = 0x42;
    expect(mode7Text((a) => mem[a] ?? 0)[0]?.slice(0, 4)).toBe(' A B');
  });

  it('bit 7 is ignored for printable codes: &C1 shows as "A" (the SAA5050 only sees 7 bits)', () => {
    const mem = memory();
    mem[0x7c00] = 0xc1;
    expect(mode7Text((a) => mem[a] ?? 0)[0]?.[0]).toBe('A');
  });

  it('&7F (a solid block on a teletext screen) shows as a space here; Stage 31 draws it', () => {
    const mem = memory();
    mem[0x7c00] = 0x7f;
    expect(mode7Text((a) => mem[a] ?? 0)[0]?.[0]).toBe(' ');
  });

  it('can read from another start address', () => {
    const mem = memory();
    put(mem, 0x3000, 'HELLO');
    expect(mode7Text((a) => mem[a] ?? 0, 0x3000)[0]?.trimEnd()).toBe('HELLO');
  });

  it('addresses wrap at &FFFF instead of going past it', () => {
    const seen: number[] = [];
    mode7Text((a) => {
      seen.push(a);
      return 0x20;
    }, 0xff00);
    expect(Math.max(...seen)).toBeLessThanOrEqual(0xffff);
  });
});
