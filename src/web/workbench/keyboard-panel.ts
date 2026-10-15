// The Keyboard panel (Stage 34): the BBC's key switches, shown twice.
//
//   ┌ the desk view ─────────────────────┐  ┌ the matrix view ─┐
//   │ ESCAPE 1 2 3 ...                   │  │    0  1  2 ... 9 │
//   │ TAB Q W E ...                      │  │ &0 SHF CTL b7 ...│
//   └────────────────────────────────────┘  │ &4 CAPS A  X  ...│
//                                           └──────────────────┘
// Press a PC key (with the screen focused) and the one switch it closes
// lights in both. Click a key to hold it down, and click again to let go:
// the only way to press SHIFT LOCK, which has no PC twin.
//
// The buttons and cells are built once. refresh() only flips a class on
// each, so a click can't land on an element that has just been replaced
// (the problem the older panels have while running; see Stage 26).

import { MATRIX_COLUMNS, type Keyboard } from '../../devices/keyboard';
import { hex8 } from '../../util/bits';
import { DESK_ROWS, describeDown, describeScan, matrixCells } from './keyboard-view-model';
import type { Panel } from './panel';

export interface KeyboardPanelOptions {
  /** Called after a click presses or releases a key. */
  readonly onChange: () => void;
  /** Is the screen focused, so PC keys reach the BBC? */
  readonly typing: () => boolean;
  /** The System VIA's IER, for the scan line (Stage 35). */
  readonly ier: () => number;
}

export function createKeyboardPanel(keyboard: Keyboard, options: KeyboardPanelOptions): Panel {
  const element = document.createElement('div');
  element.className = 'keyboard-panel';

  const status = document.createElement('p');
  status.className = 'keyboard-status';
  const hint = document.createElement('span');
  hint.dataset.field = 'typing';
  const down = document.createElement('span');
  down.dataset.field = 'down';
  status.append(hint, ' ', down);

  // Stage 35: who picks the column, and is the MOS waiting for CA2?
  const scan = document.createElement('p');
  scan.className = 'keyboard-scan';

  // Everything that lights up, with the key number it shows.
  const lit: { readonly element: HTMLElement; readonly key: number }[] = [];

  const desk = document.createElement('div');
  desk.className = 'bbc-keyboard';
  desk.setAttribute('aria-label', 'BBC keyboard');
  for (const row of DESK_ROWS) {
    const line = document.createElement('div');
    line.className = 'bbc-key-row';
    for (const cap of row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bbc-key';
      b.style.flexGrow = String(cap.width);
      if (cap.kind === 'break') {
        b.textContent = 'BREAK';
        b.disabled = true;
        b.classList.add('not-in-matrix');
        b.title = 'BREAK is not in the matrix: it is wired to the reset circuit (Stage 36). Use the BREAK button under the screen.';
      } else {
        if (cap.shifted !== undefined) {
          const top = document.createElement('span');
          top.className = 'shifted';
          top.textContent = cap.shifted;
          b.append(top, document.createElement('br'));
        }
        b.append(cap.legend);
        b.title = cap.title;
        b.dataset.key = hex8(cap.key);
        b.setAttribute('aria-label', cap.title);
        const key = cap.key;
        // Keep focus on the screen, so you can click SHIFT LOCK and go on typing.
        b.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        b.addEventListener('click', () => {
          if (keyboard.isDown(key)) keyboard.release(key);
          else keyboard.press(key);
          options.onChange();
        });
        lit.push({ element: b, key });
      }
      line.append(b);
    }
    desk.append(line);
  }

  const matrix = document.createElement('table');
  matrix.className = 'key-matrix';
  matrix.setAttribute('aria-label', 'Key matrix: rows by columns');
  const head = matrix.createTHead().insertRow();
  head.append(document.createElement('th'));
  for (let column = 0; column < MATRIX_COLUMNS; column++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = String(column);
    head.append(th);
  }
  const body = matrix.createTBody();
  matrixCells().forEach((cells, row) => {
    const tr = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = `&${String(row)}x`;
    tr.append(th);
    for (const cell of cells) {
      const td = tr.insertCell();
      td.textContent = cell.label;
      td.title = cell.title;
      td.dataset.key = hex8(cell.key);
      td.classList.toggle('link', cell.kind === 'link');
      lit.push({ element: td, key: cell.key });
    }
  });

  element.append(status, scan, desk, matrix);

  function refresh(): void {
    hint.textContent = options.typing() ? 'Typing goes to the BBC.' : 'Click the screen to type.';
    hint.classList.toggle('active', options.typing());
    down.textContent = describeDown(keyboard);
    scan.textContent = describeScan(keyboard, options.ier());
    for (const { element: e, key } of lit) {
      const isDown = keyboard.isDown(key);
      e.classList.toggle('down', isDown);
      if (e instanceof HTMLButtonElement) e.setAttribute('aria-pressed', String(isDown));
    }
  }

  return { title: 'Keyboard', element, refresh };
}
