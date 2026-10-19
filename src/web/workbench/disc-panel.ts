// The Disc panel (Stage 48): drop an .ssd or .dsd (or choose one) and see
// its DFS catalogue as *CAT would print it, with every file's *INFO numbers.
//
// The reasoning is in disc-view-model.ts. Since Stage 50 the disc also goes
// into a drive (through `machine`, so this file doesn't know the machine),
// and *CAT on the emulator's screen reads it.
//
// Stage 51 makes it the drive UI: two drives, each with Eject, a write
// protect tab and Download (once the DFS has written to the disc); a demo
// disc and a blank disc, made by our own tools; and SHIFT-BREAK, to boot
// drive 0. The catalogue shown is the chosen drive's, redrawn when its disc
// changes, so a SAVE shows up at once.
//
// main.ts sends drops anywhere on the page here too, so a near miss doesn't
// make the browser leave the emulator to show the file.

import { buildBlankDisc, buildDemoDisc } from '../../disc/demo-disc';
import type { DiscImage } from '../../disc/disc-image';
import { discImageView, discView, driveRowView, type DiscSideView, type PanelDrive } from './disc-view-model';
import { button } from './dom';
import type { Panel } from './panel';

export interface DiscPanel extends Panel {
  /** Reads a dropped or chosen file, shows its catalogue, and puts it in the chosen drive. */
  load(file: File): Promise<void>;
}

/** A drive as the panel works it: a DiscDrive. */
export interface PanelDriveControl extends PanelDrive {
  setWriteProtected(on: boolean): void;
}

