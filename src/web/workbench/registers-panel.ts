// The registers panel: A X Y S PC P (A, X and Y in binary too), the flag lights, the cycle count, and
// Step / Step ×16 / Run / Reset buttons.
//
// All decisions come from registers-view-model.ts; this file only builds
// elements and handles clicks.

import type { CpuTarget } from './debug-target';
import { button } from './dom';
import type { Panel } from './panel';
import { buildRegistersView, describeRun, stepMany, type RegistersView } from './registers-view-model';
import { createFrameClock, framesDue, resetClock } from '../frame-loop';
import { RUN_START, advanceRun, describeRunState, stopRun, type RunState } from './run-model';

export interface RegistersPanelOptions {
  /** Called after the CPU runs or resets, so every panel can redraw. */
  readonly onRun: () => void;
  /**
   * Called before Step, Step ×16, Run or Reset drives the CPU, so anything
   * else driving it (the frame loop, Stage 30) can stop first: one driver at a time.
   */
  readonly onTakeControl?: () => void;
}

export function createRegistersPanel(target: CpuTarget, options: RegistersPanelOptions): Panel & { stop(): void } {
  let previous: RegistersView | undefined;
  /** The Run in progress, if there is one, and its pending animation frame. */
  let running: RunState | undefined;
  let frame = 0;
  /** Real time (Stage 30): wall-clock time owed, in 20 ms frames, whatever the display's rate. */
  const clock = createFrameClock();

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
  const runButton = button('Run', 'Run until BRK');
  runButton.dataset.field = 'run';
  const reset = button('Reset', 'Reset the CPU');
  const message = document.createElement('span');
  message.className = 'cpu-message';
  message.setAttribute('role', 'status');
  controls.append(step, step16, runButton, reset, message);

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
      const binary = tr.insertCell();
      binary.className = 'binary';
      if (reg.binary !== '') {
        binary.setAttribute('aria-label', `${reg.name} in binary: ${reg.binary}`);
        binary.append('%');
        for (const b of reg.bits) {
          const span = document.createElement('span');
          span.className = 'bit';
          span.classList.toggle('on', b.on);
          span.classList.toggle('changed', b.changed);
          span.dataset.bit = String(b.bit);
          span.title = `bit ${String(b.bit)}${b.changed ? ': just changed' : ''}`;
          span.textContent = b.on ? '1' : '0';
          binary.append(span);
          if (b.bit === 4) binary.append(' ');
        }
      }
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
    options.onTakeControl?.();
    const result = stepMany(target, n);
    say(describeRun(result), result.error !== undefined);
    options.onRun();
  }

  /** Run and Stop share one button. Step is disabled while running: one driver of the CPU at a time. */
  function showRunning(isRunning: boolean): void {
    runButton.textContent = isRunning ? 'Stop' : 'Run';
    runButton.setAttribute('aria-label', isRunning ? 'Stop running' : 'Run until BRK');
    step.disabled = isRunning;
    step16.disabled = isRunning;
  }

  /**
   * One animation frame of a Run: as many 40,000-cycle frames as the time
   * since the last one covers (Stage 30's accumulator: 50 a second on any
   * display), then redraw everything (that's what makes the counter live).
   */
  function tick(now: number): void {
    if (running === undefined) return;
    const due = framesDue(clock, now);
    for (let i = 0; i < due && running.end === undefined; i++) running = advanceRun(target, running);
    if (due > 0) {
      say(describeRunState(running, target.registers.pc), running.end === 'error');
      options.onRun();
    }
    if (running.end === undefined) {
      frame = requestAnimationFrame(tick);
    } else {
      running = undefined;
      showRunning(false);
    }
  }

  /** Stops a Run between frames. The CPU is always between instructions then. */
  function stop(): void {
    if (running === undefined) return;
    cancelAnimationFrame(frame);
    say(describeRunState(stopRun(running), target.registers.pc));
    running = undefined;
    showRunning(false);
  }

  step.addEventListener('click', () => {
    run(1);
  });
  step16.addEventListener('click', () => {
    run(16);
  });
  runButton.addEventListener('click', () => {
    if (running !== undefined) {
      stop();
      return;
    }
    options.onTakeControl?.();
    running = RUN_START;
    showRunning(true);
    resetClock(clock);
    say(describeRunState(running, target.registers.pc));
    frame = requestAnimationFrame(tick);
  });
  reset.addEventListener('click', () => {
    stop();
    options.onTakeControl?.();
    target.reset();
    target.writes.clear();
    say('Reset: PC loaded from &FFFC/&FFFD');
    options.onRun();
  });

  return { title: 'Registers', element, refresh, stop };
}
