// Teletext test pages: 1,000 bytes each to poke into MODE 7's screen memory
// at &7C00.
//
// Page 1 (Stage 32) shows every colour, both backgrounds, all 64 sixels
// contiguous and separated, blast-through capitals, and hold graphics with
// and without.
//
// Page 2 (Stage 33) has a double-height, flashing title, then flash and
// steady, double and normal height (including a mismatched pair), conceal,
// character rounding at double height, and hold cleared by a height change.
// Double-height rows are written twice, as a BBC program must.
//
// Rows are written as lists of bytes and text: [0x81, 'Red'] is the alpha
// red code then R e d. Control codes are written with bit 7 set, as a BBC
// BASIC programmer would (CHR$129); the SAA5050 ignores bit 7 anyway.

import { MODE7_COLUMNS, MODE7_ROWS } from './mode7-text';

export type RowPart = number | string;

/** One row of 40 bytes, padded with spaces. Throws if it doesn't fit, or text isn't 7-bit. */
export function pageRow(parts: readonly RowPart[]): number[] {
  const bytes: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') {
      bytes.push(part & 0xff);
      continue;
    }
    for (const ch of part) {
      const code = ch.charCodeAt(0);
      if (code >= 0x80) throw new Error(`"${ch}" isn't a 7-bit character (for £, write # (&23): the SAA5050 draws it as £)`);
      bytes.push(code);
    }
  }
  if (bytes.length > MODE7_COLUMNS) throw new Error(`Row is ${String(bytes.length)} cells; a teletext row has ${String(MODE7_COLUMNS)}`);
  while (bytes.length < MODE7_COLUMNS) bytes.push(0x20);
  return bytes;
}

/** count bytes from first: e.g. the 32 sixels &A0-&BF. */
function run(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => first + i);
}

/** For each colour 1-7: the code (base + colour), then the cells after it. */
function eachColour(base: number, after: readonly RowPart[]): RowPart[] {
  return [1, 2, 3, 4, 5, 6, 7].flatMap((colour) => [base + colour, ...after]);
}

const ALPHA = 0x80; // + colour: &81-&87
const GRAPHICS = 0x90; // + colour: &91-&97
const CONTIGUOUS = 0x99;
const SEPARATED = 0x9a;
const BLACK_BACKGROUND = 0x9c;
const NEW_BACKGROUND = 0x9d;
const HOLD = 0x9e;
const RELEASE = 0x9f;
const FLASH = 0x88;
const STEADY = 0x89;
const NORMAL_HEIGHT = 0x8c;
const DOUBLE_HEIGHT = 0x8d;
const CONCEAL = 0x98;
const BLOCK = 0xff; // all six sixels

const COLOUR_PAGE: readonly (readonly RowPart[])[] = [
  [ALPHA + 4, NEW_BACKGROUND, ALPHA + 3, 'Teletext colours & graphics'],
  [],
  ['Text colours (&81-&87), set-after:'],
  [ALPHA + 1, 'Red', ALPHA + 2, 'Green', ALPHA + 3, 'Yellow', ALPHA + 4, 'Blue'],
  [ALPHA + 5, 'Magenta', ALPHA + 6, 'Cyan', ALPHA + 7, 'White'],
  ['Backgrounds: &9D new, &9C black'],
  [ALPHA + 1, NEW_BACKGROUND, ALPHA + 7, 'White on red', BLACK_BACKGROUND, ' and black again'],
  [...eachColour(ALPHA, [NEW_BACKGROUND, '  ']), BLACK_BACKGROUND],
  [],
  ['Graphics &91-&97, then &9A separated:'],
  eachColour(GRAPHICS, [BLOCK, BLOCK, BLOCK, BLOCK]),
  [SEPARATED, ...eachColour(GRAPHICS, [BLOCK, BLOCK, BLOCK, BLOCK])],
  [],
  ['All 64 sixels (&A0-&BF, &E0-&FF):'],
  [GRAPHICS + 7, ...run(0xa0, 32)],
  [GRAPHICS + 7, ...run(0xe0, 32)],
  [GRAPHICS + 7, SEPARATED, ...run(0xa0, 32)],
  [GRAPHICS + 7, SEPARATED, ...run(0xe0, 32), CONTIGUOUS, BLOCK, BLOCK],
  [],
  ['Blast-through:', GRAPHICS + 6, BLOCK, BLOCK, 'TELETEXT', BLOCK, BLOCK],
  [],
  ['Hold graphics: without, then with &9E'],
  eachColour(GRAPHICS, [BLOCK, BLOCK]),
  [GRAPHICS + 1, HOLD, BLOCK, BLOCK, ...eachColour(GRAPHICS, [BLOCK, BLOCK]).slice(3)],
  [GRAPHICS + 1, HOLD, BLOCK, GRAPHICS + 2, BLOCK, RELEASE, GRAPHICS + 3, BLOCK, GRAPHICS + 4, BLOCK, ALPHA + 7, ' &9F releases'],
];

