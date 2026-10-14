// The buttons under the screen (MOS mode): Pause / Run, Step frame, BREAK,
// Power on, Test page (Stages 32-33), and a status line saying how fast it's really going.
//
// It only builds elements and reports clicks. main.ts decides what they do.

import type { SpeedMeter } from './frame-loop';
import { button } from './workbench/dom';

export interface RunControlsActions {
  /** Pause if running, run if paused. */
  onToggle(): void;
  onStepFrame(): void;
  /** The BREAK key: the CPU's reset only (Stage 27). */
  onBreak(): void;
  /** Switch off and on: every chip reset. */
  onPowerOn(): void;
  /** Poke the next teletext test page (Stages 32-33) into screen memory. */
  onTestPage(): void;
}

export interface RunControls {
  readonly element: HTMLElement;
  /** Shows the state: the toggle's label, and the status line. */
  update(running: boolean, frames: number, speed: SpeedMeter): void;
  /** A message instead of the status line, e.g. an error. Cleared by the next update. */
  say(text: string, isError?: boolean): void;
}

function speedText(speed: SpeedMeter): string {
  if (speed.framesPerSecond === undefined || speed.percent === undefined || speed.callbacksPerSecond === undefined) return 'measuring speed…';
  return `${String(speed.framesPerSecond)} frames/s (${String(speed.percent)}%), display ${String(speed.callbacksPerSecond)} Hz`;
}

export function createRunControls(actions: RunControlsActions): RunControls {
  const element = document.createElement('div');
  element.className = 'run-controls';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Machine');

  const toggle = button('Pause', 'Pause the machine');
  toggle.dataset.field = 'toggle';
  const stepFrame = button('Step frame', 'Run one 20 ms frame (40,000 cycles)');
  const breakKey = button('BREAK', 'Press BREAK (reset the CPU only)');
  const powerOn = button('Power on', 'Switch off and on again (reset every chip)');
  const testPage = button('Test page', 'Show the next teletext test page (pokes screen memory)');
  const status = document.createElement('span');
  status.className = 'run-status';
  status.setAttribute('role', 'status');
  element.append(toggle, stepFrame, breakKey, powerOn, testPage, status);

  toggle.addEventListener('click', () => {
    actions.onToggle();
  });
  stepFrame.addEventListener('click', () => {
    actions.onStepFrame();
  });
  breakKey.addEventListener('click', () => {
    actions.onBreak();
  });
  powerOn.addEventListener('click', () => {
    actions.onPowerOn();
  });
  testPage.addEventListener('click', () => {
    actions.onTestPage();
  });

  return {
    element,
    update(running, frames, speed) {
      toggle.textContent = running ? 'Pause' : 'Run';
      toggle.setAttribute('aria-label', running ? 'Pause the machine' : 'Run the machine in real time');
      element.classList.toggle('running', running);
      status.classList.remove('error');
      const count = `frame ${frames.toLocaleString('en-GB')}`;
      status.textContent = running ? `Running: ${speedText(speed)} · ${count}` : `Paused at ${count}`;
    },
    say(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('error', isError);
    },
  };
}
