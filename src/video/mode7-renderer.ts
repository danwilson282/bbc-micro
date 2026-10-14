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

import { HALF_DOTS_PER_CELL, HALF_LINES_PER_CELL, doubleDots, roundedGlyphLine } from './character-rounding';
import { MODE7_COLUMNS, MODE7_ROWS, mode7CellAddress } from './mode7-text';
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

/**
 * Draws the 1,000 cells that start at start (a RAM address in &7C00-&7FFF,
 * from the CRTC's R12/R13) into pixels, one colour number per pixel, row by
 * row. pixels must hold 480 × 500. Every pixel is written, so the buffer can
 * be reused frame after frame. flashVisible is the flash phase
 * (teletextFlashVisible): false draws flashing cells as spaces.
 */
export function renderMode7(peek: (address: number) => number, start: number, pixels: Uint8Array, flashVisible: boolean): void {
  // Made once per frame and reused for every cell: nothing is allocated per cell.
  const state = createTeletextState();
  const cell = createTeletextCell();
  for (let row = 0; row < MODE7_ROWS; row++) {
    startRow(state);
    for (let column = 0; column < MODE7_COLUMNS; column++) {
      decodeCell(state, peek(mode7CellAddress(start, row * MODE7_COLUMNS + column)), cell);
      drawCell(pixels, row * CELL_HEIGHT * MODE7_PIXEL_WIDTH + column * CELL_WIDTH, cell, flashVisible);
    }
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
