// The Program panel: the listing of the program in memory (from the Assembler
// panel since Stage 08), with the next line to run marked ▶. All decisions
// come from listing-view-model.ts.

import type { ListingLine } from '../../playground/listing';
import type { CpuTarget } from './debug-target';
import { buildListingView } from './listing-view-model';
import type { Panel } from './panel';

/** lines is read on every refresh, so the panel follows whatever was last assembled. */
export function createListingPanel(target: CpuTarget, lines: () => readonly ListingLine[]): Panel {
  const element = document.createElement('div');
  element.className = 'listing-panel';

  const table = document.createElement('table');
  table.className = 'listing-table';
  const head = table.createTHead().insertRow();
  for (const text of ['', 'Address', 'Bytes', 'Source', 'Watch for']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();

  const note = document.createElement('p');
  note.className = 'listing-note';
  note.textContent = '▶ marks the line the next Step runs. "edited" means memory no longer holds the listed bytes.';

  element.append(table, note);

  function refresh(): void {
    body.replaceChildren();
    for (const row of buildListingView(lines(), target, target.registers.pc)) {
      const tr = body.insertRow();
      tr.dataset.address = row.addressHex.slice(1);
      tr.classList.toggle('current', row.current);
      tr.classList.toggle('modified', row.modified);
      const cells = [row.current ? '▶' : '', row.addressHex, row.bytes, row.source, row.modified ? `${row.comment} (edited)` : row.comment];
      cells.forEach((text, i) => {
        const td = tr.insertCell();
        td.className = ['marker', 'address', 'bytes', 'source', 'comment'][i] ?? '';
        td.textContent = text;
      });
    }
  }

  return { title: 'Program', element, refresh };
}
