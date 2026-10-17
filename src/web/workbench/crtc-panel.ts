// The CRTC panel (Stage 37): the 6845's registers and the picture they make.
//
// All decisions come from crtc-view-model.ts; this file only builds
// elements. They're built once and only their text and classes change on
// refresh, so the table doesn't flicker or lose a hover during Run (the
// Stage 24/26 lesson).

import type { Crtc6845 } from '../../devices/crtc6845';
import { CRTC_REGISTER_COUNT } from '../../devices/crtc6845';
import { buildCrtcView, type FrameBox } from './crtc-view-model';
import type { Panel } from './panel';

export interface CrtcPanelSource {
  readonly crtc: Crtc6845;
  /** The Video ULA's control byte: it picks the 6845's clock. */
  ulaControl(): number;
}

function place(element: HTMLElement, box: FrameBox): void {
  element.style.left = `${String(box.left)}%`;
  element.style.top = `${String(box.top)}%`;
  element.style.width = `${String(box.width)}%`;
  element.style.height = `${String(box.height)}%`;
}

export function createCrtcPanel(source: CrtcPanelSource): Panel {
  let previous: readonly number[] | undefined;

  const element = document.createElement('div');
  element.className = 'crtc-panel';

  const summary = document.createElement('p');
  summary.className = 'crtc-summary';
  summary.dataset.field = 'summary';

  // One field to scale: characters across, scanlines down.
  const frame = document.createElement('div');
  frame.className = 'crtc-frame';
  frame.setAttribute('role', 'img');
  const displayed = document.createElement('div');
  displayed.className = 'crtc-displayed';
  displayed.textContent = 'displayed';
  const hsync = document.createElement('div');
  hsync.className = 'crtc-hsync';
  hsync.title = 'HSYNC (R2, R3 bits 0-3)';
  const vsync = document.createElement('div');
  vsync.className = 'crtc-vsync';
  vsync.title = 'VSYNC (R7, R3 bits 4-7)';
  frame.append(displayed, hsync, vsync);
  const legend = document.createElement('p');
  legend.className = 'crtc-legend';
  legend.textContent = 'One field to scale: characters across (R0), scanlines down. Blue: HSYNC. Red: VSYNC.';

  const geometry = document.createElement('dl');
  geometry.className = 'crtc-geometry';
  const geometryValues: HTMLElement[] = [];

  const table = document.createElement('table');
  table.className = 'crtc-table';
  const head = table.createTHead().insertRow();
  for (const text of ['Reg', 'Name', 'Value', 'Access', 'Means']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();
  interface RowCells {
    readonly row: HTMLTableRowElement;
    readonly label: HTMLTableCellElement;
    readonly name: HTMLTableCellElement;
    readonly hex: HTMLTableCellElement;
    readonly access: HTMLTableCellElement;
    readonly meaning: HTMLTableCellElement;
  }
  const cells: RowCells[] = [];
  for (let n = 0; n < CRTC_REGISTER_COUNT; n++) {
    const row = body.insertRow();
    row.dataset.register = String(n);
    const label = document.createElement('th');
    label.scope = 'row';
    row.append(label);
    const name = row.insertCell();
    name.className = 'name';
    const hex = row.insertCell();
    hex.className = 'hex';
    const access = row.insertCell();
    access.className = 'access';
    const meaning = row.insertCell();
    meaning.className = 'meaning';
    cells.push({ row, label, name, hex, access, meaning });
  }

  element.append(summary, frame, legend, geometry, table);

  function refresh(): void {
    const registers = source.crtc.registers();
    const view = buildCrtcView({ registers, addressRegister: source.crtc.addressRegister, ulaControl: source.ulaControl(), previous });
    previous = registers;
    summary.textContent = view.summary;
    frame.setAttribute('aria-label', `Frame layout: ${view.summary}`);
    place(displayed, view.frame.displayed);
    place(hsync, view.frame.hsync);
    place(vsync, view.frame.vsync);

    // The geometry list is the same six lines every time: made on the first refresh, then reused.
    view.geometry.forEach((line, i) => {
      let value = geometryValues.at(i);
      if (value === undefined) {
        const dt = document.createElement('dt');
        dt.textContent = line.label;
        value = document.createElement('dd');
        value.dataset.field = line.label;
        geometry.append(dt, value);
        geometryValues.push(value);
      }
      value.textContent = line.value;
    });

    // One view row per table row: both have CRTC_REGISTER_COUNT.
    cells.forEach((c, n) => {
      const r = view.rows.at(n);
      if (r === undefined) return;
      c.label.textContent = r.label;
      c.name.textContent = r.name;
      c.access.textContent = r.access;
      c.hex.textContent = `&${r.hex}`;
      c.hex.classList.toggle('changed', r.changed);
      c.meaning.textContent = r.meaning;
      c.row.classList.toggle('selected', r.selected);
      c.row.title = r.selected ? `${r.label} is what &FE01 reaches now` : '';
    });
  }

  return { title: 'CRTC (6845)', element, refresh };
}
