// The Memory map panel (Stage 21): which part of the machine answers each
// address, and what the CPU has been doing to the I/O chips.
//
//   - A bar of the 64K, one coloured block per region (I/O pages widened so
//     you can see them), and a table of the regions. "Go" opens the region in
//     the Memory panel. The region holding PC is marked.
//   - The SHEILA slot table: chip, registers × mirrors, placeholder or real,
//     and how many reads and writes the CPU has made.
//   - The I/O log: the latest accesses to &FC00-&FEFF, in words.
//
// The decisions are in memory-map-view-model.ts; this file only builds elements.

import { button } from './dom';
import { buildMemoryMapView, type MemoryMapSource } from './memory-map-view-model';
import type { Panel } from './panel';

export interface MemoryMapPanelOptions {
  /** If given, the region holding PC is marked. */
  readonly pc?: () => number;
  /** "Go" on a region: show this address in the Memory panel. */
  readonly onGo?: (address: number) => void;
  /** "Clear" on the log: empty the log and counts, then redraw. */
  readonly onClear?: () => void;
}

export function createMemoryMapPanel(source: MemoryMapSource, options: MemoryMapPanelOptions = {}): Panel {
  const element = document.createElement('div');
  element.className = 'memory-map-panel';

  const bar = document.createElement('div');
  bar.className = 'map-bar';
  bar.setAttribute('aria-hidden', 'true'); // the table below says the same in words

  const regions = document.createElement('table');
  regions.className = 'map-table map-regions';
  regions.createTHead().insertRow().append(th(''), th('Addresses'), th('Size'), th('Region'), th("What's there"), th(''));
  const regionBody = regions.createTBody();

  const sheilaHeading = heading('SHEILA (&FE00-&FEFF), slot by slot');
  const slots = document.createElement('table');
  slots.className = 'map-table map-slots';
  slots.createTHead().insertRow().append(th('Slot'), th('Chip'), th('Registers'), th('Device'), th('Reads'), th('Writes'));
  const slotBody = slots.createTBody();

  const logHeading = heading('I/O log: the CPU at &FC00-&FEFF');
  const clear = button('Clear', 'Clear the I/O log');
  clear.className = 'map-clear';
  logHeading.append(' ', clear);
  const logNote = document.createElement('p');
  logNote.className = 'map-note';
  logNote.dataset.field = 'log-note';
  const log = document.createElement('table');
  log.className = 'map-table map-log';
  log.createTHead().insertRow().append(th('#'), th(''), th('Address'), th('Value'), th('Reached'));
  const logBody = log.createTBody();

  element.append(bar, regions, sheilaHeading, slots, logHeading, logNote, log);

  clear.addEventListener('click', () => {
    options.onClear?.();
  });

  function refresh(): void {
    const view = buildMemoryMapView(source, { pc: options.pc?.() });

    bar.replaceChildren();
    for (const r of view.regions) {
      const block = document.createElement('div');
      block.className = `map-block region-${r.id}`;
      block.classList.toggle('pc', r.hasPc);
      // Proportional, but no block narrower than its label: the I/O pages are 0.4% each.
      block.style.flexGrow = String(r.share * 100);
      block.textContent = r.name;
      bar.append(block);
    }

    regionBody.replaceChildren();
    for (const r of view.regions) {
      const tr = regionBody.insertRow();
      tr.className = `region-row region-${r.id}`;
      tr.classList.toggle('pc', r.hasPc);
      tr.dataset.region = r.id;
      const swatch = tr.insertCell();
      swatch.className = 'swatch';
      cell(tr, r.range, 'mono');
      cell(tr, r.size);
      cell(tr, r.hasPc ? `${r.name} ← PC` : r.name, 'name');
      cell(tr, r.detail, 'detail');
      const go = tr.insertCell();
      if (options.onGo) {
        const onGo = options.onGo;
        const b = button('Go', `Show ${r.range} in the Memory panel`);
        b.addEventListener('click', () => {
          onGo(r.start);
        });
        go.append(b);
      }
    }

    slotBody.replaceChildren();
    for (const s of view.slots) {
      const tr = slotBody.insertRow();
      tr.dataset.slot = s.id;
      tr.classList.toggle('used', s.reads + s.writes > 0);
      cell(tr, s.range, 'mono');
      cell(tr, s.name === s.chip ? s.name : `${s.name}: ${s.chip}`);
      cell(tr, s.registers, 'mono');
      cell(tr, s.device, s.isPlaceholder ? 'placeholder' : 'emulated');
      cell(tr, String(s.reads), 'count');
      cell(tr, String(s.writes), 'count');
    }

    logNote.textContent = view.logNote;
    logBody.replaceChildren();
    for (const row of view.log) {
      const tr = logBody.insertRow();
      tr.className = row.direction === 'W' ? 'write' : 'read';
      cell(tr, String(row.index), 'count');
      cell(tr, row.direction, 'direction');
      cell(tr, row.address, 'mono');
      cell(tr, row.value, 'mono');
      cell(tr, row.text, 'text');
    }
  }

  return { title: 'Memory map', element, refresh };
}

function th(text: string): HTMLTableCellElement {
  const c = document.createElement('th');
  c.scope = 'col';
  c.textContent = text;
  return c;
}

function cell(tr: HTMLTableRowElement, text: string, className?: string): HTMLTableCellElement {
  const td = tr.insertCell();
  td.textContent = text;
  if (className !== undefined) td.className = className;
  return td;
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.className = 'map-heading';
  h.textContent = text;
  return h;
}
