// MODE 7's screen memory as a live 40 × 25 grid of text, laid over the
// canvas. Since Stage 31 the canvas shows the real dots and this grid is
// transparent: it's the screen's text for screen readers, Playwright and
// copy-paste. It shows the SAA5050's characters (&23 as £).
//
// One text node per row, built once. draw() runs after every BBC frame (50 a
// second), so it remembers the code each cell last showed and only rebuilds
// a row when one of its 40 cells changed. At the > prompt that's no DOM
// writes at all. (A first version had a <span> per cell: 1,000 boxes to lay
// out cost 9 ms whenever the whole screen changed. 25 lines of text cost
// far less. The CSS also gives the grid `contain: strict`, so a change
// can't relayout the rest of the page.)
//
// Which bytes: the CRTC's start address (R12/R13), so it follows the MOS's
// hardware scrolling and wraps inside &7C00-&7FFF (see mode7-text.ts).

import { MODE7_COLUMNS, MODE7_ROWS, mode7CellAddress } from '../video/mode7-text';
import { teletextCharacter } from '../video/saa5050-font';

const CELLS = MODE7_COLUMNS * MODE7_ROWS;
/** The SAA5050 sees 7 bits (bit 7 isn't wired). */
const CODE_MASK = 0x7f;
/** Not a 7-bit code, so the first draw writes every row. */
const NOTHING_SHOWN = 0xff;
/** What each of the 128 codes shows, made once. */
const CHARACTERS: readonly string[] = Array.from({ length: 128 }, (_, code) => teletextCharacter(code));

export interface TextScreen {
  readonly element: HTMLElement;
  /** Shows the 1,000 cells from start (a RAM address in &7C00-&7FFF), reading with peek. */
  draw(peek: (address: number) => number, start: number): void;
}

export function createTextScreen(): TextScreen {
  const element = document.createElement('pre');
  element.className = 'text-screen';
  element.setAttribute('aria-label', 'Screen (MODE 7 as text)');

  const rows: Text[] = [];
  for (let row = 0; row < MODE7_ROWS; row++) {
    const line = document.createElement('span');
    line.className = 'text-row';
    const text = document.createTextNode(' '.repeat(MODE7_COLUMNS));
    line.append(text);
    rows.push(text);
    // A newline between rows, so the grid's text (and a copy-paste of it) reads as 25 lines.
    element.append(line, '\n');
  }

  const shown = new Uint8Array(CELLS).fill(NOTHING_SHOWN);

  return {
    element,
    draw(peek, start) {
      for (let row = 0; row < MODE7_ROWS; row++) {
        const first = row * MODE7_COLUMNS;
        let changed = false;
        for (let i = first; i < first + MODE7_COLUMNS; i++) {
          const code = peek(mode7CellAddress(start, i)) & CODE_MASK;
          if (code !== shown[i]) {
            shown[i] = code;
            changed = true;
          }
        }
        if (!changed) continue;
        let text = '';
        for (let i = first; i < first + MODE7_COLUMNS; i++) text += CHARACTERS[shown[i]];
        rows[row].data = text;
      }
    },
  };
}
