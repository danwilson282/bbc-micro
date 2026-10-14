import {
  TELETEXT,
  type TeletextCell,
  createTeletextCell,
  createTeletextState,
  decodeCell,
  decodeRow,
  decodeRows,
  mosaicLine,
  startRow,
  teletextCellText,
  teletextFlashVisible,
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
    state.flash = true;
    state.conceal = true;
    state.doubleHeight = true;
    startRow(state);
    expect(state).toEqual({
      foreground: 7,
      background: 0,
      graphics: false,
      separated: false,
      hold: false,
      heldCode: 0x20,
      heldSeparated: false,
      flash: false,
      conceal: false,
      doubleHeight: false,
      doubleHeightSeen: false,
      bottomRow: false,
    });
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

/** Bytes and strings as a row's bytes, padded to nothing: decodeRows doesn't need 40. */
function bytesOf(...parts: readonly (number | string)[]): number[] {
  return parts.flatMap((part) => (typeof part === 'number' ? [part] : Array.from({ length: part.length }, (_, i) => part.charCodeAt(i))));
}

describe('flash (&88, set-after) and steady (&89, set-at)', () => {
  test('&88 marks the cells after it as flashing, but not its own cell', () => {
    const cells = row(0x88, 'AB', 0x89, 'C');
    expect(cells.map((c) => c.flash)).toEqual([false, true, true, false, false]);
    expect(cells.map((c) => c.kind)).toEqual(['blank', 'letter', 'letter', 'blank', 'letter']);
  });

  test('mosaics flash too', () => {
    const cells = row(0x92, 0x88, 0xff);
    expect(cells[2]).toMatchObject({ kind: 'mosaic', flash: true });
  });

  test('a held mosaic in a control cell flashes along with the rest', () => {
    const cells = row(0x92, 0x88, 0x9e, 0xff, 0x80);
    expect(cells[4]).toMatchObject({ kind: 'mosaic', flash: true });
  });

  test('a colour change does not stop the flash', () => {
    expect(row(0x88, 'A', 0x81, 'B')[3]?.flash).toBe(true);
  });

  test('the flash phase: shown for 48 fields, hidden for 16, then round again', () => {
    expect(teletextFlashVisible(0)).toBe(true);
    expect(teletextFlashVisible(47)).toBe(true);
    expect(teletextFlashVisible(48)).toBe(false);
    expect(teletextFlashVisible(63)).toBe(false);
    expect(teletextFlashVisible(64)).toBe(true);
    const shown = Array.from({ length: 64 }, (_, field) => teletextFlashVisible(field)).filter(Boolean).length;
    expect(shown).toBe(48); // 3:1 on to off
  });
});

describe('conceal (&98, set-at)', () => {
  test('hides letters from its own cell on, keeping the background', () => {
    const cells = row(0x81, 0x9d, 0x87, 'A', 0x98, 'BC');
    expect(summary(cells)).toEqual(['7/0 blank', '1/1 blank', '1/1 blank', '7/1 letter', '7/1 blank', '7/1 blank', '7/1 blank']);
  });

  test('an alpha colour code ends it, from the cell after the code (set-after)', () => {
    expect(row(0x98, 'A', 0x83, 'B').map((c) => c.kind)).toEqual(['blank', 'blank', 'blank', 'letter']);
  });

  test('a graphics colour code ends it too', () => {
    expect(row(0x91, 0x98, 0xff, 0x92, 0xff).map((c) => c.kind)).toEqual(['blank', 'blank', 'blank', 'blank', 'mosaic']);
  });

  test('a concealed mosaic still becomes the held mosaic: concealing hides it, it is still drawn into the state', () => {
    const cells = row(0x91, 0x9e, 0x98, 0xe1, 0x92, 0x80);
    expect(cells[3]?.kind).toBe('blank');
    expect(cells[5]).toMatchObject({ kind: 'mosaic', code: 0x61 });
  });
});

describe('double height (&8D, set-after) and normal height (&8C, set-at)', () => {
  test('&8D makes the cells after it the top halves of double-height characters', () => {
    const cells = row('A', 0x8d, 'B', 0x8c, 'C');
    expect(cells.map((c) => c.height)).toEqual(['normal', 'normal', 'top', 'normal', 'normal']);
  });

  test('mosaics are double height too', () => {
    expect(row(0x97, 0x8d, 0xff)[2]).toMatchObject({ kind: 'mosaic', height: 'top' });
  });

  test('a change of height clears the held mosaic (ETS 300 706 §12.2)', () => {
    // &8D is set-after, so its own cell still holds the normal-height block; the &92 after it shows a space.
    const cells = row(0x91, 0x9e, 0xff, 0x8d, 0x92, 0xff);
    expect(cells.map((c) => c.kind)).toEqual(['blank', 'blank', 'mosaic', 'mosaic', 'blank', 'mosaic']);
    expect(cells[3]?.height).toBe('normal');
  });

  test('so does going back to normal height', () => {
    const cells = row(0x91, 0x8d, 0x9e, 0xff, 0x8c);
    expect(cells[4]?.kind).toBe('blank');
  });

  test('&8D in a row that is already double height changes nothing', () => {
    expect(row(0x91, 0x8d, 0x9e, 0xff, 0x8d)[4]?.kind).toBe('mosaic');
  });
});

describe('row pairs: the row after a double-height row is a bottom row', () => {
  test('a bottom row draws the bottom halves of its own double-height characters', () => {
    const [top, bottom] = decodeRows([bytesOf(0x8d, 'Hi'), bytesOf(0x8d, 'Hi')]);
    expect(top.map((c) => c.height)).toEqual(['normal', 'top', 'top']);
    expect(bottom.map((c) => c.height)).toEqual(['normal', 'bottom', 'bottom']);
    expect(bottom.map((c) => c.kind)).toEqual(['blank', 'letter', 'letter']);
  });

  test('the bottom row draws its own bytes: a different word gives a mismatched pair', () => {
    const [, bottom] = decodeRows([bytesOf(0x8d, 'Hi'), bytesOf(0x8d, 'Yo')]);
    expect(bottom[1]?.code).toBe(0x59);
  });

  test('normal-height characters on a bottom row are not drawn, but their background is', () => {
    const [, bottom] = decodeRows([bytesOf(0x8d, 'X'), bytesOf(0x81, 0x9d, 'A', 0x8d, 'B')]);
    expect(summary(bottom)).toEqual(['7/0 blank', '1/1 blank', '1/1 blank', '1/1 blank', '1/1 letter']);
  });

  test('mosaics follow the same rule', () => {
    const [, bottom] = decodeRows([bytesOf(0x8d), bytesOf(0x97, 0xff, 0x8d, 0xff)]);
    expect(bottom.map((c) => c.kind)).toEqual(['blank', 'blank', 'blank', 'mosaic']); // the normal-height &FF is hidden; the &8D cell is a space
  });

  test('a bottom row never makes the next row a bottom row, even with &8D in it', () => {
    const rows = decodeRows([bytesOf(0x8d, 'A'), bytesOf(0x8d, 'A'), bytesOf(0x8d, 'B'), bytesOf(0x8d, 'B')]);
    expect(rows.map((cells) => cells[1]?.height)).toEqual(['top', 'bottom', 'top', 'bottom']);
  });

  test('without an &8D, the next row is a normal row', () => {
    const rows = decodeRows([bytesOf('A'), bytesOf('B'), bytesOf(0x8d, 'C'), bytesOf('D'), bytesOf('E')]);
    expect(rows.map((cells) => cells.find((c) => c.kind === 'letter')?.height ?? 'none')).toEqual(['normal', 'normal', 'top', 'none', 'normal']);
  });

  test('an &8D at the very end of a row still counts', () => {
    const [, bottom] = decodeRows([bytesOf('A', 0x8d), bytesOf('B')]);
    expect(bottom[0]?.kind).toBe('blank');
  });

  test('a fresh state is the top of a page: nothing is a bottom row', () => {
    const state = createTeletextState();
    const cell = createTeletextCell();
    decodeCell(state, 0x8d, cell);
    const fresh = createTeletextState();
    expect(fresh.bottomRow).toBe(false);
    startRow(state);
    expect(state.bottomRow).toBe(true);
  });
});

describe('codes with no effect on a BBC', () => {
  test.each([
    ['NUL', 0x80],
    ['end box', 0x8a],
    ['start box', 0x8b],
    ['SO', 0x8e],
    ['SI', 0x8f],
    ['DLE', 0x90],
    ['ESC', 0x9b],
  ])('%s (&%s) is a blank cell and changes nothing', (_name, code) => {
    expect(summary(row(0x81, code, 'A'))).toEqual(['7/0 blank', '1/0 blank', '1/0 letter']);
    expect(row(0x81, code, 'A')[2]).toMatchObject({ height: 'normal', flash: false });
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
