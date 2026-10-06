// The stack panel: page 1 from &01FF down to just below S, with S marked.
//
// All decisions come from stack-view-model.ts; this file only builds elements.
// Free bytes are faded rather than hidden: pulling doesn't erase, so the old
// values are still there until the next push overwrites them.

import type { CpuTarget } from './debug-target';
import type { Panel } from './panel';
import { buildStackView, type StackByte, type StackView } from './stack-view-model';

export function createStackPanel(target: CpuTarget): Panel {
  let previous: StackView | undefined;

  const element = document.createElement('div');
  element.className = 'stack-panel';

  const summary = document.createElement('p');
  summary.className = 'stack-summary';
  summary.dataset.field = 'summary';

  const table = document.createElement('table');
  table.className = 'stack-table';
  const head = table.createTHead().insertRow();
  for (const text of ['Addr', 'Hex', 'Binary', '']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();

  element.append(summary, table);

  function refresh(): void {
    const view = buildStackView(target, {
      previous,
      written: new Set(target.writes.recorded().map((w) => w.address)),
    });
    previous = view;
    summary.textContent = view.summary;
    body.replaceChildren();
    for (const row of view.rows) {
      const tr = body.insertRow();
      if (row.kind === 'gap') {
        tr.className = 'gap';
        const td = tr.insertCell();
        td.colSpan = 4;
        td.textContent = row.text;
        continue;
      }
      tr.className = row.slot;
      tr.dataset.address = row.label;
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = row.label;
      tr.append(label);
      const hex = tr.insertCell();
      hex.className = 'hex';
      hex.classList.toggle('changed', row.changed);
      hex.classList.toggle('written', row.written);
      hex.textContent = row.hex;
      tr.insertCell().textContent = row.binary;
      const note = tr.insertCell();
      note.className = 'note';
      note.textContent = noteFor(row);
      tr.title = `&${row.label} = &${row.hex} (${String(row.value)})${row.written ? ' (written by the last run)' : ''}`;
    }
  }

  return { title: 'Stack', element, refresh };
}

function noteFor(row: StackByte): string {
  if (row.slot === 'next-push') return '← S (next push)';
  if (row.isTop) return 'next pull';
  return row.slot === 'free' ? '(free)' : '';
}
