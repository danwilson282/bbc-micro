// MODE 7 as pixels: what the SAA5050 teletext chip puts on the screen,
// worked out from screen memory. Pure: memory in, colour numbers out. The
// browser side (src/web/screen-canvas.ts) puts them on the canvas.
//
// Each character cell is 6 dots × 10 lines (data sheet Fig. 10). The 5 × 9
// font fills dots 1-5 of lines 1-9. Dot 0 and line 0 are background: the gap
// between characters. (Which column is the gap is our reading of the timing
// table: alphanumerics come out 2.767 µs after their code, graphics 2.6 µs,
// one 6 MHz dot later. Which line is the gap is from Fig. 10's drawing.)
//
// One dot is 2 × 2 of our pixels:
//   2 across: half-dots, for character rounding.
//   2 down:   MODE 7 is interlaced. The second field's 10 lines per row fall
//             between the first field's: our odd pixel rows.
// So a cell is 12 × 20 pixels and the screen is 40 × 12 = 480 by 25 × 20 = 500.
//
// Stage 33: letters are drawn from the rounded font (character-rounding.ts),
// whose odd half-lines add half-dots on diagonals. A double-height cell
// draws half of the character's 20 half-lines, each 2 pixel rows tall: the
// top 10 on a top row, the bottom 10 on a bottom row. Flashing cells are
// spaces in the flash's off phase.
//
// Colours and mosaic graphics (Stage 32) come from the control codes along
// each row: teletext-attributes.ts decodes each cell into a foreground, a
// background, and a letter, a mosaic or a blank. Here we just draw it. A
// letter fills dots 1-5 of lines 1-9; a mosaic fills the whole cell, which
// is how blocks join up into pictures.
//
// Which bytes (Stage 39): the ones the 6845's address counter reads. The
// field starts at the start address the CRTC latched (not R12/R13 as they
// are now), each row starts R1 characters after the last, and the board
// turns each MA into a RAM address (screen-address.ts). Cells past R1 or R6
// are black: display enable is off there. The cursor cell (R14/R15) has its
// R10-R11 pixel rows inverted, as the Video ULA does with CUDISP; one cell
// wide until Stage 40 reads the ULA's cursor-width bits.

import {
  CRTC_R1_HORIZONTAL_DISPLAYED,
  CRTC_R8_CURSOR_SKEW_OFF, CRTC_R6_VERTICAL_DISPLAYED, CRTC_R8_INTERLACE_AND_SKEW, CRTC_R10_CURSOR_START, CRTC_R11_CURSOR_END, cursorBlinkOn } from '../devices/crtc6845';
import { HALF_DOTS_PER_CELL, HALF_LINES_PER_CELL, doubleDots, roundedGlyphLine } from './character-rounding';
import { MODE7_COLUMNS, MODE7_ROWS } from './mode7-text';
import { teletextAddress } from './screen-address';
import { type TeletextCell, createTeletextCell, createTeletextState, decodeCell, mosaicLine, startRow } from './teletext-attributes';

// The SAA5050's 6 dots per character (TR6 6 MHz ÷ F1 1 MHz, data sheet
// timing table) as half-dots, and its 10 lines per row (Fig. 10) in both
// fields: one pixel each.
const CELL_WIDTH = HALF_DOTS_PER_CELL; // 12
const CELL_HEIGHT = HALF_LINES_PER_CELL; // 20
/** A double-height cell shows half the character's half-lines. */
const HALF_CHARACTER = HALF_LINES_PER_CELL / 2;

export const MODE7_PIXEL_WIDTH = MODE7_COLUMNS * CELL_WIDTH; // 480
export const MODE7_PIXEL_HEIGHT = MODE7_ROWS * CELL_HEIGHT; // 500

/** BBC physical colour numbers, as the SAA5050's R, G and B pins give them (bit 0 red, bit 1 green, bit 2 blue). */
export const COLOUR_BLACK = 0;
export const COLOUR_WHITE = 7;
/** The ULA inverts the cursor's pixels: colour EOR 7. */
const CURSOR_INVERT = 7;

/** MA0-MA13. */
const MA_MASK = 0x3fff;

/** What the CRTC says to draw this field: where from, how much, and the cursor. */
export interface Mode7Screen {
  /** The MA of the top-left cell: the start address the CRTC latched for this field. */
  readonly start: number;
  /** R1: cells per row; each row starts this many characters after the last. */
  readonly columns: number;
  /** R6: rows displayed. */
  readonly rows: number;
  /** The MA of the cursor's cell (R14/R15), or -1 for no cursor this field. */
  readonly cursor: number;
  /** R10 bits 0-4 and R11: the cursor's first and last pixel rows of the cell (RA). */
  readonly cursorFirstLine: number;
  readonly cursorLastLine: number;
}

/** MODE 7 as MOS 1.20 sets it up (40 × 25) from start MA, with no cursor. For tests and tools. */
export function mode7ScreenAt(start: number): Mode7Screen {
  return { start: start & MA_MASK, columns: MODE7_COLUMNS, rows: MODE7_ROWS, cursor: -1, cursorFirstLine: 0, cursorLastLine: 0 };
}

/** The parts of the 6845 the screen needs. */
export interface Mode7Crtc {
  readonly displayStart: number;
  readonly cursorAddress: number;
  readonly fieldsSinceReset: number;
  register(n: number): number;
}

