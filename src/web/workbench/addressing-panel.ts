// The addressing-mode explorer: choose a mode, an operand and X/Y, and see
// each step the 6502 takes to find the effective address.
//
// All the reasoning is in addressing-view-model.ts. This file builds the form,
// re-explains on every keystroke, and redraws on refresh() (so a poke in the
// memory panel shows up straight away). It only peeks: exploring never
// changes memory or registers.

import { MODES, type AddressingMode } from '../../cpu/addressing';
import { hex8 } from '../../util/bits';
import { PRESETS, explainAddressing, parseExplorerInput, type ExplorerFields } from './addressing-view-model';
import type { CpuTarget } from './debug-target';
import { button } from './dom';
import type { Panel } from './panel';

/** A labelled text input: "X [&05]". */
function field(label: string, name: string, value: string, size: number): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.className = 'explorer-field';
  const input = document.createElement('input');
  input.name = name;
  input.value = value;
  input.size = size;
  input.spellcheck = false;
  wrap.append(`${label} `, input);
  return { wrap, input };
}

export function createAddressingPanel(target: CpuTarget): Panel {
  const element = document.createElement('div');
  element.className = 'addressing-panel';

  // --- Inputs ---------------------------------------------------------------
  const form = document.createElement('form');
  form.className = 'explorer-form';

  const modeLabel = document.createElement('label');
  modeLabel.className = 'explorer-field';
  const mode = document.createElement('select');
  mode.name = 'mode';
  for (const [key, info] of Object.entries(MODES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${info.name}${info.syntax === '' ? '' : `  ${info.syntax}`}`;
    mode.append(option);
  }
  mode.value = 'indirectIndexedY' satisfies AddressingMode;
  modeLabel.append('Mode ', mode);

  const r = target.registers;
  const operand = field('Operand', 'operand', '&70', 7);
  const x = field('X', 'x', `&${hex8(r.x)}`, 4);
  const y = field('Y', 'y', `&${hex8(r.y)}`, 4);
  const a = field('A', 'a', `&${hex8(r.a)}`, 4);
  const pc = field('At', 'pc', '&0400', 6);
  form.append(modeLabel, operand.wrap, x.wrap, y.wrap, a.wrap, pc.wrap);

  const presets = document.createElement('div');
  presets.className = 'explorer-presets';
  presets.append('Try: ');

  // --- Output ---------------------------------------------------------------
  const heading = document.createElement('p');
  heading.className = 'explorer-instruction';
  const steps = document.createElement('ol');
  steps.className = 'explorer-steps';
  const result = document.createElement('p');
  result.className = 'explorer-result';
  result.setAttribute('role', 'status');
  const cycles = document.createElement('p');
  cycles.className = 'explorer-cycles';

  element.append(form, presets, heading, steps, result, cycles);

  function fields(): ExplorerFields {
    return { mode: mode.value, operand: operand.input.value, a: a.input.value, x: x.input.value, y: y.input.value, pc: pc.input.value };
  }

  function refresh(): void {
    const parsed = parseExplorerInput(fields());
    if (!parsed.ok) {
      heading.textContent = '';
      steps.replaceChildren();
      result.textContent = parsed.error;
      result.classList.add('error');
      cycles.textContent = '';
      return;
    }
    const noOperand = MODES[parsed.input.mode].operandBytes === 0;
    operand.input.disabled = noOperand;
    a.input.disabled = parsed.input.mode !== 'accumulator';

    const e = explainAddressing(parsed.input, (address) => target.peek(address));
    heading.replaceChildren();
    const code = document.createElement('code');
    code.textContent = e.instruction;
    const bytes = document.createElement('span');
    bytes.className = 'explorer-bytes';
    bytes.textContent = e.bytes;
    heading.append(code, bytes);

    steps.replaceChildren(
      ...e.steps.map((step) => {
        const li = document.createElement('li');
        li.textContent = step.text;
        li.classList.toggle('warn', step.warn);
        return li;
      }),
    );
    result.textContent = e.result;
    result.classList.remove('error');
    cycles.textContent = `${e.instruction}: ${e.cycles}`;
  }

  for (const preset of PRESETS) {
    const b = button(preset.label, `Example: ${preset.label}`);
    b.addEventListener('click', () => {
      mode.value = preset.fields.mode;
      operand.input.value = preset.fields.operand;
      a.input.value = preset.fields.a;
      x.input.value = preset.fields.x;
      y.input.value = preset.fields.y;
      pc.input.value = preset.fields.pc;
      refresh();
    });
    presets.append(b);
  }

  form.addEventListener('input', refresh);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    refresh();
  });

  return { title: 'Addressing modes', element, refresh };
}
