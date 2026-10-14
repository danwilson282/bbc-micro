import { MODE7_PIXEL_HEIGHT, MODE7_PIXEL_WIDTH, COLOUR_BLACK, COLOUR_WHITE, renderMode7 } from './mode7-renderer';
import { MODE7_SCREEN_START } from './mode7-text';
import { glyphPicture } from './saa5050-font';
import { roundedGlyphLine } from './character-rounding';

/** A 64K memory with the 1,000 screen bytes from &7C00 set to spaces. */
function blankScreen(): Uint8Array {
  const memory = new Uint8Array(0x10000);
  memory.fill(0x20, 0x7c00, 0x8000);
  return memory;
}

function render(memory: Uint8Array, start = MODE7_SCREEN_START, flashVisible = true): Uint8Array {
  const pixels = new Uint8Array(MODE7_PIXEL_WIDTH * MODE7_PIXEL_HEIGHT);
  renderMode7((address) => memory[address] ?? 0, start, pixels, flashVisible);
  return pixels;
}

function pixel(pixels: Uint8Array, x: number, y: number): number {
  return pixels[y * MODE7_PIXEL_WIDTH + x] ?? -1;
}

/** One cell (12 × 20 pixels) read back as dots: one character per 2 × 2 square, '#' white, '.' black. */
function cellPicture(pixels: Uint8Array, row: number, column: number): string[] {
  const lines: string[] = [];
  for (let line = 0; line < 10; line++) {
    let text = '';
    for (let dot = 0; dot < 6; dot++) text += pixel(pixels, column * 12 + dot * 2, row * 20 + line * 2) === COLOUR_WHITE ? '#' : '.';
    lines.push(text);
  }
  return lines;
}

/**
 * One cell's dots as colour numbers ('0'-'7'), read from the first field's
 * (even) pixel rows. Checks each dot's two half-dots match, and, unless the
 * cell holds a letter (whose second-field rows are rounded), that the
 * second field's row matches too.
 */
function cellColours(pixels: Uint8Array, row: number, column: number, letter = false): string[] {
  const lines: string[] = [];
  for (let line = 0; line < 10; line++) {
    let text = '';
    for (let dot = 0; dot < 6; dot++) {
      const x = column * 12 + dot * 2;
      const y = row * 20 + line * 2;
      const colour = pixel(pixels, x, y);
      for (const [dx, dy] of letter ? ([[1, 0]] as const) : ([[1, 0], [0, 1], [1, 1]] as const)) expect(pixel(pixels, x + dx, y + dy)).toBe(colour);
      text += String(colour);
    }
    lines.push(text);
  }
  return lines;
}

/** One cell (12 × 20 pixels) as '#' (colour) and '.' (anything else), one character per pixel. */
function cellPixels(pixels: Uint8Array, row: number, column: number, colour = COLOUR_WHITE): string[] {
  const lines: string[] = [];
  for (let y = 0; y < 20; y++) {
    let text = '';
    for (let x = 0; x < 12; x++) text += pixel(pixels, column * 12 + x, row * 20 + y) === colour ? '#' : '.';
    lines.push(text);
  }
  return lines;
}

/** A character's rounded half-lines from..from+count as pictures, each repeated times times: what a cell should show. */
function expectedPixels(code: number, from: number, times: number): string[] {
  const lines: string[] = [];
  for (let h = from; h < from + 20 / times; h++) {
    const picture = roundedGlyphLine(code, h).toString(2).padStart(12, '0').replace(/0/g, '.').replace(/1/g, '#');
    for (let i = 0; i < times; i++) lines.push(picture);
  }
  return lines;
}

/** Puts bytes and strings into screen memory from row, column. */
function put(memory: Uint8Array, row: number, column: number, ...parts: readonly (number | string)[]): void {
  let address = 0x7c00 + row * 40 + column;
  for (const part of parts) {
    if (typeof part === 'number') memory[address++] = part;
    else for (const ch of part) memory[address++] = ch.charCodeAt(0);
  }
}

