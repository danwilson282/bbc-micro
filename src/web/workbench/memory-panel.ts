// The memory panel: one page of memory as a hex table you can edit.
//
// All the decisions (which rows, what text, what changed, is this valid hex)
// come from memory-view-model.ts. This file only builds elements and handles
// events:
//   - Click a byte: it becomes a text input. Enter pokes it, Escape cancels.
//   - "Go" jumps to the page containing a typed address.
//   - "Prev"/"Next" step one page (&100 bytes) back or forward.
//   - Bytes the CPU wrote in the last run get a border, and a "Wrote:" line
//     lists them; click an address there to jump to its page.

import type { WriteLog } from '../../memory/write-recorder';
import { hex16, hex8 } from '../../util/bits';
import type { DebugTarget } from './debug-target';
import { button } from './dom';
import {
  BYTES_PER_ROW,
  ROWS_PER_PAGE,
  buildMemoryView,
  parseHexAddress,
  parseHexByte,
  rowStart,
  stepPage,
  summariseWrites,
  type MemoryView,
} from './memory-view-model';
import type { Panel } from './panel';

export interface MemoryPanelOptions {
  /** First address to show (aligned down to its row). */
  readonly start: number;
  /** Called after a successful poke, so every panel can redraw. */
  readonly onPoke: () => void;
  /** If given, the byte at the CPU's PC is outlined. */
  readonly pc?: () => number;
  /** If given, bytes the CPU wrote in the last run are marked, and listed under the table. */
  readonly writes?: WriteLog;
}

export function createMemoryPanel(target: DebugTarget, options: MemoryPanelOptions): Panel & {
  goTo(address: number): void;
} {
  let start = rowStart(options.start);
  let previous: MemoryView | undefined;

  const element = document.createElement('div');
  element.className = 'memory-panel';

  // --- Navigation bar ---------------------------------------------------
  const nav = document.createElement('form');
  nav.className = 'memory-nav';
  const prev = button('◀ Prev', 'Previous page');
  const next = button('Next ▶', 'Next page');
  const address = document.createElement('input');
  address.name = 'address';
  address.setAttribute('aria-label', 'Go to address');
  address.placeholder = '&7C00';
  address.size = 6;
  const go = button('Go', 'Go to address');
  go.type = 'submit';
  const message = document.createElement('span');
  message.className = 'memory-message';
  message.setAttribute('role', 'status');
  nav.append(prev, next, address, go, message);

  // --- The table ----------------------------------------------------------
  const table = document.createElement('table');
  table.className = 'memory-table';
  const head = table.createTHead().insertRow();
  head.append(th('Addr'));
  for (let i = 0; i < BYTES_PER_ROW; i++) head.append(th(i.toString(16).toUpperCase()));
  head.append(th('ASCII'));
  const body = table.createTBody();

  const wrote = document.createElement('p');
  wrote.className = 'memory-writes';
  wrote.dataset.field = 'writes';

  element.append(nav, table);
  if (options.writes !== undefined) element.append(wrote);

  function say(text: string, isError = false): void {
    message.textContent = text;
    message.classList.toggle('error', isError);
  }

  function refresh(): void {
    const records = options.writes?.recorded() ?? [];
    const view = buildMemoryView(target, start, ROWS_PER_PAGE, {
      previous,
      pc: options.pc?.(),
      written: new Set(records.map((w) => w.address)),
    });
    previous = view;
    if (options.writes !== undefined) showWrites(summariseWrites(records, options.writes.count));
    body.replaceChildren();
    for (const row of view.rows) {
      const tr = body.insertRow();
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = row.label;
      tr.append(label);
      for (const cell of row.cells) {
        const td = tr.insertCell();
        td.className = 'byte';
        td.classList.toggle('changed', cell.changed);
        td.classList.toggle('pc', cell.isPc);
        td.classList.toggle('written', cell.written);
        td.textContent = cell.hex;
        td.dataset.address = hex16(cell.address);
        td.title = `&${hex16(cell.address)} = &${cell.hex} (${String(cell.value)})${cell.isPc ? ' ← PC' : ''}${cell.written ? ' (written by the last run)' : ''}`;
      }
      const ascii = tr.insertCell();
      ascii.className = 'ascii';
      ascii.textContent = row.ascii;
    }
  }

  function showWrites(summary: ReturnType<typeof summariseWrites>): void {
    wrote.replaceChildren('Wrote: ');
    if (summary.items.length === 0) {
      wrote.append('nothing in the last run');
      return;
    }
    summary.items.forEach((item, i) => {
      if (i > 0) wrote.append(', ');
      const jump = button(item.text, `Go to &${hex16(item.address)}`);
      jump.className = 'write-link';
      jump.addEventListener('click', () => {
        goTo(item.address);
      });
      wrote.append(jump);
    });
    if (summary.more > 0) wrote.append(` +${String(summary.more)} more`);
  }

  function goTo(newStart: number): void {
    start = rowStart(newStart);
    refresh();
  }

  function beginEdit(td: HTMLTableCellElement, cellAddress: number): void {
    const input = document.createElement('input');
    input.className = 'byte-edit';
    input.value = td.textContent;
    input.size = 3;
    input.setAttribute('aria-label', `Edit byte at &${hex16(cellAddress)}`);
    td.replaceChildren(input);
    input.select();

    let done = false;
    const finish = (): void => {
      done = true;
      refresh();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        say('');
        finish();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const value = parseHexByte(input.value);
        if (value === undefined) {
          say(`"${input.value}" isn't a byte: type 00-FF (&, $ or 0x prefix optional)`, true);
          return; // leave the input open to fix
        }
        say(`Poked &${hex16(cellAddress)} = &${hex8(value)}`);
        target.poke(cellAddress, value);
        done = true;
        options.onPoke();
      }
    });
    // Clicking away cancels, like Escape.
    input.addEventListener('blur', () => {
      if (!done) finish();
    });
  }

  // One listener for all 256 cells (event delegation), not one per cell.
  body.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLTableCellElement)) return;
    const hex = event.target.dataset.address;
    if (hex === undefined) return;
    beginEdit(event.target, parseInt(hex, 16));
  });

  prev.addEventListener('click', () => {
    goTo(stepPage(start, -1));
  });
  next.addEventListener('click', () => {
    goTo(stepPage(start, 1));
  });
  nav.addEventListener('submit', (event) => {
    event.preventDefault();
    const wanted = parseHexAddress(address.value);
    if (wanted === undefined) {
      say(`"${address.value}" isn't an address: type 0000-FFFF`, true);
      return;
    }
    say('');
    goTo(wanted);
  });

  return { title: 'Memory', element, refresh, goTo };
}

function th(text: string): HTMLTableCellElement {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = text;
  return cell;
}
