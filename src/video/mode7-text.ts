// MODE 7's screen memory, read as text. Not a renderer: Stage 31's SAA5050
// turns the same bytes into dots.
//
// MODE 7 keeps one byte per character cell, 40 × 25 = 1,000 bytes from
// &7C00 to &7FE7 (Advanced User Guide, MODE 7). Row r, column c is at
// &7C00 + r × 40 + c.
//
// Codes below &20 and &80-&9F are teletext control codes (colours, graphics,
// flash...). Each takes a cell and shows as a space, so we show a space. The
// SAA5050 ignores bit 7. The rest is shown as the character the SAA5050
// draws, which is mostly ASCII but not quite (&23 is £): see saa5050-font.ts.
// In graphics mode (Stage 32) a mosaic shows as a Unicode block sextant, so
// each row goes through the same attribute decoder as the dots.
//
// Where the screen starts (Stage 30). When the MOS scrolls MODE 7 it doesn't
// move the bytes: it moves the CRTC's start address (R12/R13) on by a row,
// and the screen wraps round inside &7C00-&7FFF. Since Stage 39 the board's
// translation is in screen-address.ts: A0-A9 = MA0-MA9, A10-A13 high,
// A14 = MA11, so the MOS's &2800 is &7C00 (and a 16K machine's &2000 is
// &3C00).
//
// The AUG gives the MOS's side of it: R12/R13 = (start - &7400) EOR &2000.
// 1,000 cells are shown; the wrap is every 1,024. (These helpers assume
// MODE 7's 40 columns; the renderer uses the CRTC's R1, Stage 39.)

import { hex16 } from '../util/bits';
import { teletextAddress } from './screen-address';
import { createTeletextCell, createTeletextState, decodeCell, startRow, teletextCellText } from './teletext-attributes';

/** Where MODE 7's screen starts on a 32K machine (AUG, MODE 7). */
export const MODE7_SCREEN_START = 0x7c00;
export const MODE7_COLUMNS = 40;
export const MODE7_ROWS = 25;

/** MA0-MA9 (A0-A9): the screen wraps every 1,024 bytes. */
const MODE7_ADDRESS_MASK = 0x3ff;

/** The RAM address of the top-left cell, from the CRTC's start address (R12 high, R13 low). */
export function mode7StartAddress(r12: number, r13: number): number {
  return teletextAddress(((r12 & 0xff) << 8) | (r13 & 0xff));
}

/** Cell n's RAM address (row × 40 + column), counting on from start and wrapping inside start's 1K (&7C00-&7FFF on a 32K MOS). */
export function mode7CellAddress(start: number, cell: number): number {
  return (start & ~MODE7_ADDRESS_MASK) | ((start + cell) & MODE7_ADDRESS_MASK);
}

/** The screen, as 25 strings of 40 characters. Reads with peek, so it has no side effects. */
export function mode7Text(peek: (address: number) => number, start = MODE7_SCREEN_START): string[] {
  const rows: string[] = [];
  const state = createTeletextState();
  const cell = createTeletextCell();
  for (let row = 0; row < MODE7_ROWS; row++) {
    startRow(state);
    let text = '';
    for (let column = 0; column < MODE7_COLUMNS; column++) {
      decodeCell(state, peek(mode7CellAddress(start, row * MODE7_COLUMNS + column)), cell);
      text += teletextCellText(cell);
    }
    rows.push(text);
  }
  return rows;
}

/** The rows in a box, with the start address above, for the CLI. */
export function formatMode7Text(rows: readonly string[], start = MODE7_SCREEN_START): string[] {
  const width = rows[0]?.length ?? MODE7_COLUMNS;
  return [`&${hex16(start)} ┌${'─'.repeat(width)}┐`, ...rows.map((r) => `      │${r}│`), `      └${'─'.repeat(width)}┘`];
}