/** What the panel needs from the machine. */
export interface DiscPanelMachine {
  readonly drives: readonly [PanelDriveControl, PanelDriveControl];
  insert(drive: 0 | 1, image: DiscImage): void;
  eject(drive: 0 | 1): void;
  /** Holds SHIFT, taps BREAK: the disc in drive 0 boots. */
  shiftBreak(): void;
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
  if (sides > 1) box.append(element('h3', 'disc-drive', `Drive ${String(side.drive)} (side ${String(side.drive >> 1)})`));
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

/** Saves the disc as it is now: the browser's download, since a page can't write to the file it was given. */
function download(image: DiscImage): void {
  const url = URL.createObjectURL(new Blob([image.bytes()], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = image.name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

interface DriveRow {
  readonly element: HTMLElement;
  update(): void;
}

function driveRow(machine: DiscPanelMachine, n: 0 | 1, onChange: () => void): DriveRow {
  const drive = machine.drives[n];
  const row = element('div', 'disc-drive-row');
  row.dataset.drive = String(n);
  const name = element('p', 'disc-in-drive');
  const changed = element('span', 'disc-changed');
  const tabLabel = element('label', 'disc-protect');
  const tab = document.createElement('input');
  tab.type = 'checkbox';
  tab.setAttribute('aria-label', `Write protect drive ${String(n)}`);
  tabLabel.append(tab, ' Write protect');
  const save = button('Download', `Download the disc in drive ${String(n)}`);
  const eject = button('Eject', `Eject drive ${String(n)}`);
  row.append(name, changed, tabLabel, save, eject);

  tab.addEventListener('change', () => {
    drive.setWriteProtected(tab.checked);
  });
  save.addEventListener('click', () => {
    if (drive.disc !== undefined) download(drive.disc);
  });
  eject.addEventListener('click', () => {
    machine.eject(n);
    onChange();
  });

  // Only touch the DOM when something changed: refresh runs every frame.
  let shown = '';
  function update(): void {
    const view = driveRowView(drive, n);
    const key = `${view.text}|${view.changed}|${String(view.writeProtected)}`;
    if (key === shown) return;
    shown = key;
    name.textContent = view.text;
    changed.textContent = view.changed;
    tab.checked = view.writeProtected;
    tab.disabled = !view.hasDisc;
    save.disabled = !view.downloadable;
    eject.disabled = !view.hasDisc;
  }
  update();
  return { element: row, update };
}

export function createDiscPanel(machine?: DiscPanelMachine): DiscPanel {
  const root = element('div', 'disc-panel');

  const zone = element('label', 'disc-drop');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ssd,.dsd';
  input.className = 'disc-input';
  zone.append(element('span', '', 'Drop an .ssd or .dsd disc image here (or anywhere on the page), or choose one: '), input);

  const status = element('p', 'disc-status');
  status.setAttribute('role', 'status');
  const shown = element('div', 'disc-shown');

  if (machine === undefined) {
    root.append(zone, element('p', 'disc-note', 'Read only: just looked at.'), status, shown);
  }

  /** The drive that loads go into and whose catalogue is shown. */
  let chosen: 0 | 1 = 0;
  /** What the catalogue view last drew: a disc and its change count. */
  let drawn: DiscImage | undefined;
  let drawnChanges = -1;

  function show(image: DiscImage | undefined): void {
    drawn = image;
    drawnChanges = image?.changes ?? -1;
    if (image === undefined) {
      shown.replaceChildren(element('p', 'disc-note', `Drive ${String(chosen)} is empty.`));
      return;
    }
    const view = discImageView(image, chosen);
    shown.replaceChildren(...view.sides.map((side) => sideElement(side, view.sides.length)));
  }

  const rows: DriveRow[] = [];
  if (machine !== undefined) {
    const pick = document.createElement('select');
    pick.className = 'disc-pick';
    pick.setAttribute('aria-label', 'Drive');
    for (const n of [0, 1]) pick.append(new Option(`Drive ${String(n)}`, String(n)));
    pick.addEventListener('change', () => {
      chosen = pick.value === '1' ? 1 : 0;
      show(machine.drives[chosen].disc);
    });
    const pickLabel = element('label', 'disc-pick-label', 'Into, and showing: ');
    pickLabel.append(pick);

    const demo = button('Demo disc', 'Insert the demo disc');
    const blank = button('Blank disc', 'Insert a blank disc');
    const boot = button('SHIFT-BREAK', 'SHIFT-BREAK: boot the disc in drive 0');
    const insertMade = (bytes: Uint8Array, name: string): void => {
      const view = discView(bytes, name);
      if (!view.ok) return;
      insertShown(view.image, view.heading);
    };
    demo.addEventListener('click', () => {
      insertMade(buildDemoDisc(), 'demo.ssd');
    });
    blank.addEventListener('click', () => {
      insertMade(buildBlankDisc(), 'blank.ssd');
    });
    boot.addEventListener('click', () => {
      machine.shiftBreak();
    });

    const tools = element('div', 'disc-tools');
    tools.append(pickLabel, demo, blank, boot);
    const note = element(
      'p',
      'disc-note',
      'A disc goes into the chosen drive. Type *CAT on the screen (*CAT 2 for side 1 of a .dsd), or SHIFT-BREAK to boot drive 0. ' +
        'SAVE writes to the disc here, not to your file: Download saves the changed disc.',
    );
    rows.push(driveRow(machine, 0, refresh), driveRow(machine, 1, refresh));
    root.append(zone, tools, note, status, ...rows.map((r) => r.element), shown);
  }

  function insertShown(image: DiscImage, heading: string): void {
    status.classList.remove('error');
    status.textContent = heading;
    if (machine === undefined) {
      show(image);
      return;
    }
    machine.insert(chosen, image);
    refresh();
  }

  async function load(file: File): Promise<void> {
    status.classList.remove('error');
    status.textContent = `Reading ${file.name}…`;
    // arrayBuffer() is the File API's I/O boundary: bytes, no cast needed.
    const view = discView(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!view.ok) {
      status.textContent = view.error;
      status.classList.add('error');
      shown.replaceChildren();
      drawn = undefined;
      return;
    }
    insertShown(view.image, view.heading);
  }

  function refresh(): void {
    for (const r of rows) r.update();
    if (machine === undefined) return;
    const disc = machine.drives[chosen].disc;
    if (disc !== drawn || (disc !== undefined && disc.changes !== drawnChanges)) show(disc);
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
    refresh,
    load,
  };
}
