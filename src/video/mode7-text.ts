// MODE 7's screen memory, read as text. Not a renderer: Stage 31's SAA5050
// turns the same bytes into dots.
//
// MODE 7 keeps one byte per character cell, 40 × 25 = 1,000 bytes from
// &7C00 to &7FE7 (Advanced User Guide, MODE 7). Row r, column c is at
// &7C00 + r × 40 + c.
//
// Codes below &20 and &80-&9F are teletext control codes (colours, graphics,
// flash...). Each takes a cell and shows as a space, so we show a space. The
// SAA5050 ignores bit 7. The rest is shown as ASCII, although a few teletext
// characters differ (&23 is £): Stage 31.
//
// It always reads from `start`. When the MOS scrolls MODE 7 it moves the
// CRTC's start address instead of the bytes, so after a scroll the screen
// starts elsewhere in &7C00-&7FFF and wraps. Not followed yet (Stage 30).

import { hex16 } from '../util/bits';

/** Where MODE 7's screen starts on a 32K machine (AUG, MODE 7). */
export const MODE7_SCREEN_START = 0x7c00;
export const MODE7_COLUMNS = 40;
export const MODE7_ROWS = 25;

const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/** The screen, as 25 strings of 40 characters. Reads with peek, so it has no side effects. */
export function mode7Text(peek: (address: number) => number, start = MODE7_SCREEN_START): string[] {
  const rows: string[] = [];
  for (let row = 0; row < MODE7_ROWS; row++) {
    let text = '';
    for (let column = 0; column < MODE7_COLUMNS; column++) {
      const code = peek((start + row * MODE7_COLUMNS + column) & 0xffff) & 0x7f;
      text += code >= FIRST_PRINTABLE && code < DELETE ? String.fromCharCode(code) : ' ';
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
