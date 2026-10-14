import {
  TELETEXT,
  type TeletextCell,
  createTeletextCell,
  createTeletextState,
  decodeCell,
  decodeRow,
  mosaicLine,
  startRow,
  teletextCellText,
} from './teletext-attributes';

/** Decodes a row given as bytes and strings, and returns a copy of each cell. */
function row(...parts: readonly (number | string)[]): TeletextCell[] {
  const bytes: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') bytes.push(part);
    else for (const ch of part) bytes.push(ch.charCodeAt(0));
  }
  return decodeRow(bytes);
}

/** "fg/bg kind" for each cell, compact enough to compare a whole row at once. */
function summary(cells: readonly TeletextCell[]): string[] {
  return cells.map((c) => `${String(c.foreground)}/${String(c.background)} ${c.kind}`);
}

/** A mosaic's 10 lines as '#'/'.' pictures of its 6 dots. */
function mosaicPicture(code: number, separated: boolean): string[] {
  return Array.from({ length: 10 }, (_, line) =>
    mosaicLine(code, separated, line).toString(2).padStart(6, '0').replace(/0/g, '.').replace(/1/g, '#'),
  );
}

describe('teletext control codes (SAA5050 Table 1)', () => {
  test('the colour codes carry the colour number in their bottom 3 bits: bit 0 red, bit 1 green, bit 2 blue', () => {
    expect(TELETEXT.ALPHA_RED).toBe(0x01);
    expect(TELETEXT.ALPHA_YELLOW).toBe(0x03); // red + green
    expect(TELETEXT.ALPHA_CYAN).toBe(0x06); // green + blue
    expect(TELETEXT.GRAPHICS_RED).toBe(0x11);
    expect(TELETEXT.GRAPHICS_WHITE & 7).toBe(7);
    expect(TELETEXT.NEW_BACKGROUND).toBe(0x1d);
    expect(TELETEXT.HOLD_GRAPHICS).toBe(0x1e);
  });
});

describe('the row starts with Table 1\'s "presumed" attributes', () => {
  test('white text on black, in text mode, contiguous, not holding', () => {
    const state = createTeletextState();
    state.foreground = 1;
    state.background = 4;
    state.graphics = true;
    state.separated = true;
    state.hold = true;
    state.heldCode = 0x7f;
    startRow(state);
    expect(state).toEqual({ foreground: 7, background: 0, graphics: false, separated: false, hold: false, heldCode: 0x20, heldSeparated: false });
  });

  test('plain text is white letters on black', () => {
    expect(summary(row('Hi'))).toEqual(['7/0 letter', '7/0 letter']);
  });
});

describe('alphanumeric colours are set-after', () => {
  test('&81 (alpha red) is a black space itself; the cells after it are red', () => {
    const cells = row(0x81, 'AB');
    expect(summary(cells)).toEqual(['7/0 blank', '1/0 letter', '1/0 letter']);
  });

  test('bit 7 is ignored: &01 and &81 are the same code', () => {
    expect(summary(row(0x01, 'A'))).toEqual(summary(row(0x81, 'A')));
  });

  test('a later colour code changes the colour again, from the cell after it', () => {
    expect(summary(row(0x81, 'A', 0x86, 'B'))).toEqual(['7/0 blank', '1/0 letter', '1/0 blank', '6/0 letter']);
  });

  test('&80 and &90 (NUL, DLE: no black on the SAA5050) only take up a cell', () => {
    expect(summary(row(0x81, 0x80, 'A', 0x90, 'B'))).toEqual(['7/0 blank', '1/0 blank', '1/0 letter', '1/0 blank', '1/0 letter']);
  });
});

