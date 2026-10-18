import { MODE7_COLUMNS, MODE7_ROWS, MODE7_SCREEN_START, mode7CellAddress, mode7StartAddress, mode7Text } from './mode7-text';

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

  it('shows the SAA5050\'s characters, not ASCII: &23 is "£", &5F is "#" and &7F is a block (Stage 31)', () => {
    const mem = memory();
    mem[0x7c00] = 0x23;
    mem[0x7c01] = 0x5f;
    mem[0x7c02] = 0x7f;
    expect(mode7Text((a) => mem[a] ?? 0)[0]?.slice(0, 3)).toBe('£#■');
  });

  it('in graphics mode &7F is a full block of sixels, not the 5 × 7 block, and blast-through capitals stay letters (Stage 32)', () => {
    const mem = memory();
    mem[0x7c00] = 0x97; // graphics white
    mem[0x7c01] = 0x7f;
    mem[0x7c02] = 0x41;
    mem[0x7c03] = 0x21; // top-left sixel
    expect(mode7Text((a) => mem[a] ?? 0)[0]?.slice(0, 5)).toBe(' █A\u{1FB00}'); // 5: the sextant is 2 UTF-16 units
    // Each row starts in text mode again.
    mem[0x7c28] = 0x7f;
    expect(mode7Text((a) => mem[a] ?? 0)[1]?.[0]).toBe('■');
  });

  it('double height (Stage 33): both rows of a pair show the text; normal text on the bottom row is hidden, as on screen', () => {
    const mem = memory();
    mem.fill(0x20, 0x7c00, 0x8000);
    mem[0x7c00] = 0x8d;
    put(mem, 0x7c01, 'Hi');
    put(mem, 0x7c28, 'ab');
    mem[0x7c2a] = 0x8d;
    put(mem, 0x7c2b, 'Hi');
    const rows = mode7Text((a) => mem[a] ?? 0);
    expect(rows[0]?.slice(0, 3)).toBe(' Hi');
    expect(rows[1]?.slice(0, 5)).toBe('   Hi'); // 'ab' is normal height on a bottom row
  });

  it('flashing text is always shown in the text (it is in memory); concealed text is not (Stage 33)', () => {
    const mem = memory();
    mem[0x7c00] = 0x88;
    put(mem, 0x7c01, 'Flash');
    mem[0x7c06] = 0x98;
    put(mem, 0x7c07, '42');
    expect(mode7Text((a) => mem[a] ?? 0)[0]?.slice(0, 9)).toBe(' Flash   ');
  });

  it('starts wherever it is told, and wraps inside &7C00-&7FFF: after the last byte comes &7C00', () => {
    const mem = memory();
    put(mem, 0x7db8, 'TOP');
    mem[0x7fff] = 0x59; // Y: the last byte of the 1K
    mem[0x7c00] = 0x5a; // Z: the byte after it, once wrapped
    const rows = mode7Text((a) => mem[a] ?? 0, 0x7db8);
    expect(rows[0]?.slice(0, 3)).toBe('TOP');
    // &7FFF is &247 = 583 cells after &7DB8: row 14, column 23. &7C00 is the next cell.
    expect(rows[14]?.slice(23, 25)).toBe('YZ');
  });

  it('never reads outside &7C00-&7FFF, wherever the screen starts', () => {
    const seen: number[] = [];
    mode7Text((a) => {
      seen.push(a);
      return 0x20;
    }, 0x7ff0);
    expect(Math.min(...seen)).toBe(0x7c00);
    expect(Math.max(...seen)).toBe(0x7fff);
  });
});

describe('MODE 7 address translation: CRTC start address (R12/R13) to RAM', () => {
  it('the MOS boot value R12/R13 = &28/&00 means &7C00 (AUG: (&7C00 - &7400) EOR &2000 = &2800)', () => {
    expect(mode7StartAddress(0x28, 0x00)).toBe(0x7c00);
  });

  it('after 30 line feeds the real MOS left R12/R13 = &29/&B8: &7C00 + (&29B8 AND &3FF) = &7DB8, as its &350/&351 said', () => {
    expect(mode7StartAddress(0x29, 0xb8)).toBe(0x7db8);
  });

  it('MA10 and MA12 change nothing; MA11 is A14 (Stage 39)', () => {
    expect(mode7StartAddress(0x3c, 0x00)).toBe(0x7c00);
    expect(mode7StartAddress(0x2b, 0xff)).toBe(0x7fff);
    expect(mode7StartAddress(0x20, 0x00)).toBe(0x3c00);
  });

  it('cell n is n bytes on from the start, wrapping every 1,024 bytes (not 1,000)', () => {
    expect(mode7CellAddress(0x7c00, 0)).toBe(0x7c00);
    expect(mode7CellAddress(0x7c00, 999)).toBe(0x7fe7);
    expect(mode7CellAddress(0x7db8, 583)).toBe(0x7fff);
    expect(mode7CellAddress(0x7db8, 584)).toBe(0x7c00);
    expect(mode7CellAddress(0x7fe8, 24)).toBe(0x7c00);
  });

  it('a screen in the other 1K (&3C00, MA11 = 0) wraps inside &3C00-&3FFF', () => {
    expect(mode7CellAddress(0x3fe8, 24)).toBe(0x3c00);
  });
});
