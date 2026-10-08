// The Disassembly panel: what just ran (from the trace) above, and what
// memory decodes to from PC (or a chosen address) below. All decisions come
// from disassembly-view-model.ts; this file only builds elements.
//
//   - Follow PC (on by default): "Coming up" always starts at PC.
//   - Go: decode from a typed address instead, and stop following. Try one
//     that's mid-instruction to see the decode go wrong and then resynchronise.

import type { Labels } from '../../cpu/disassembler';
import { hex16 } from '../../util/bits';
import type { TracedTarget } from './debug-target';
import { buildDisassemblyView } from './disassembly-view-model';
import { parseHexAddress } from './memory-view-model';
import type { Panel } from './panel';

/** A table with the given column headings, and its body. */
function table(className: string, headings: readonly string[]): { table: HTMLTableElement; body: HTMLTableSectionElement } {
  const t = document.createElement('table');
  t.className = `disasm-table ${className}`;
  const head = t.createTHead().insertRow();
  for (const text of headings) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  return { table: t, body: t.createTBody() };
}

function row(body: HTMLTableSectionElement, cells: readonly (readonly [string, string])[]): HTMLTableRowElement {
  const tr = body.insertRow();
  for (const [className, text] of cells) {
    const td = tr.insertCell();
    td.className = className;
    td.textContent = text;
  }
  return tr;
}

/** labels is read on every refresh, so names follow whatever was last assembled. */
export function createDisassemblyPanel(target: TracedTarget, labels: () => Labels): Panel {
  let start: number | undefined;

  const element = document.createElement('div');
  element.className = 'disasm-panel';

  // --- Toolbar: Follow PC, or Go to an address ------------------------------
  const nav = document.createElement('form');
  nav.className = 'disasm-nav';
  const followLabel = document.createElement('label');
  const follow = document.createElement('input');
  follow.type = 'checkbox';
  follow.checked = true;
  follow.name = 'follow';
  followLabel.append(follow, ' Follow PC');
  const address = document.createElement('input');
  address.name = 'address';
  address.setAttribute('aria-label', 'Disassemble from address');
  address.placeholder = '&0418';
  address.size = 6;
  const go = document.createElement('button');
  go.type = 'submit';
  go.textContent = 'Go';
  go.setAttribute('aria-label', 'Disassemble from address');
  const message = document.createElement('span');
  message.className = 'disasm-message';
  message.setAttribute('role', 'status');
  nav.append(followLabel, address, go, message);

  // --- The two halves -------------------------------------------------------
  const ranHeading = document.createElement('h3');
  ranHeading.className = 'disasm-heading';
  ranHeading.textContent = 'Just ran: from the trace';
  const ran = table('disasm-ran', ['', 'Label', 'Address', 'Bytes', 'Instruction', 'When']);
  const ranEmpty = document.createElement('p');
  ranEmpty.className = 'disasm-empty';
  ranEmpty.textContent = 'Nothing yet: the trace starts at reset. Press Step.';

  const nextHeading = document.createElement('h3');
  nextHeading.className = 'disasm-heading';
  nextHeading.dataset.field = 'next-heading';
  const interrupt = document.createElement('p');
  interrupt.className = 'disasm-interrupt';
  interrupt.dataset.field = 'interrupt';
  const next = table('disasm-next', ['', 'Label', 'Address', 'Bytes', 'Instruction']);

  const note = document.createElement('p');
  note.className = 'disasm-note';
  note.textContent =
    'Above: the bytes each step ran with (struck through if memory has changed since). Below: memory now, decoded forwards. Nothing is decoded backwards: it can’t be done reliably.';

  element.append(nav, ranHeading, ran.table, ranEmpty, nextHeading, interrupt, next.table, note);

  follow.addEventListener('change', () => {
    if (follow.checked) start = undefined;
    else start = target.registers.pc;
    message.textContent = '';
    refresh();
  });
  nav.addEventListener('submit', (event) => {
    event.preventDefault();
    const parsed = parseHexAddress(address.value);
    if (parsed === undefined) {
      message.textContent = `"${address.value}" isn't an address: type 0000-FFFF`;
      message.classList.add('error');
      return;
    }
    start = parsed;
    follow.checked = false;
    message.textContent = '';
    message.classList.remove('error');
    refresh();
  });

  function refresh(): void {
    const view = buildDisassemblyView(target, { labels: labels(), start });

    ran.body.replaceChildren();
    for (const r of view.ran) {
      const tr = row(ran.body, [
        ['marker', ''],
        ['label', r.label],
        ['address', r.addressHex],
        ['bytes', r.bytes],
        ['text', r.text],
        ['when', r.cycle],
      ]);
      tr.classList.toggle('changed-since', r.changedSince);
      if (r.changedSince) tr.title = 'Memory no longer holds these bytes: the code was changed after it ran';
    }
    ran.table.hidden = view.ran.length === 0;
    ranEmpty.hidden = view.ran.length > 0;

    nextHeading.textContent = view.heading;
    interrupt.textContent = view.interrupt ?? '';
    interrupt.hidden = view.interrupt === undefined;

    next.body.replaceChildren();
    for (const r of view.next) {
      const tr = row(next.body, [
        ['marker', r.current ? '▶' : ''],
        ['label', r.label],
        ['address', r.addressHex],
        ['bytes', r.bytes],
        ['text', r.text],
      ]);
      tr.dataset.address = hex16(r.address);
      tr.classList.toggle('current', r.current);
    }
  }

  return { title: 'Disassembly', element, refresh };
}
