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
// and the screen wraps round inside &7C00-&7FFF. In MODE 7 the Model B uses
// only MA0-MA9 of the 6845's address and forces A10-A14 high (32K machine):
//
//   RAM address = &7C00 + (MA AND &3FF)
//
// The AUG gives the MOS's side of it: R12/R13 = (start - &7400) EOR &2000,
// so &7C00 is &2800. 1,000 cells are shown; the wrap is every 1,024.

import { hex16 } from '../util/bits';
import { createTeletextCell, createTeletextState, decodeCell, startRow, teletextCellText } from './teletext-attributes';

/** Where MODE 7's screen starts on a 32K machine (AUG, MODE 7). */
export const MODE7_SCREEN_START = 0x7c00;
export const MODE7_COLUMNS = 40;
export const MODE7_ROWS = 25;

/** MODE 7's screen is in this 1K of RAM, whatever R12/R13 say. */
const MODE7_RAM_BASE = 0x7c00;
/** MA0-MA9: the part of the 6845's address that MODE 7 uses. */
const MODE7_ADDRESS_MASK = 0x3ff;

/** The RAM address of the top-left cell, from the CRTC's start address (R12 high, R13 low). */
export function mode7StartAddress(r12: number, r13: number): number {
  return MODE7_RAM_BASE | ((((r12 & 0xff) << 8) | (r13 & 0xff)) & MODE7_ADDRESS_MASK);
}

/** Cell n's RAM address (row × 40 + column), counting on from start and wrapping inside &7C00-&7FFF. */
export function mode7CellAddress(start: number, cell: number): number {
  return MODE7_RAM_BASE | ((start + cell) & MODE7_ADDRESS_MASK);
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