/**
 * This field's screen, from the CRTC: its latched start, R1 and R6, and the
 * cursor if it's showing (R10's blink in its on phase, R8's cursor skew not %11).
 */
export function mode7ScreenFrom(crtc: Mode7Crtc): Mode7Screen {
  const r10 = crtc.register(CRTC_R10_CURSOR_START);
  const cursorOff = (crtc.register(CRTC_R8_INTERLACE_AND_SKEW) & CRTC_R8_CURSOR_SKEW_OFF) === CRTC_R8_CURSOR_SKEW_OFF || !cursorBlinkOn(r10, crtc.fieldsSinceReset);
  return {
    start: crtc.displayStart,
    columns: crtc.register(CRTC_R1_HORIZONTAL_DISPLAYED),
    rows: crtc.register(CRTC_R6_VERTICAL_DISPLAYED),
    cursor: cursorOff ? -1 : crtc.cursorAddress,
    cursorFirstLine: r10 & 0x1f,
    cursorLastLine: crtc.register(CRTC_R11_CURSOR_END) & 0x1f,
  };
}

/**
 * Draws the 40 × 25 cells of screen into pixels, one colour number per
 * pixel, row by row. pixels must hold 480 × 500. Every pixel is written, so
 * the buffer can be reused frame after frame. flashVisible is the flash
 * phase (teletextFlashVisible): false draws flashing cells as spaces.
 */
export function renderMode7(peek: (address: number) => number, screen: Mode7Screen, pixels: Uint8Array, flashVisible: boolean): void {
  // Made once per frame and reused for every cell: nothing is allocated per cell.
  const state = createTeletextState();
  const cell = createTeletextCell();
  const { start, columns, rows } = screen;
  for (let row = 0; row < MODE7_ROWS; row++) {
    startRow(state);
    // What the counter does: the row's MA is R1 on from the last row's.
    const rowStart = start + row * columns;
    for (let column = 0; column < MODE7_COLUMNS; column++) {
      const origin = row * CELL_HEIGHT * MODE7_PIXEL_WIDTH + column * CELL_WIDTH;
      if (row < rows && column < columns) {
        decodeCell(state, peek(teletextAddress((rowStart + column) & MA_MASK)), cell);
        drawCell(pixels, origin, cell, flashVisible);
      } else {
        fillCell(pixels, origin, COLOUR_BLACK);
      }
    }
  }
  drawCursor(pixels, screen);
}

/**
 * Inverts the cursor cell's pixel rows. Its cell is (cursor - start)
 * characters on, as the counter counts (it doesn't wrap at &2BFF: the
 * board does, in the RAM address).
 */
function drawCursor(pixels: Uint8Array, screen: Mode7Screen): void {
  if (screen.cursor < 0 || screen.columns === 0) return;
  const offset = (screen.cursor - screen.start) & MA_MASK;
  const row = Math.floor(offset / screen.columns);
  const column = offset % screen.columns;
  if (row >= screen.rows || row >= MODE7_ROWS || column >= MODE7_COLUMNS) return;
  const last = Math.min(screen.cursorLastLine, CELL_HEIGHT - 1);
  for (let y = screen.cursorFirstLine; y <= last; y++) {
    const rowStart = (row * CELL_HEIGHT + y) * MODE7_PIXEL_WIDTH + column * CELL_WIDTH;
    for (let x = 0; x < CELL_WIDTH; x++) pixels[rowStart + x] = (pixels[rowStart + x] ?? 0) ^ CURSOR_INVERT;
  }
}

/** One 12 × 20 cell all one colour. */
function fillCell(pixels: Uint8Array, origin: number, colour: number): void {
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const rowStart = origin + y * MODE7_PIXEL_WIDTH;
    pixels.fill(colour, rowStart, rowStart + CELL_WIDTH);
  }
}

/**
 * The 12 half-dots (bit 11 = the leftmost) that a decoded cell lights on
 * pixel row y (0-19) of its cell.
 */
function cellHalfDots(cell: TeletextCell, y: number, flashVisible: boolean): number {
  if (cell.kind === 'blank' || (cell.flash && !flashVisible)) return 0;
  // Which half-line of the character this pixel row shows.
  let halfLine = y;
  if (cell.height === 'top') halfLine = y >> 1;
  else if (cell.height === 'bottom') halfLine = HALF_CHARACTER + (y >> 1);
  // Mosaics are blocks: never rounded, so both fields of a line are the same.
  if (cell.kind === 'mosaic') return doubleDots(mosaicLine(cell.code, cell.separated, halfLine >> 1));
  return roundedGlyphLine(cell.code, halfLine);
}

/** One 12 × 20 cell whose top-left pixel is at index origin. */
function drawCell(pixels: Uint8Array, origin: number, cell: TeletextCell, flashVisible: boolean): void {
  for (let y = 0; y < CELL_HEIGHT; y++) {
    const halfDots = cellHalfDots(cell, y, flashVisible);
    const rowStart = origin + y * MODE7_PIXEL_WIDTH;
    for (let x = 0; x < CELL_WIDTH; x++) {
      pixels[rowStart + x] = (halfDots >> (CELL_WIDTH - 1 - x)) & 1 ? cell.foreground : cell.background;
    }
  }
}
