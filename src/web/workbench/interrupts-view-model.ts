// The interrupts panel's view-model: the state of the CPU's interrupt inputs,
// in words, and the three vectors at the top of memory.
//
//   IRQ line   held by the doorbell at &FC00
//   I flag     1: IRQs held off
//   NMI latch  clear
//   IRQ waiting: I = 1 holds it off until CLI or RTI clears I.
//   &FFFA NMI → &0430   &FFFC RESET → &0400   &FFFE IRQ/BRK → &040F
//
// No DOM here: interrupts-panel.ts turns this into elements, Jest tests this.

import { IRQ_VECTOR, NMI_VECTOR, RESET_VECTOR } from '../../cpu/cpu6502';
import { hex16, word } from '../../util/bits';
import type { InterruptTarget } from './debug-target';
import { DOORBELL } from '../../playground/doorbell';

export interface InterruptInput {
  readonly name: 'IRQ line' | 'I flag' | 'NMI latch';
  readonly value: string;
  /** Lit in the panel: the line is held, I is set, or the latch is set. */
  readonly active: boolean;
}

export interface VectorRow {
  /** e.g. "&FFFE". */
  readonly address: string;
  readonly name: 'NMI' | 'RESET' | 'IRQ/BRK';
  /** Where the vector points, e.g. "&040F". */
  readonly handler: string;
}

export interface InterruptsView {
  readonly lines: readonly InterruptInput[];
  /** What the next step will do, and why. */
  readonly verdict: string;
  readonly vectors: readonly VectorRow[];
}

type InterruptState = Pick<InterruptTarget, 'peek' | 'registers' | 'irqLine' | 'nmiPending' | 'pendingInterrupt'>;

export function buildInterruptsView(target: InterruptState): InterruptsView {
  const handlerAt = (vector: number): string => `&${hex16(word(target.peek(vector), target.peek(vector + 1)))}`;
  const i = target.registers.i;

  const lines: InterruptInput[] = [
    { name: 'IRQ line', value: target.irqLine ? `held by the doorbell at &${hex16(DOORBELL)}` : 'released', active: target.irqLine },
    { name: 'I flag', value: i ? '1: IRQs held off' : '0: IRQs allowed', active: i },
    { name: 'NMI latch', value: target.nmiPending ? 'set: an edge was seen' : 'clear', active: target.nmiPending },
  ];

  let verdict: string;
  if (target.pendingInterrupt === 'nmi') verdict = `Next step: NMI → ${handlerAt(NMI_VECTOR)}. I can’t hold it off.`;
  else if (target.pendingInterrupt === 'irq') verdict = `Next step: IRQ → ${handlerAt(IRQ_VECTOR)}. The handler must answer the doorbell, or it will be back.`;
  else if (target.irqLine) verdict = 'IRQ waiting: I = 1 holds it off until CLI or RTI clears I.';
  else verdict = 'Next step: an instruction. Nothing is asking.';

  const vectors: VectorRow[] = [
    { address: `&${hex16(NMI_VECTOR)}`, name: 'NMI', handler: handlerAt(NMI_VECTOR) },
    { address: `&${hex16(RESET_VECTOR)}`, name: 'RESET', handler: handlerAt(RESET_VECTOR) },
    { address: `&${hex16(IRQ_VECTOR)}`, name: 'IRQ/BRK', handler: handlerAt(IRQ_VECTOR) },
  ];

  return { lines, verdict, vectors };
}