describe('renderMode7: screen memory to SAA5050 dots', () => {
  test('the screen is 480 × 500 pixels: 40 cells of 12, 25 rows of 20', () => {
    expect(MODE7_PIXEL_WIDTH).toBe(40 * 12);
    expect(MODE7_PIXEL_HEIGHT).toBe(25 * 20);
  });

  test('a screen of spaces is all black (colour 0)', () => {
    const pixels = render(blankScreen());
    expect(pixels.every((p) => p === COLOUR_BLACK)).toBe(true);
  });

  test("an A in the top-left cell draws the font's dots, with a blank column 0 and line 0", () => {
    const memory = blankScreen();
    memory[0x7c00] = 0x41;
    const dots = cellPicture(render(memory), 0, 0);
    // Column 0 and line 0 are the gap; the 5 × 9 matrix fills columns 1-5, lines 1-9.
    expect(dots[0]).toBe('......');
    expect(dots.slice(1).map((line) => line[0])).toEqual(Array<string>(9).fill('.'));
    expect(dots.slice(1).map((line) => line.slice(1))).toEqual(glyphPicture(0x41));
  });

  test("each dot is a 2 × 2 square: the A's top dot (line 0, dot 2) covers x 6-7, y 2-3", () => {
    const memory = blankScreen();
    memory[0x7c00] = 0x41;
    const pixels = render(memory);
    for (const [x, y] of [[6, 2], [7, 2], [6, 3], [7, 3]] as const) expect(pixel(pixels, x, y)).toBe(COLOUR_WHITE);
    for (const [x, y] of [[5, 2], [8, 2], [6, 1], [6, 4]] as const) expect(pixel(pixels, x, y)).toBe(COLOUR_BLACK);
  });

  test('cell (row r, column c) is drawn at x = c × 12, y = r × 20: the last cell is at 468, 480', () => {
    const memory = blankScreen();
    memory[0x7c00 + 24 * 40 + 39] = 0x7f; // the 5 × 7 block, bottom-right cell
    const pixels = render(memory);
    expect(cellPicture(pixels, 24, 39)).toEqual([
      '......',
      '.#####', '.#####', '.#####', '.#####', '.#####', '.#####', '.#####',
      '......', '......',
    ]);
    expect(pixel(pixels, 468 + 2, 480 + 2)).toBe(COLOUR_WHITE);
    expect(pixel(pixels, 466, 482)).toBe(COLOUR_BLACK);
  });

  test('bit 7 is ignored: &C1 draws the same dots as &41', () => {
    const a = blankScreen();
    a[0x7c05] = 0x41;
    const b = blankScreen();
    b[0x7c05] = 0xc1;
    expect(render(b)).toEqual(render(a));
  });

  test('a control code is a blank cell in the background colour', () => {
    const memory = blankScreen();
    memory[0x7c00] = 0x81;
    memory[0x7c01] = 0x0d;
    expect(render(memory).every((p) => p === COLOUR_BLACK)).toBe(true);
  });

  test('&23 draws a £, not a #', () => {
    const memory = blankScreen();
    memory[0x7c00] = 0x23;
    expect(cellPicture(render(memory), 0, 0).slice(1).map((line) => line.slice(1))).toEqual(glyphPicture(0x23));
    expect(glyphPicture(0x23)[0]).toBe('..##.');
  });

  test('it follows the CRTC start address and wraps inside &7C00-&7FFF after a scroll', () => {
    const memory = blankScreen();
    // After one scroll the screen starts at &7C28; the last row's cells wrap round to &7C00.
    memory[0x7c28] = 0x41; // now the top-left cell
    memory[0x7c00] = 0x42; // no longer the top-left: see below
    const pixels = render(memory, 0x7c28);
    expect(cellPicture(pixels, 0, 0).slice(1).map((l) => l.slice(1))).toEqual(glyphPicture(0x41));
    // &7C28 + 984 = &8000, which wraps to &7C00: row 24, column 24.
    expect(cellPicture(pixels, 24, 24).slice(1).map((l) => l.slice(1))).toEqual(glyphPicture(0x42));
  });

  test('it redraws every pixel: a cell that changes back to a space goes black again', () => {
    const memory = blankScreen();
    memory[0x7c00] = 0x7f;
    const pixels = new Uint8Array(MODE7_PIXEL_WIDTH * MODE7_PIXEL_HEIGHT);
    renderMode7((address) => memory[address] ?? 0, MODE7_SCREEN_START, pixels, true);
    memory[0x7c00] = 0x20;
    renderMode7((address) => memory[address] ?? 0, MODE7_SCREEN_START, pixels, true);
    expect(pixels.every((p) => p === COLOUR_BLACK)).toBe(true);
  });
});

