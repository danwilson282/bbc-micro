// The FDC panel (Stage 49): the 8271's status bits, the special registers
// the DFS sets, and the log of every command it has run. Stage 50 adds the
// drives (disc, head track) and the count of bytes that came by NMI.
//
// All decisions come from fdc-view-model.ts; this file only builds
// elements. The fixed parts are built once and only their text changes on
// refresh; the log's rows are a fixed set of FDC_ENTRIES_SHOWN, hidden
// while unused, so nothing flickers while the DFS polls.

import type { FdcLog } from '../../devices/fdc-log';
import type { DiscDrive } from '../../devices/disc-drive';
import type { Fdc8271 } from '../../devices/fdc8271';
import { FDC_ENTRIES_SHOWN, buildFdcView } from './fdc-view-model';
import type { Panel } from './panel';

function cell(row: HTMLTableRowElement, className: string): HTMLTableCellElement {
  const td = row.insertCell();
  td.className = className;
  return td;
}

export function createFdcPanel(fdc: Fdc8271, log: FdcLog, drives: readonly DiscDrive[] = []): Panel {
  const element = document.createElement('div');
  element.className = 'fdc-panel';

  const summary = document.createElement('p');
  summary.className = 'fdc-summary';

  const bitsBox = document.createElement('div');
  bitsBox.className = 'flags fdc-bits';
  bitsBox.setAttribute('aria-label', '8271 status bits');
  const bitChips: HTMLSpanElement[] = [];
  for (let i = 0; i < 6; i++) {
    const chip = document.createElement('span');
    chip.className = 'flag';
    bitsBox.append(chip);
    bitChips.push(chip);
  }

  const registers = document.createElement('table');
  registers.className = 'crtc-table fdc-registers';
  registers.setAttribute('aria-label', '8271 special registers');
  const registerBody = registers.createTBody();
  interface RegisterCells {
    readonly label: HTMLTableCellElement;
    readonly value: HTMLTableCellElement;
    readonly meaning: HTMLTableCellElement;
  }
  const registerCells: RegisterCells[] = [];

  const driveList = document.createElement('dl');
  driveList.className = 'fdc-drives';
  driveList.setAttribute('aria-label', 'Drives');
  const driveTexts: HTMLElement[] = [];
  for (let i = 0; i < drives.length; i++) {
    const dt = document.createElement('dt');
    dt.textContent = `Drive ${String(i)}`;
    const dd = document.createElement('dd');
    driveList.append(dt, dd);
    driveTexts.push(dd);
  }
  const transfer = document.createElement('p');
  transfer.className = 'fdc-transfer';

  const logHeading = document.createElement('p');
  logHeading.className = 'fdc-log-heading';
  logHeading.textContent = `Commands the 8271 ran (last ${String(FDC_ENTRIES_SHOWN)}, newest last; a repeat adds to its row):`;
  const empty = document.createElement('p');
  empty.className = 'fdc-empty';

  const commands = document.createElement('table');
  commands.className = 'crtc-table fdc-log';
  commands.setAttribute('aria-label', '8271 command log');
  const head = commands.createTHead().insertRow();
  for (const text of ['Time', 'Bytes', 'Drive', 'Command', '']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  const commandBody = commands.createTBody();
  interface EntryCells {
    readonly row: HTMLTableRowElement;
    readonly time: HTMLTableCellElement;
    readonly bytes: HTMLTableCellElement;
    readonly drive: HTMLTableCellElement;
    readonly text: HTMLTableCellElement;
    readonly repeats: HTMLTableCellElement;
  }
  const entryCells: EntryCells[] = [];
  for (let i = 0; i < FDC_ENTRIES_SHOWN; i++) {
    const row = commandBody.insertRow();
    row.hidden = true;
    entryCells.push({
      row,
      time: cell(row, 'hex'),
      bytes: cell(row, 'hex'),
      drive: cell(row, 'fdc-drive'),
      text: cell(row, 'meaning'),
      repeats: cell(row, 'hex fdc-repeats'),
    });
  }

  element.append(summary, bitsBox, registers, driveList, transfer, logHeading, empty, commands);

  function refresh(): void {
    const view = buildFdcView({
      status: fdc.status,
      result: fdc.result,
      inReset: fdc.inReset,
      driveLines: fdc.driveLines,
      special: (address) => fdc.special(address),
      entries: log.recent(FDC_ENTRIES_SHOWN),
      phase: fdc.currentPhase,
      drives: drives.map((d) => ({ disc: d.disc?.name, headTrack: d.headTrack })),
      bytesTransferred: fdc.bytesTransferred,
      lateBytes: fdc.lateBytes,
    });
    summary.textContent = view.summary;
    bitChips.forEach((chip, i) => {
      const bit = view.bits.at(i);
      if (bit === undefined) return;
      chip.textContent = bit.name;
      chip.title = bit.title;
      chip.classList.toggle('on', bit.on);
    });
    view.registers.forEach((r, i) => {
      let cells = registerCells.at(i);
      if (cells === undefined) {
        const row = registerBody.insertRow();
        const label = document.createElement('th');
        label.scope = 'row';
        row.append(label);
        cells = { label, value: cell(row, 'hex'), meaning: cell(row, 'meaning') };
        registerCells.push(cells);
      }
      cells.label.textContent = r.label;
      cells.value.textContent = r.value;
      cells.meaning.textContent = r.meaning;
    });
    view.drives.forEach((d, i) => {
      const dd = driveTexts.at(i);
      if (dd !== undefined) dd.textContent = d.text;
    });
    transfer.textContent = view.transfer;
    empty.textContent = view.empty;
    empty.hidden = view.empty === '';
    entryCells.forEach((c, i) => {
      const e = view.entries.at(i);
      c.row.hidden = e === undefined;
      c.time.textContent = e?.time ?? '';
      c.bytes.textContent = e?.bytes ?? '';
      c.drive.textContent = e?.drive ?? '';
      c.text.textContent = e?.text ?? '';
      c.repeats.textContent = e?.repeats ?? '';
    });
  }

  return { title: 'FDC (8271)', element, refresh };
}
