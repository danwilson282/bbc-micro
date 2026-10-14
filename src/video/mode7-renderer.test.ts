import { MODE7_PIXEL_HEIGHT, MODE7_PIXEL_WIDTH, COLOUR_BLACK, COLOUR_WHITE, renderMode7 } from './mode7-renderer';
import { MODE7_SCREEN_START } from './mode7-text';
import { glyphPicture } from './saa5050-font';

/** A 64K memory with the 1,000 screen bytes from &7C00 set to spaces. */
function blankScreen(): Uint8Array {
  const memory = new Uint8Array(0x10000);
  memory.fill(0x20, 0x7c00, 0x8000);
  return memory;
}

function render(memory: Uint8Array, start = MODE7_SCREEN_START): Uint8Array {
  const pixels = new Uint8Array(MODE7_PIXEL_WIDTH * MODE7_PIXEL_HEIGHT);
  renderMode7((address) => memory[address] ?? 0, start, pixels);
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

/** One cell's dots as colour numbers ('0'-'7'), checking each 2 × 2 square is one colour. */
function cellColours(pixels: Uint8Array, row: number, column: number): string[] {
  const lines: string[] = [];
  for (let line = 0; line < 10; line++) {
    let text = '';
    for (let dot = 0; dot < 6; dot++) {
      const x = column * 12 + dot * 2;
      const y = row * 20 + line * 2;
      const colour = pixel(pixels, x, y);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]] as const) expect(pixel(pixels, x + dx, y + dy)).toBe(colour);
      text += String(colour);
    }
    lines.push(text);
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
    renderMode7((address) => memory[address] ?? 0, MODE7_SCREEN_START, pixels);
    memory[0x7c00] = 0x20;
    renderMode7((address) => memory[address] ?? 0, MODE7_SCREEN_START, pixels);
    expect(pixels.every((p) => p === COLOUR_BLACK)).toBe(true);
  });
});

describe('renderMode7: colours and graphics (Stage 32)', () => {
  test('&81 A: the A is drawn in red (1) on black, and the control cell is all black', () => {
    const memory = blankScreen();
    put(memory, 0, 0, 0x81, 'A');
    const pixels = render(memory);
    expect(cellColours(pixels, 0, 0)).toEqual(Array<string>(10).fill('000000'));
    const a = cellColours(pixels, 0, 1);
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
    const i = cellColours(pixels, 0, 3);
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
    expect(cellColours(render(memory), 0, 1)[1]).toBe('000600');
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
