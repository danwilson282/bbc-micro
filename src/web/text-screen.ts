// MODE 7's screen memory as a live 40 × 25 grid of text, laid over the
// canvas. Since Stage 31 the canvas shows the real dots and this grid is
// transparent: it's the screen's text for screen readers, Playwright and
// copy-paste. It shows the SAA5050's characters (&23 as £), and since
// Stage 32 graphics as Unicode block sextants (decoded like the dots, since
// a control code changes the cells after it).
//
// One text node per row, built once. draw() runs after every BBC frame (50 a
// second). It decodes the whole screen top to bottom, as the SAA5050 does:
// since Stage 33 a row can't be decoded on its own, because an &8D in one
// row makes the next a bottom row, which hides its normal-height text. So
// it builds all 25 row strings (cheap) and writes only the ones that
// changed to the DOM (the expensive part). At the > prompt that's no DOM
// writes at all. Flashing text is always shown here: this layer is for
// reading and copying, and blinking would only get in the way. (A first
// version had a <span> per cell: 1,000 boxes to lay out cost 9 ms whenever
// the whole screen changed. 25 lines of text cost far less. The CSS also
// gives the grid `contain: strict`, so a change can't relayout the rest of
// the page.)
//
// Which bytes: the CRTC's start address (R12/R13), so it follows the MOS's
// hardware scrolling and wraps inside &7C00-&7FFF (see mode7-text.ts).

import { MODE7_COLUMNS, MODE7_ROWS, mode7CellAddress } from '../video/mode7-text';
import { createTeletextCell, createTeletextState, decodeCell, startRow, teletextCellText } from '../video/teletext-attributes';

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

  const cell = createTeletextCell();

  return {
    element,
    draw(peek, start) {
      // A fresh state each frame: the top of the page.
      const state = createTeletextState();
      for (let row = 0; row < MODE7_ROWS; row++) {
        startRow(state);
        let text = '';
        for (let column = 0; column < MODE7_COLUMNS; column++) {
          decodeCell(state, peek(mode7CellAddress(start, row * MODE7_COLUMNS + column)), cell);
          text += teletextCellText(cell);
        }
        if (rows[row].data !== text) rows[row].data = text;
      }
    },
  };
}