describe('backgrounds are set-at', () => {
  test('&81 &9D: New Background copies the foreground (red), and the &9D cell is already red', () => {
    const cells = row(0x81, 0x9d, 0x87, 'Hi');
    expect(summary(cells)).toEqual(['7/0 blank', '1/1 blank', '1/1 blank', '7/1 letter', '7/1 letter']);
  });

  test('&9C (Black Background) turns it black again in its own cell', () => {
    const cells = row(0x84, 0x9d, 'A', 0x9c, 'B');
    expect(summary(cells)).toEqual(['7/0 blank', '4/4 blank', '4/4 letter', '4/0 blank', '4/0 letter']);
  });

  test('the worked example from the stage doc: &81 &9D &87 H i &9C &84 B B C', () => {
    const cells = row(0x81, 0x9d, 0x87, 'Hi', 0x9c, 0x84, 'BBC');
    expect(cells.map((c) => c.foreground)).toEqual([7, 1, 1, 7, 7, 7, 7, 4, 4, 4]);
    expect(cells.map((c) => c.background)).toEqual([0, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  test('backgrounds work in graphics mode too', () => {
    expect(summary(row(0x92, 0x9d, 0x96, 0xff))).toEqual(['7/0 blank', '2/2 blank', '2/2 blank', '6/2 mosaic']);
  });
});

describe('graphics mode', () => {
  test('&91 switches to red graphics from the next cell: &FF is then a mosaic, not the 5 × 7 block', () => {
    const cells = row(0x91, 0xff);
    expect(summary(cells)).toEqual(['7/0 blank', '1/0 mosaic']);
    expect(cells[1]?.code).toBe(0x7f);
  });

  test('codes &40-&5F blast through as capital letters, in the graphics colour', () => {
    const cells = row(0x92, 'A_@', 0xc1);
    expect(summary(cells)).toEqual(['7/0 blank', '2/0 letter', '2/0 letter', '2/0 letter', '2/0 letter']);
  });

  test('&20-&3F and &60-&7F are mosaics, including &20 (a graphics space)', () => {
    const cells = row(0x97, 0x20, 0x3f, 0x60, 0x7f, 'a');
    expect(cells.slice(1).map((c) => c.kind)).toEqual(['mosaic', 'mosaic', 'mosaic', 'mosaic', 'mosaic']);
  });

  test('an alpha colour code leaves graphics mode, from the next cell', () => {
    const cells = row(0x91, 0xe1, 0x83, 0xe1);
    expect(summary(cells)).toEqual(['7/0 blank', '1/0 mosaic', '1/0 blank', '3/0 letter']);
  });

  test('&9A (separated) is set-at, &99 (contiguous) is set-at, and each mosaic says which it is', () => {
    const cells = row(0x97, 0xff, 0x9a, 0xff, 0x99, 0xff);
    expect(cells.filter((c) => c.kind === 'mosaic').map((c) => c.separated)).toEqual([false, true, false]);
  });
});

describe('hold graphics', () => {
  test('without hold, a colour change leaves a gap in a graphics bar', () => {
    expect(row(0x91, 0xff, 0xff, 0x93, 0xff).map((c) => c.kind)).toEqual(['blank', 'mosaic', 'mosaic', 'blank', 'mosaic']);
  });

  test('with hold (&9E, set-at), the control cell repeats the last mosaic in the old colour (&93 is set-after)', () => {
    const cells = row(0x91, 0x9e, 0xff, 0xff, 0x93, 0xff);
    expect(summary(cells)).toEqual(['7/0 blank', '1/0 blank', '1/0 mosaic', '1/0 mosaic', '1/0 mosaic', '3/0 mosaic']);
    expect(cells[4]?.code).toBe(0x7f);
  });

  test('the held mosaic is the last one drawn, not the first', () => {
    const cells = row(0x97, 0x9e, 0xa1, 0xe3, 0x80);
    expect(cells[4]?.code).toBe(0x63);
  });

  test('&9F (release) is set-after: its own cell still shows the held mosaic', () => {
    const cells = row(0x97, 0x9e, 0xff, 0x9f, 0x80);
    expect(cells.slice(2).map((c) => c.kind)).toEqual(['mosaic', 'mosaic', 'blank']);
  });

  test('blast-through capitals are not mosaics, so they are never held', () => {
    const cells = row(0x97, 0x9e, 0xa1, 'A', 0x80);
    expect(cells[4]?.code).toBe(0x21);
  });

  test('switching to text clears the held mosaic: a later hold shows a space', () => {
    const cells = row(0x97, 0xff, 0x87, 'A', 0x97, 0x9e, 0x80);
    expect(cells.slice(4).map((c) => c.kind)).toEqual(['blank', 'blank', 'blank']);
  });

  test('a graphics colour change in graphics mode does not clear it', () => {
    const cells = row(0x91, 0xff, 0x92, 0x9e);
    expect(cells[3]?.kind).toBe('mosaic');
  });

  test('a held mosaic keeps the separated setting it was drawn with', () => {
    const cells = row(0x97, 0x9e, 0x9a, 0xff, 0x99, 0x80);
    expect(cells[5]?.kind).toBe('mosaic');
    expect(cells[5]?.separated).toBe(true);
  });

  test('every row starts again: nothing is held or coloured from the row before', () => {
    const state = createTeletextState();
    const cell = createTeletextCell();
    for (const byte of [0x91, 0x9d, 0x9e, 0xff]) decodeCell(state, byte, cell);
    startRow(state);
    decodeCell(state, 0x80, cell);
    expect(cell).toMatchObject({ kind: 'blank', foreground: 7, background: 0 });
  });
});

describe('Stage 33 codes are recognised but change nothing yet', () => {
  test.each([
    ['flash', 0x88],
    ['steady', 0x89],
    ['normal height', 0x8c],
    ['double height', 0x8d],
    ['conceal', 0x98],
  ])('%s (&%s) is a blank cell', (_name, code) => {
    expect(summary(row(0x81, code, 'A'))).toEqual(['7/0 blank', '1/0 blank', '1/0 letter']);
  });
});

describe('mosaicLine: Fig. 9\'s 2 × 3 blocks on the 6 × 10 cell', () => {
  test('&7F contiguous fills every dot of every line', () => {
    expect(mosaicPicture(0x7f, false)).toEqual(Array<string>(10).fill('######'));
  });

  test('the blocks are 3 dots wide and 3, 4 and 3 lines high: bits 0/1 top, 2/3 middle, 4/6 bottom', () => {
    expect(mosaicPicture(0x21, false)).toEqual(['###...', '###...', '###...', ...Array<string>(7).fill('......')]); // bit 0: top-left
    expect(mosaicPicture(0x22, false).slice(0, 3)).toEqual(['...###', '...###', '...###']); // bit 1: top-right
    expect(mosaicPicture(0x24, false).slice(3, 7)).toEqual(Array<string>(4).fill('###...')); // bit 2: middle-left
    expect(mosaicPicture(0x28, false).slice(3, 7)).toEqual(Array<string>(4).fill('...###')); // bit 3: middle-right
    expect(mosaicPicture(0x30, false).slice(7)).toEqual(Array<string>(3).fill('###...')); // bit 4: bottom-left
    expect(mosaicPicture(0x60, false).slice(7)).toEqual(Array<string>(3).fill('...###')); // bit 6: bottom-right
  });

  test('bit 5 lights nothing: it is what makes the code a mosaic', () => {
    expect(mosaicPicture(0x20, false)).toEqual(Array<string>(10).fill('......'));
  });

  test("Fig. 10's example 0110111 (&37) lights top-left, top-right, middle-left and bottom-left", () => {
    expect(mosaicPicture(0x37, false)).toEqual([
      '######', '######', '######',
      '###...', '###...', '###...', '###...',
      '###...', '###...', '###...',
    ]);
  });

  test('separated: each block loses its left dot and its bottom line (Fig. 10)', () => {
    expect(mosaicPicture(0x7f, true)).toEqual([
      '.##.##', '.##.##', '......',
      '.##.##', '.##.##', '.##.##', '......',
      '.##.##', '.##.##', '......',
    ]);
  });

  test('bit 7 is ignored', () => {
    for (let line = 0; line < 10; line++) expect(mosaicLine(0xb5, true, line)).toBe(mosaicLine(0x35, true, line));
  });
});

describe('teletextCellText: what the text layer shows', () => {
  test('letters are the SAA5050 characters, blanks are spaces', () => {
    expect(row(0x81, 'A#').map(teletextCellText).join('')).toBe(' A£');
  });

  test('mosaics are Unicode block sextants, with the 4 that Unicode already had elsewhere', () => {
    const text = row(0x97, 0x20, 0x21, 0x22, 0x35, 0x6a, 0x7f, 0x3e).map(teletextCellText);
    // &20 empty, &21 sextant-1, &22 sextant-2, &35 left column, &6A right column, &7F full, &3E sextant-2345
    expect(text).toEqual([' ', ' ', '\u{1FB00}', '\u{1FB01}', '▌', '▐', '█', '\u{1FB1C}']);
  });

  test('all 64 mosaics have different text', () => {
    const codes = [...Array.from({ length: 32 }, (_, i) => 0x20 + i), ...Array.from({ length: 32 }, (_, i) => 0x60 + i)];
    const text = new Set(row(0x97, ...codes).slice(1).map(teletextCellText));
    expect(text.size).toBe(64);
  });
});
