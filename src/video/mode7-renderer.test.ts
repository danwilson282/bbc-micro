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

  test('control codes (&81 red, &0D) draw as blank cells until Stage 32', () => {
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
