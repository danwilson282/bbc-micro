// The VIA panel (Stage 24): one 6522 at a time, picked with the buttons at
// the top (System VIA or User VIA).
//
//   - The register table: all 16, with what a CPU read would return now.
//     Registers that are still stubs are greyed, with the stage that builds them.
//   - A bit grid per port, PA7 … PA0 and PB7 … PB0: the DDR bit (out/in), the
//     output register, the outside world, the pin, and what the CPU reads.
//     Each "outside" cell is a button: click it to pull that line low (or let go).
//
// The decisions are in via-view-model.ts; this file only builds elements.

import { button } from './dom';
import type { Panel } from './panel';
import { buildViaView, toggleOutsideBit, type ViaChoice, type ViaLine, type ViaOutside, type ViaPortView } from './via-view-model';

export interface ViaPanelChoice extends ViaChoice {
  readonly via: ViaChoice['via'] & ViaOutside;
}

export interface ViaPanelOptions {
  /** Which VIA to show first: an index into the choices. */
  readonly initial?: number;
  /** After a pull-low button changes a pin: redraw everything (other panels may show it). */
  readonly onChange?: () => void;
}

export function createViaPanel(choices: readonly ViaPanelChoice[], options: ViaPanelOptions = {}): Panel {
  let current = options.initial ?? 0;

  const element = document.createElement('div');
  element.className = 'via-panel';

  const picker = document.createElement('div');
  picker.className = 'via-picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Which VIA');
  const pickButtons = choices.map((choice, index) => {
    const b = button(choice.name, `Show the ${choice.name}`);
    b.addEventListener('click', () => {
      current = index;
      refresh();
    });
    picker.append(b);
    return b;
  });

  const registers = document.createElement('table');
  registers.className = 'via-table via-registers';
  registers.createTHead().insertRow().append(th('Reg'), th('Address'), th('Name'), th('Reads'), th('Binary'), th(''));
  const registerBody = registers.createTBody();

  const ports = document.createElement('div');
  ports.className = 'via-ports';

  const note = document.createElement('p');
  note.className = 'via-note';
  note.textContent = 'Nothing is wired to the pins yet. Click an "outside" bit to pull that line low, as a switch to ground would.';

  element.append(picker, registers, ports, note);

  function portGrid(view: ViaPortView, via: ViaOutside): HTMLElement {
    const table = document.createElement('table');
    table.className = 'via-table via-port';
    table.dataset.port = view.port;
    const caption = table.createCaption();
    caption.textContent = view.label;
    const head = table.createTHead().insertRow();
    head.append(th(''));
    for (const line of view.lines) {
      const h = th(line.name);
      h.className = line.isOutput ? 'out' : 'in';
      head.append(h);
    }
    head.append(th(''));
    const body = table.createTBody();

    const bitRow = (label: string, field: string, hexValue: string, value: (line: ViaLine) => string, classes?: (line: ViaLine) => string): void => {
      const tr = body.insertRow();
      tr.dataset.row = field;
      const h = document.createElement('th');
      h.scope = 'row';
      h.textContent = label;
      tr.append(h);
      for (const line of view.lines) {
        const td = tr.insertCell();
        td.textContent = value(line);
        td.className = `bit ${line.isOutput ? 'out' : 'in'} ${classes?.(line) ?? ''}`.trim();
      }
      const hexCell = tr.insertCell();
      hexCell.className = 'hex';
      hexCell.textContent = hexValue;
    };

    bitRow(view.ddrName, 'ddr', view.hex.ddr, (l) => (l.isOutput ? 'out' : 'in'));
    bitRow(view.orName, 'or', view.hex.or, (l) => String(l.or), (l) => (l.isOutput ? '' : 'unused'));

    // The outside row: one button per line.
    const outsideRow = body.insertRow();
    outsideRow.dataset.row = 'outside';
    const outsideHead = document.createElement('th');
    outsideHead.scope = 'row';
    outsideHead.textContent = 'Outside';
    outsideRow.append(outsideHead);
    for (const line of view.lines) {
      const td = outsideRow.insertCell();
      td.className = 'bit';
      const pulled = line.outside === 0;
      const b = button(pulled ? '0' : '1', pulled ? `Let go of ${line.name}` : `Pull ${line.name} low`);
      b.className = pulled ? 'via-outside pulled' : 'via-outside';
      b.setAttribute('aria-pressed', String(pulled));
      b.addEventListener('click', () => {
        toggleOutsideBit(via, view.port, line.bit);
        options.onChange?.();
        refresh();
      });
      td.append(b);
    }
    const outsideHex = outsideRow.insertCell();
    outsideHex.className = 'hex';
    outsideHex.textContent = view.hex.outside;

    bitRow('Pin', 'pins', view.hex.pins, (l) => String(l.pin), (l) => (l.pin === 0 ? 'low' : 'high'));
    bitRow(`CPU reads ${view.readName}`, 'read', view.hex.read, (l) => String(l.read), (l) => `from-${l.readFrom}`);
    return table;
  }

  function refresh(): void {
    const choice = choices.at(current);
    if (choice === undefined) return;
    const view = buildViaView(choice);

    pickButtons.forEach((b, index) => {
      b.setAttribute('aria-pressed', String(index === current));
    });

    registerBody.replaceChildren();
    for (const r of view.registers) {
      const tr = registerBody.insertRow();
      tr.dataset.register = String(r.number);
      tr.classList.toggle('stub', r.isStub);
      cell(tr, `&${r.number.toString(16).toUpperCase()}`, 'mono');
      cell(tr, r.address, 'mono');
      cell(tr, r.name);
      cell(tr, r.value, 'mono value');
      cell(tr, r.binary, 'mono');
      cell(tr, r.isStub ? r.status : '', 'status');
    }

    ports.replaceChildren(...view.ports.map((pv) => portGrid(pv, choice.via)));
  }

  return { title: 'VIA', element, refresh };
}

function th(text: string): HTMLTableCellElement {
  const h = document.createElement('th');
  h.textContent = text;
  return h;
}

function cell(tr: HTMLTableRowElement, text: string, className?: string): void {
  const td = tr.insertCell();
  td.textContent = text;
  if (className !== undefined) td.className = className;
}