describe('renderMode7: colours and graphics (Stage 32)', () => {
  test('&81 A: the A is drawn in red (1) on black, and the control cell is all black', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x81, 'A');
    const pixels = render(memory);
    expect(cellColours(pixels, 0, 0)).toEqual(Array<string>(10).fill('000000'));
    const a = cellColours(pixels, 0, 1, true);
    expect(a[1]).toBe('000100'); // the A's top dot, in red
    expect(a.join('').replace(/[01]/g, '')).toBe('');
  });

  test('&84 &9D: the background (gap column and gap line included) is blue from the &9D cell', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x84, 0x9d, 0x87, 'I');
    const pixels = render(memory);
    expect(cellColours(pixels, 0, 0)).toEqual(Array<string>(10).fill('000000'));
    expect(cellColours(pixels, 0, 1)).toEqual(Array<string>(10).fill('444444'));
    expect(cellColours(pixels, 0, 2)).toEqual(Array<string>(10).fill('444444'));
    const i = cellColours(pixels, 0, 3, true);
    expect(i[0]).toBe('444444'); // the gap line is background
    expect(i[1]).toBe('447774'); // I's top bar, white on blue
    // The rest of the row stays blue: the background lasts to the end of the row...
    expect(cellColours(pixels, 0, 39)).toEqual(Array<string>(10).fill('444444'));
    // ...and no further.
    expect(cellColours(pixels, 1, 0)).toEqual(Array<string>(10).fill('000000'));
  });

  test('&92 &FF: a solid green mosaic fills the whole 6 × 10 cell, gap column and line included', () => {
    const memory = blankScreen();
    put(memory, 3, 5, 0x92, 0xff);
    expect(cellColours(render(memory), 3, 6)).toEqual(Array<string>(10).fill('222222'));
  });

  test('separated &FF: green blocks with black gaps on the left and bottom of each', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x92, 0x9a, 0xff);
    expect(cellColours(render(memory), 0, 2)).toEqual([
      '022022', '022022', '000000',
      '022022', '022022', '022022', '000000',
      '022022', '022022', '000000',
    ]);
  });

  test('separated gaps show the background colour, not black', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x94, 0x9d, 0x93, 0x9a, 0xb5);
    // &B5 = left column; blue background, yellow blocks.
    expect(cellColours(render(memory), 0, 4)).toEqual([
      '433444', '433444', '444444',
      '433444', '433444', '433444', '444444',
      '433444', '433444', '444444',
    ]);
  });

  test('two mosaics side by side join up with no gap between them', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x97, 0xff, 0xff);
    const pixels = render(memory);
    for (let x = 12; x < 36; x++) expect(pixel(pixels, x, 0)).toBe(COLOUR_WHITE);
  });

  test('a blast-through capital in graphics mode is a letter in the graphics colour', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x96, 'A');
    expect(cellColours(render(memory), 0, 1, true)[1]).toBe('000600');
  });

  test('hold graphics: the &93 cell repeats the red block, so the bar has no gap', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x91, 0x9e, 0xff, 0x93, 0xff);
    const pixels = render(memory);
    expect(cellColours(pixels, 0, 2)).toEqual(Array<string>(10).fill('111111'));
    expect(cellColours(pixels, 0, 3)).toEqual(Array<string>(10).fill('111111'));
    expect(cellColours(pixels, 0, 4)).toEqual(Array<string>(10).fill('333333'));
  });
});

describe('renderMode7: character rounding (Stage 33)', () => {
  test('a letter is the rounded font: even pixel rows are field 1, odd rows field 2 with half-dots on diagonals', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 'A');
    const cell = cellPixels(render(memory), 0, 0);
    expect(cell).toEqual(expectedPixels(0x41, 0, 1));
    expect(cell[2]).toBe('......##....'); // A's top dot
    expect(cell[3]).toBe('.....####...'); // and a half-dot either side, towards the next line's two dots
  });

  test('mosaics are never rounded: a diagonal pair of blocks stays square', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x97, 0xa9); // &29: top-left and middle-right
    const cell = cellPixels(render(memory), 0, 1);
    expect(cell[5]).toBe('######......'); // the last line of the top-left block, second field
    expect(cell[6]).toBe('......######');
  });
});