const TITLE: readonly RowPart[] = [ALPHA + 4, NEW_BACKGROUND, ALPHA + 3, DOUBLE_HEIGHT, FLASH, 'Double height, flash & conceal'];
const NORMAL_AND_DOUBLE: readonly RowPart[] = [ALPHA + 6, 'Normal', DOUBLE_HEIGHT, 'Double', NORMAL_HEIGHT, 'Normal'];
const ROUNDED: readonly RowPart[] = [ALPHA + 7, DOUBLE_HEIGHT, 'AMVWXZ 2357 <> / ? sgy'];
const HOLD_RESET: readonly RowPart[] = [GRAPHICS + 1, HOLD, BLOCK, BLOCK, DOUBLE_HEIGHT, GRAPHICS + 2, BLOCK, BLOCK, ALPHA + 7, 'Held block cleared'];

const EFFECTS_PAGE: readonly (readonly RowPart[])[] = [
  TITLE,
  TITLE,
  [],
  ['Flash &88 (after), steady &89 (at):'],
  [ALPHA + 7, 'Steady ', FLASH, 'flashing', STEADY, 'steady again'],
  [ALPHA + 1, NEW_BACKGROUND, ALPHA + 7, FLASH, 'Blinks on red', STEADY, BLACK_BACKGROUND, ALPHA + 2, 'steady'],
  [GRAPHICS + 2, FLASH, BLOCK, BLOCK, BLOCK, STEADY, BLOCK, BLOCK, BLOCK, ALPHA + 7, 'Mosaics too'],
  [],
  ['Double height &8D (after), normal &8C:'],
  NORMAL_AND_DOUBLE,
  NORMAL_AND_DOUBLE,
  ['Normal text on a bottom row is hidden'],
  [],
  ['Each row draws its own bytes:'],
  [ALPHA + 3, DOUBLE_HEIGHT, 'HELLO', GRAPHICS + 5, BLOCK, BLOCK],
  [ALPHA + 3, DOUBLE_HEIGHT, 'WORLD', GRAPHICS + 5, BLOCK, BLOCK],
  [],
  ['Conceal &98 (at), ended by a colour:'],
  [ALPHA + 7, 'Answer:', CONCEAL, 'Paris', ALPHA + 2, 'shown'],
  [],
  ['Rounding: half-dots smooth diagonals'],
  ROUNDED,
  ROUNDED,
  HOLD_RESET,
  HOLD_RESET,
];

/** The test pages' rows, 25 of 40 bytes each: TEST_PAGES[0] is page 1. */
export const TEST_PAGES: readonly (readonly (readonly number[])[])[] = [COLOUR_PAGE, EFFECTS_PAGE].map((page, i) => {
  if (page.length !== MODE7_ROWS) throw new Error(`Test page ${String(i + 1)} has ${String(page.length)} rows, not ${String(MODE7_ROWS)}`);
  return page.map(pageRow);
});

export const TEST_PAGE_COUNT = TEST_PAGES.length;

/** One whole page (1-2), 1,000 bytes, for &7C00 onwards. */
export function teletextTestPage(page: number): number[] {
  if (!Number.isInteger(page) || page < 1 || page > TEST_PAGE_COUNT) throw new Error(`There are test pages 1-${String(TEST_PAGE_COUNT)}, not ${String(page)}`);
  return (TEST_PAGES[page - 1] ?? []).flat();
}
