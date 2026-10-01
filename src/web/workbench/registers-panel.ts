// The registers panel: A X Y S PC P, the flag lights, the cycle count, and
// Step / Step ×16 / Reset buttons.
//
// All decisions come from registers-view-model.ts; this file only builds
// elements and handles clicks.

import type { CpuTarget } from './debug-target';
import { button } from './dom';
import type { Panel } from './panel';
import { buildRegistersView, stepMany, type RegistersView } from './registers-view-model';

export interface RegistersPanelOptions {
  /** Called after the CPU runs or resets, so every panel can redraw. */
  readonly onRun: () => void;
}

export function createRegistersPanel(target: CpuTarget, options: RegistersPanelOptions): Panel {
  let previous: RegistersView | undefined;

  const element = document.createElement('div');
  element.className = 'registers-panel';

  const table = document.createElement('table');
  table.className = 'registers-table';
  const body = table.createTBody();

  const flags = document.createElement('div');
  flags.className = 'flags';
  flags.setAttribute('aria-label', 'Status flags');

  const next = document.createElement('p');
  next.className = 'cpu-line';
  next.dataset.field = 'next';

  const cycles = document.createElement('p');
  cycles.className = 'cpu-line';
  cycles.dataset.field = 'cycles';

  const controls = document.createElement('div');
  controls.className = 'cpu-controls';
  const step = button('Step', 'Step one instruction');
  const step16 = button('Step ×16', 'Step 16 instructions');
  const reset = button('Reset', 'Reset the CPU');
  const message = document.createElement('span');
  message.className = 'cpu-message';
  message.setAttribute('role', 'status');
  controls.append(step, step16, reset, message);

  element.append(table, flags, next, cycles, controls);

  function say(text: string, isError = false): void {
    message.textContent = text;
    message.classList.toggle('error', isError);
  }

  function refresh(): void {
    const view = buildRegistersView(target, previous);
    previous = view;

    body.replaceChildren();
    for (const reg of view.registers) {
      const tr = body.insertRow();
      tr.dataset.register = reg.name;
      tr.classList.toggle('changed', reg.changed);
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = reg.name;
      const value = tr.insertCell();
      value.className = 'value';
      value.textContent = reg.hex;
      const detail = tr.insertCell();
      detail.className = 'detail';
      detail.textContent = reg.detail;
      tr.prepend(name);
    }

    flags.replaceChildren();
    for (const flag of view.flags) {
      const light = document.createElement('span');
      light.className = 'flag';
      light.classList.toggle('on', flag.on);
      light.classList.toggle('not-stored', !flag.stored);
      light.classList.toggle('changed', flag.changed);
      light.dataset.flag = flag.name;
      light.title = `${flag.title}: ${flag.on ? '1' : '0'}`;
      light.textContent = flag.name;
      flags.append(light);
    }

    next.textContent = `Next: ${view.next.text}`;
    cycles.textContent = `Cycles: ${view.cycles}`;
  }

  function run(n: number): void {
    const result = stepMany(target, n);
    if (result.error !== undefined) {
      say(result.steps > 0 ? `Ran ${String(result.steps)}, then stopped: ${result.error}` : result.error, true);
    } else {
      say(`Ran ${String(result.steps)} (${String(result.cycles)} cycles)`);
    }
    options.onRun();
  }

  step.addEventListener('click', () => {
    run(1);
  });
  step16.addEventListener('click', () => {
    run(16);
  });
  reset.addEventListener('click', () => {
    target.reset();
    say('Reset: PC loaded from &FFFC/&FFFD');
    options.onRun();
  });

  return { title: 'Registers', element, refresh };
}
