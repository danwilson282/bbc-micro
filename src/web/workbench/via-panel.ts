// The VIA panel (Stage 24): one 6522 at a time, picked with the buttons at
// the top (System VIA or User VIA).
//
//   - The register table: all 16, with what a CPU read would return now.
//     Registers that are still stubs are greyed, with the stage that builds them.
//   - The timers (Stage 25): T1 and T2's counters, with a bar draining as they
//     count down, their latches, modes and IFR flags.
//   - Interrupts (Stage 26): IFR bits 6-0, each with its flag, its IER enable,
//     and whether it is the reason /IRQ is low. Then the control lines CA1-CB2:
//     their PCR mode, level, and (for inputs) a button to pull them low.
//   - A bit grid per port, PA7 … PA0 and PB7 … PB0: the DDR bit (out/in), the
//     output register, the outside world, the pin, and what the CPU reads.
//     Each "outside" cell is a button: click it to pull that line low (or let go).
//
// The decisions are in via-view-model.ts; this file only builds elements.

import { button } from './dom';
import type { Panel } from './panel';
import {
  buildViaView,
  toggleControlLine,
  toggleOutsideBit,
  type ViaChoice,
  type ViaControlLines,
  type ViaControlLineView,
  type ViaInterruptRow,
  type ViaLine,
  type ViaOutside,
  type ViaPortView,
  type ViaTimerRow,
} from './via-view-model';

export interface ViaPanelChoice extends ViaChoice {
  readonly via: ViaChoice['via'] & ViaOutside & ViaControlLines;
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

  const timers = document.createElement('table');
  timers.className = 'via-table via-timers';
  timers.createCaption().textContent = 'Timers (1 count = 1 µs: the VIAs run at 1 MHz)';
  timers.createTHead().insertRow().append(th('Timer'), th('Counter'), th(''), th('Latch'), th('Mode'), th('Armed'), th('IFR flag'));
  const timerBody = timers.createTBody();
  const ifrLine = document.createElement('p');
  ifrLine.className = 'via-ifr';

  const interrupts = document.createElement('table');
  interrupts.className = 'via-table via-interrupts';
  const interruptsCaption = interrupts.createCaption();
  interrupts.createTHead().insertRow().append(th('Bit'), th('Source'), th('Wired to'), th('IFR flag'), th('IER enable'), th('→ IRQ'));
  const interruptBody = interrupts.createTBody();

  const controls = document.createElement('table');
  controls.className = 'via-table via-control-lines';
  controls.createCaption().textContent = 'Control lines (modes set by the PCR)';
  controls.createTHead().insertRow().append(th('Line'), th('Mode'), th('Wired to'), th('Level'), th('Outside'));
  const controlBody = controls.createTBody();

  const ports = document.createElement('div');
  ports.className = 'via-ports';

  const note = document.createElement('p');
  note.className = 'via-note';
  note.textContent = 'Nothing is wired to the pins yet. Click an "outside" bit or a control line to pull it low, as a switch to ground would.';

  element.append(picker, registers, timers, ifrLine, interrupts, controls, ports, note);

  function interruptRow(r: ViaInterruptRow): void {
    const tr = interruptBody.insertRow();
    tr.dataset.source = r.name;
    tr.classList.toggle('firing', r.firing);
    tr.classList.toggle('stub', !r.isBuilt);
    cell(tr, String(r.bit), 'mono');
    cell(tr, `${r.name}: ${r.source}`);
    cell(tr, r.wiredTo, 'wired');
    cell(tr, String(r.flag), r.flag === 1 ? 'mono ifr-bit set' : 'mono ifr-bit');
    cell(tr, String(r.enabled), r.enabled === 1 ? 'mono ier-bit set' : 'mono ier-bit');
    cell(tr, r.firing ? 'yes' : '', 'firing');
  }

