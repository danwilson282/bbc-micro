// The Disc panel (Stage 48): drop an .ssd or .dsd (or choose one) and see
// its DFS catalogue as *CAT would print it, with every file's *INFO numbers.
//
// The reasoning is in disc-view-model.ts. Since Stage 50 the disc also goes
// into drive 0 (through `drive`, so this file doesn't know the machine), and
// *CAT on the emulator's screen reads it. Eject takes it out again.
// main.ts sends drops anywhere on the page here too, so a near miss doesn't
// make the browser leave the emulator to show the file.

import type { DiscImage } from '../../disc/disc-image';
import { discView, type DiscSideView } from './disc-view-model';
import type { Panel } from './panel';

export interface DiscPanel extends Panel {
  /** Reads a dropped or chosen file and shows its catalogue. */
  load(file: File): Promise<void>;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sideElement(side: DiscSideView, sides: number): HTMLElement {
  const box = element('section', 'disc-side');
  box.setAttribute('aria-label', `Drive ${String(side.drive)}`);
  if (sides > 1) box.append(element('h3', 'disc-drive', `Drive ${String(side.drive)} (side ${String(side.drive / 2)})`));
  if (side.error !== undefined) {
    box.append(element('p', 'disc-error', side.error));
    return box;
  }
  box.append(element('pre', 'disc-cat', side.catLines.join('\n')));
  box.append(element('p', 'disc-summary', side.summary));

  const table = element('table', 'crtc-table disc-files');
  table.createCaption().textContent = '*INFO, in catalogue order (highest start sector first)';
  const head = table.createTHead().insertRow();
  for (const label of ['File', 'L', 'Load', 'Exec', 'Length', 'Start', 'Sectors']) head.append(element('th', '', label));
  const body = table.createTBody();
  for (const f of side.files) {
    const row = body.insertRow();
    for (const text of [f.name, f.locked ? 'L' : '', f.load, f.exec, f.length, f.start, String(f.sectors)]) {
      row.insertCell().textContent = text;
    }
  }
  box.append(table);
  if (side.problems.length > 0) {
    const list = element('ul', 'disc-problems');
    for (const p of side.problems) list.append(element('li', '', `⚠ ${p}`));
    box.append(list);
  }
  return box;
}

/** Drive 0, as the panel sees it. */
export interface DiscPanelDrive {
  insert(image: DiscImage): void;
  eject(): void;
}

export function createDiscPanel(drive?: DiscPanelDrive): DiscPanel {
  const root = element('div', 'disc-panel');

  const zone = element('label', 'disc-drop');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ssd,.dsd';
  input.className = 'disc-input';
  zone.append(element('span', '', 'Drop an .ssd or .dsd disc image here (or anywhere on the page), or choose one: '), input);

  const note = element(
    'p',
    'disc-note',
    drive === undefined ? 'Read only: just looked at.' : 'It goes into drive 0, read only. Type *CAT on the screen (*CAT 2 for side 1 of a .dsd).',
  );
  const status = element('p', 'disc-status');
  status.setAttribute('role', 'status');
  const inDrive = element('p', 'disc-in-drive', 'Drive 0: empty');
  const eject = element('button', 'disc-eject', 'Eject');
  eject.type = 'button';
  eject.disabled = true;
  eject.addEventListener('click', () => {
    drive?.eject();
    inDrive.textContent = 'Drive 0: empty';
    eject.disabled = true;
  });
  const shown = element('div', 'disc-shown');
  root.append(zone, note, status);
  if (drive !== undefined) {
    const row = element('div', 'disc-drive-row');
    row.append(inDrive, eject);
    root.append(row);
  }
  root.append(shown);

  async function load(file: File): Promise<void> {
    status.classList.remove('error');
    status.textContent = `Reading ${file.name}…`;
    // arrayBuffer() is the File API's I/O boundary: bytes, no cast needed.
    const view = discView(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!view.ok) {
      status.textContent = view.error;
      status.classList.add('error');
      shown.replaceChildren();
      return;
    }
    status.textContent = view.heading;
    shown.replaceChildren(...view.sides.map((side) => sideElement(side, view.sides.length)));
    if (drive !== undefined) {
      drive.insert(view.image);
      inDrive.textContent = `Drive 0: ${file.name}`;
      eject.disabled = false;
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) void load(file);
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', () => {
    zone.classList.remove('dragging');
    // The page-wide handler in main.ts does the loading.
  });

  return {
    title: 'Disc',
    element: root,
    refresh() {
      // Nothing to redraw: the disc is read-only, so it doesn't change while the machine runs.
    },
    load,
  };
}