describe('renderMode7: double height (Stage 33)', () => {
  test('&8D A on two rows: the top row shows the top half of A twice as tall, the bottom row the bottom half', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x8d, 'A');
    put(memory, 1, 0, 0x8d, 'A');
    const pixels = render(memory);
    expect(cellPixels(pixels, 0, 1)).toEqual(expectedPixels(0x41, 0, 2));
    expect(cellPixels(pixels, 1, 1)).toEqual(expectedPixels(0x41, 10, 2));
    // The &8D cells themselves are spaces.
    expect(cellPixels(pixels, 0, 0).join('')).not.toContain('#');
  });

  test('the bottom row draws its own bytes: top of A over bottom of B', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x8d, 'A');
    put(memory, 1, 0, 0x8d, 'B');
    expect(cellPixels(render(memory), 1, 1)).toEqual(expectedPixels(0x42, 10, 2));
  });

  test('normal-height text on the bottom row is not drawn, but its background is', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x8d, 'A');
    put(memory, 1, 0, 0x84, 0x9d, 0x87, 'Hi');
    const pixels = render(memory);
    expect(cellColours(pixels, 1, 3)).toEqual(Array<string>(10).fill('444444'));
    expect(cellColours(pixels, 1, 4)).toEqual(Array<string>(10).fill('444444'));
  });

  test('a separated double-height mosaic: every line, gaps included, is 4 pixel rows tall', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x97, 0x9a, 0x8d, 0xff);
    put(memory, 1, 0, 0x97, 0x9a, 0x8d, 0xff);
    const pixels = render(memory);
    const top = cellPixels(pixels, 0, 3);
    const block = '..####..####';
    // Mosaic lines 0-4 on the top row: 0, 1 lit; 2 the top block's gap; 3, 4 lit.
    expect(top).toEqual([...Array<string>(8).fill(block), ...Array<string>(4).fill('............'), ...Array<string>(8).fill(block)]);
    // Lines 5-9 on the bottom row: 5 lit; 6 the middle block's gap; 7, 8 lit; 9 the bottom block's gap.
    const bottom = cellPixels(pixels, 1, 3);
    expect(bottom).toEqual([
      ...Array<string>(4).fill(block),
      ...Array<string>(4).fill('............'),
      ...Array<string>(8).fill(block),
      ...Array<string>(4).fill('............'),
    ]);
  });
});

describe('renderMode7: flash and conceal (Stage 33)', () => {
  /** &81 &9D &87 &88 A: a flashing white A on red, at row 0 column 4. */
  function flashingA(): Uint8Array {
    const memory = blankScreen();
    put(memory, 0, 0, 0x81, 0x9d, 0x87, 0x88, 'A', 0x89, 'B');
    return memory;
  }

  test('in the flash\'s on phase a flashing letter is drawn', () => {
    expect(cellColours(render(flashingA(), MODE7_SCREEN_START, true), 0, 4, true)[1]).toBe('111711');
  });

  test('in the off phase it is a space: the background stays, the dots go', () => {
    const pixels = render(flashingA(), MODE7_SCREEN_START, false);
    expect(cellColours(pixels, 0, 4)).toEqual(Array<string>(10).fill('111111'));
    // &89 (steady) is set-at: the B after it doesn't flash.
    expect(cellColours(pixels, 0, 6, true)[1]).toBe('177771');
  });

  test('flashing mosaics disappear in the off phase too', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x92, 0x88, 0xff);
    expect(cellColours(render(memory, MODE7_SCREEN_START, false), 0, 2)).toEqual(Array<string>(10).fill('000000'));
    expect(cellColours(render(memory, MODE7_SCREEN_START, true), 0, 2)).toEqual(Array<string>(10).fill('222222'));
  });

  test('concealed text is never drawn, in either phase', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x98, 'A', 0x87, 'B');
    for (const phase of [true, false]) {
      const pixels = render(memory, MODE7_SCREEN_START, phase);
      expect(cellPixels(pixels, 0, 1).join('')).not.toContain('#');
      expect(cellPixels(pixels, 0, 3).join('')).toContain('#');
    }
  });
});