  // The control-line rows are built once and updated in place. During Run the
  // panel refreshes every frame; a button rebuilt that often is replaced
  // between mouse-down and mouse-up, and the click is lost.
  const controlRows = (['ca1', 'ca2', 'cb1', 'cb2'] as const).map((line) => {
    const tr = controlBody.insertRow();
    tr.dataset.line = line.toUpperCase();
    const name = tr.insertCell();
    const mode = tr.insertCell();
    const wired = tr.insertCell();
    const level = tr.insertCell();
    const outside = tr.insertCell();
    const b = button('pull low', `Pull ${line.toUpperCase()} low`);
    b.addEventListener('click', () => {
      const choice = choices.at(current);
      if (choice === undefined) return;
      toggleControlLine(choice.via, line);
      options.onChange?.();
      refresh();
    });
    const driven = document.createElement('span');
    driven.textContent = 'driven by the VIA';
    return { name, mode, wired, level, outside, button: b, driven };
  });

  function updateControlRow(row: (typeof controlRows)[number], c: ViaControlLineView): void {
    row.name.textContent = c.name;
    row.name.className = 'mono';
    row.mode.textContent = c.mode;
    row.mode.className = 'mode';
    row.wired.textContent = c.wiredTo;
    row.wired.className = 'wired';
    row.level.textContent = String(c.level);
    row.level.className = c.level === 0 ? 'mono level low' : 'mono level';
    if (!c.isInput) {
      row.outside.className = 'driven';
      if (row.outside.firstChild !== row.driven) row.outside.replaceChildren(row.driven);
      return;
    }
    const pulled = c.level === 0;
    row.button.textContent = pulled ? 'let go' : 'pull low';
    row.button.setAttribute('aria-label', pulled ? `Let go of ${c.name}` : `Pull ${c.name} low`);
    row.button.className = pulled ? 'via-outside pulled' : 'via-outside';
    row.button.setAttribute('aria-pressed', String(pulled));
    row.outside.className = '';
    if (row.outside.firstChild !== row.button) row.outside.replaceChildren(row.button);
  }

  function timerRow(t: ViaTimerRow): void {
    const tr = timerBody.insertRow();
    tr.dataset.timer = t.name;
    cell(tr, t.name);
    cell(tr, `${t.counter} = ${t.decimal}`, 'mono counter');
    const barCell = tr.insertCell();
    const bar = document.createElement('div');
    bar.className = 'via-timer-bar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('div');
    fill.style.width = `${(t.fraction * 100).toFixed(1)}%`;
    bar.append(fill);
    barCell.append(bar);
    cell(tr, t.latch, 'mono latch');
    cell(tr, t.pb7 === '' ? t.mode : `${t.mode}; ${t.pb7}`, 'mode');
    cell(tr, t.armed ? 'yes' : 'no', 'armed');
    cell(tr, `bit ${String(t.flagBit)} = ${t.flag ? '1' : '0'}`, t.flag ? 'ifr-flag set' : 'ifr-flag');
  }

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

    // A line Timer 1 drives (PB7 with ACR bit 7) shows "T1" and the timer's level.
    bitRow(view.ddrName, 'ddr', view.hex.ddr, (l) => (l.timer1 ? 'T1' : l.isOutput ? 'out' : 'in'), (l) => (l.timer1 ? 'timer' : ''));
    bitRow(view.orName, 'or', view.hex.or, (l) => String(l.or), (l) => (l.timer1 ? 'timer' : l.isOutput ? '' : 'unused'));

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
      cell(tr, r.status === 'built' ? '' : r.status, 'status');
    }

    timerBody.replaceChildren();
    for (const t of view.timers) timerRow(t);
    ifrLine.textContent = `Read T1C-L / T2C-L, or write a 1 to the IFR bit, to clear a timer's flag.`;

    interruptsCaption.textContent = `Interrupts: IFR ${view.ifr}, IER ${view.ier}. /IRQ is ${view.irq ? 'LOW: this VIA wants attention' : 'released'}`;
    interrupts.classList.toggle('irq', view.irq);
    interruptBody.replaceChildren();
    for (const r of view.interrupts) interruptRow(r);

    view.controlLines.forEach((c, i) => {
      const row = controlRows.at(i);
      if (row !== undefined) updateControlRow(row, c);
    });

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
