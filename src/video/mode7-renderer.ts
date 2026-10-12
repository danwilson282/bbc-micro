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
//   2 across: Stage 33's character rounding adds half dots.
//   2 down:   MODE 7 is interlaced. The second field's 10 lines per row fall
//             between the first field's, and without rounding they draw the
//             same dots.
// So a cell is 12 × 20 pixels and the screen is 40 × 12 = 480 by 25 × 20 = 500.
//
// Stage 31 draws white on black only. Control codes (&00-&1F once bit 7 is
// dropped) are blank cells until Stage 32 gives them meaning.

import { GLYPH_COLUMNS, glyphRow } from './saa5050-font';
import { MODE7_COLUMNS, MODE7_ROWS, mode7CellAddress } from './mode7-text';

/** The SAA5050's dots per character (TR6 6 MHz ÷ F1 1 MHz, data sheet timing table). */
const DOTS_PER_CELL = 6;
/** TV lines per character row, per field (Fig. 10). */
const LINES_PER_CELL = 10;
/** Our pixels per dot, across (half dots, for Stage 33's rounding). */
const PIXELS_PER_DOT = 2;
/** Our pixels per line, down (two interlaced fields). */
const PIXELS_PER_LINE = 2;

const CELL_WIDTH = DOTS_PER_CELL * PIXELS_PER_DOT; // 12
const CELL_HEIGHT = LINES_PER_CELL * PIXELS_PER_LINE; // 20

export const MODE7_PIXEL_WIDTH = MODE7_COLUMNS * CELL_WIDTH; // 480
export const MODE7_PIXEL_HEIGHT = MODE7_ROWS * CELL_HEIGHT; // 500

/** BBC physical colour numbers, as the SAA5050's R, G and B pins give them (bit 0 red, bit 1 green, bit 2 blue). */
export const COLOUR_BLACK = 0;
export const COLOUR_WHITE = 7;

/**
 * Draws the 1,000 cells that start at start (a RAM address in &7C00-&7FFF,
 * from the CRTC's R12/R13) into pixels, one colour number per pixel, row by
 * row. pixels must hold 480 × 500. Every pixel is written, so the buffer can
 * be reused frame after frame.
 */
export function renderMode7(peek: (address: number) => number, start: number, pixels: Uint8Array): void {
  for (let row = 0; row < MODE7_ROWS; row++) {
    for (let column = 0; column < MODE7_COLUMNS; column++) {
      const code = peek(mode7CellAddress(start, row * MODE7_COLUMNS + column));
      drawCell(pixels, row * CELL_HEIGHT * MODE7_PIXEL_WIDTH + column * CELL_WIDTH, code);
    }
  }
}

/** One 12 × 20 cell whose top-left pixel is at index origin. */
function drawCell(pixels: Uint8Array, origin: number, code: number): void {
  for (let line = 0; line < LINES_PER_CELL; line++) {
    // Line 0 is the gap; matrix lines 0-8 are cell lines 1-9. (glyphRow gives
    // 0 for control codes, so they come out as background.)
    const dots = line === 0 ? 0 : glyphRow(code, line - 1);
    const lineStart = origin + line * PIXELS_PER_LINE * MODE7_PIXEL_WIDTH;
    for (let dot = 0; dot < DOTS_PER_CELL; dot++) {
      // Dot 0 is the gap; dots 1-5 are the font's bits 4-0.
      const lit = dot > 0 && (dots >> (GLYPH_COLUMNS - dot)) & 1;
      const colour = lit ? COLOUR_WHITE : COLOUR_BLACK;
      const x = lineStart + dot * PIXELS_PER_DOT;
      for (let dy = 0; dy < PIXELS_PER_LINE; dy++) {
        const p = x + dy * MODE7_PIXEL_WIDTH;
        for (let dx = 0; dx < PIXELS_PER_DOT; dx++) pixels[p + dx] = colour;
      }
    }
  }
}

