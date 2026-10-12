import { GLYPH_COLUMNS, GLYPH_ROWS, glyphRow, glyphPicture, teletextCharacter } from './saa5050-font';

const ALL_DOTS = (1 << GLYPH_COLUMNS) - 1; // &1F

function rowsOf(code: number): number[] {
  return Array.from({ length: GLYPH_ROWS }, (_, line) => glyphRow(code, line));
}

describe('SAA5050 character ROM (datasheet Fig. 11, English set)', () => {
  test('every printable character is a 5 × 9 matrix: no line has a bit above bit 4', () => {
    for (let code = 0x20; code < 0x80; code++) {
      for (const row of rowsOf(code)) expect(row & ~ALL_DOTS).toBe(0);
    }
  });

  test('every printable character except space has at least one dot', () => {
    for (let code = 0x21; code < 0x80; code++) {
      expect(rowsOf(code).some((row) => row !== 0)).toBe(true);
    }
    expect(rowsOf(0x20).every((row) => row === 0)).toBe(true);
  });

  test('the control codes &00-&1F have no shape: they display as spaces', () => {
    for (let code = 0x00; code < 0x20; code++) {
      expect(rowsOf(code).every((row) => row === 0)).toBe(true);
    }
  });

  test('A (&41) is the 7-line capital from Fig. 11 4/1, bit 4 the leftmost dot', () => {
    expect(rowsOf(0x41)).toEqual([0x04, 0x0a, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x00, 0x00]);
  });

  test('bit 7 of the code is not wired to the SAA5050: &C1 is the same A as &41', () => {
    expect(rowsOf(0xc1)).toEqual(rowsOf(0x41));
    expect(rowsOf(0x81)).toEqual(rowsOf(0x01));
  });

  test('capitals and digits are 7 lines high: lines 0 and 6 used, 7 and 8 empty', () => {
    const codes = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', (c) => c.charCodeAt(0));
    for (const code of codes) {
      const rows = rowsOf(code);
      expect(rows[0]).not.toBe(0);
      expect(rows[6]).not.toBe(0);
      expect(rows[7]).toBe(0);
      expect(rows[8]).toBe(0);
    }
  });

  test('only g j p q y, the comma, the semicolon, ½, ¼ and ¾ reach below the baseline (lines 7-8)', () => {
    const below: string[] = [];
    for (let code = 0x20; code < 0x80; code++) {
      const rows = rowsOf(code);
      if (rows[7] !== 0 || rows[8] !== 0) below.push(teletextCharacter(code));
    }
    expect(below.sort()).toEqual([',', ';', '½', '¼', '¾', 'g', 'j', 'p', 'q', 'y'].sort());
  });

  test('descenders reach the last matrix line: g ends with a tail on line 8', () => {
    expect(glyphPicture(0x67)).toEqual(['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.']);
  });

  test('&23 is a pound sign and &5F is the hash: a British teletext chip', () => {
    expect(glyphPicture(0x23)).toEqual(['..##.', '.#..#', '.#...', '###..', '.#...', '.#...', '#####', '.....', '.....']);
    expect(glyphPicture(0x5f)).toEqual(['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.', '.....', '.....']);
  });

  test('&7F is a solid 5 × 7 block, not a whole cell', () => {
    expect(rowsOf(0x7f)).toEqual([0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x1f, 0x00, 0x00]);
  });

  test('&2D minus is a 3-dot bar and &60 is a full-width long dash on the same line', () => {
    expect(glyphRow(0x2d, 3)).toBe(0x0e);
    expect(glyphRow(0x60, 3)).toBe(0x1f);
  });

  test('symmetrical characters are mirror images of themselves (a check on the transcription)', () => {
    const mirror = (row: number): number => {
      let out = 0;
      for (let bit = 0; bit < GLYPH_COLUMNS; bit++) if (row & (1 << bit)) out |= 1 << (GLYPH_COLUMNS - 1 - bit);
      return out;
    };
    for (const c of 'AHIMOTUVWXYovwx08!"*+-=^|') {
      const code = c === '^' ? 0x5e : c === '|' ? 0x7c : c.charCodeAt(0);
      expect(rowsOf(code).map(mirror)).toEqual(rowsOf(code));
    }
  });
});

describe('teletextCharacter: what a code shows, as Unicode', () => {
  test('most codes are plain ASCII', () => {
    expect(teletextCharacter(0x41)).toBe('A');
    expect(teletextCharacter(0x61)).toBe('a');
    expect(teletextCharacter(0x3e)).toBe('>');
  });

  test('the English set swaps 12 codes (datasheet Table 1)', () => {
    const swapped = [0x23, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f].map(teletextCharacter).join('');
    expect(swapped).toBe('£←½→↑#―¼‖¾÷■');
  });

  test('control codes and bit 7 follow the chip: &81 is a control code (space), &C1 is A', () => {
    expect(teletextCharacter(0x81)).toBe(' ');
    expect(teletextCharacter(0x0d)).toBe(' ');
    expect(teletextCharacter(0xc1)).toBe('A');
  });
});
