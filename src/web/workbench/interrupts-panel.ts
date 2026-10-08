// The interrupts panel: IRQ and NMI buttons, the state of the CPU's interrupt
// inputs in words, and the three vectors.
//
//   [IRQ] rings the doorbell at &FC00: IRQ stays held until the handler answers
//   [NMI] pulses /NMI: one falling edge, so one NMI
//
// All decisions come from interrupts-view-model.ts; this file only builds
// elements and handles clicks. A press during Run is picked up by the next
// frame's steps.

import type { InterruptTarget } from './debug-target';
import { button } from './dom';
import { buildInterruptsView } from './interrupts-view-model';
import type { Panel } from './panel';

export interface InterruptsPanelOptions {
  /** Called after a button press, so every panel can redraw. */
  readonly onChange: () => void;
}

export function createInterruptsPanel(target: InterruptTarget, options: InterruptsPanelOptions): Panel {
  const element = document.createElement('div');
  element.className = 'interrupts-panel';

  const controls = document.createElement('div');
  controls.className = 'cpu-controls';
  const irq = button('IRQ', 'Ring the doorbell: hold IRQ until the handler answers');
  irq.title = 'Rings the doorbell at &FC00. It holds the IRQ line until the handler writes to &FC00.';
  const nmi = button('NMI', 'Pulse NMI: one falling edge');
  nmi.title = 'Pulls /NMI low and lets it go: one edge, so one NMI, whatever I says.';
  controls.append(irq, nmi);

  const inputs = document.createElement('dl');
  inputs.className = 'interrupt-inputs';

  const verdict = document.createElement('p');
  verdict.className = 'interrupt-verdict';
  verdict.dataset.field = 'verdict';

  const vectors = document.createElement('table');
  vectors.className = 'vector-table';
  vectors.setAttribute('aria-label', 'Vectors');
  const vectorBody = vectors.createTBody();

  element.append(controls, inputs, verdict, vectors);

  function refresh(): void {
    const view = buildInterruptsView(target);
    inputs.replaceChildren();
    for (const line of view.lines) {
      const dt = document.createElement('dt');
      dt.textContent = line.name;
      const dd = document.createElement('dd');
      dd.textContent = line.value;
      dd.dataset.input = line.name;
      dd.classList.toggle('active', line.active);
      inputs.append(dt, dd);
    }
    verdict.textContent = view.verdict;
    vectorBody.replaceChildren();
    for (const row of view.vectors) {
      const tr = vectorBody.insertRow();
      tr.dataset.vector = row.name;
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row.address;
      tr.append(th);
      tr.insertCell().textContent = row.name;
      const handler = tr.insertCell();
      handler.className = 'handler';
      handler.textContent = `→ ${row.handler}`;
    }
  }

  irq.addEventListener('click', () => {
    target.ringIrq();
    options.onChange();
  });
  nmi.addEventListener('click', () => {
    target.pulseNmi();
    options.onChange();
  });

  return { title: 'Interrupts', element, refresh };
}
