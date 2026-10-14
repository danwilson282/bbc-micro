// The SAA5050's character rounding (Stage 33): smoothing the diagonals of
// letters with half-dots, using the interlaced second field.
//
// MODE 7 is interlaced (Stage 31), so each matrix line of a letter is drawn
// twice, once per field, and the second field's TV line falls just below
// the first's. The chip draws line L as stored in field 1, and in field 2
// it draws line L plus a half-dot wherever a diagonal crosses from line L to
// line L + 1:
//
//   line L       . . . . # .        half-dots  . . . . . . . . # # . .
//   (between)                                  . . . . . . . # # # . .
//   line L + 1   . . . # . .                   . . . . . . # # . . . .
//
// A half-dot is possible because the dot clock is 6 MHz and the chip can
// change its output on 12 MHz edges. The data sheet shows the effect (its
// rounded character drawing), not the circuit. Our rule (second field only,
// compared with the line below) is the simplest that fills each corner of a
// diagonal once; it is our reading, flagged in the stage doc.
//
// Rounding depends only on the font, so it's worked out once for all 96
// characters at start-up: roundedGlyphLine is one array read.
//
// Masks: a 6-dot mask has bit 5 = dot 0 (the leftmost, the gap column), as in
// mosaicLine and glyphRow. A 12-half-dot mask has bit 11 = half-dot 0.

import { GLYPH_ROWS, glyphRow } from './saa5050-font';

/** Dots per cell (Fig. 10). */
const DOTS = 6;
/** Two half-dots per 6 MHz dot. */
export const HALF_DOTS_PER_CELL = DOTS * 2;
/** Lines per cell (Fig. 10), each drawn in both fields: 20 half-lines. */
export const HALF_LINES_PER_CELL = 20;

const DOT_MASK = 0x3f;
const CODE_MASK = 0x7f;
const CODES = 0x80;

/** A 6-dot mask as 12 half-dots: each dot lights both of its halves. */
export function doubleDots(dots: number): number {
  let halves = 0;
  for (let bit = 0; bit < DOTS; bit++) {
    if ((dots >> bit) & 1) halves |= 0b11 << (2 * bit);
  }
  return halves;
}

/**
 * The field-2 TV line between matrix lines line and below (6-dot masks): line,
 * plus a half-dot beside each of its dots that meets a dot of below only at
 * a corner (neither of the other two corners lit).
 */
export function roundLine(line: number, below: number): number {
  let halves = doubleDots(line);
  // Dot i is bit 5 - i, so dot i - 1 is one bit higher and dot i + 1 one bit lower.
  const downLeft = line & (below >> 1) & ~(line >> 1) & ~below & DOT_MASK;
  const downRight = line & (below << 1) & ~(line << 1) & ~below & DOT_MASK;
  for (let bit = 0; bit < DOTS; bit++) {
    // Dot bit's halves are bits 2·bit + 1 (left) and 2·bit (right).
    // Going down-left: the right half of the dot to its left.
    if ((downLeft >> bit) & 1) halves |= 1 << (2 * bit + 2);
    // Going down-right: the left half of the dot to its right.
    if ((downRight >> bit) & 1) halves |= 1 << (2 * bit - 1);
  }
  return halves;
}

/** Every character's 20 half-lines, as 12-half-dot masks. Built once. */
const ROUNDED: Uint16Array = buildRounded();

function buildRounded(): Uint16Array {
  const table = new Uint16Array(CODES * HALF_LINES_PER_CELL);
  for (let code = 0; code < CODES; code++) {
    // Cell line 0 is the gap line (half-lines 0 and 1); matrix line m is cell line m + 1.
    for (let m = 0; m < GLYPH_ROWS; m++) {
      const line = glyphRow(code, m);
      const below = m + 1 < GLYPH_ROWS ? glyphRow(code, m + 1) : 0;
      table[code * HALF_LINES_PER_CELL + 2 * m + 2] = doubleDots(line);
      table[code * HALF_LINES_PER_CELL + 2 * m + 3] = roundLine(line, below);
    }
  }
  return table;
}

/**
 * Half-line 0-19 of a character, rounded, as 12 half-dots (bit 11 the
 * leftmost). Even half-lines are field 1, odd ones field 2. Bit 7 of code is
 * ignored; control codes are blank.
 */
export function roundedGlyphLine(code: number, halfLine: number): number {
  return ROUNDED[(code & CODE_MASK) * HALF_LINES_PER_CELL + halfLine] ?? 0;
}
