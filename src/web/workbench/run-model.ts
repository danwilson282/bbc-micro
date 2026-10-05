// The Run button's logic: run the CPU until it reaches a BRK, an
// unimplemented opcode, or a cycle limit. It runs a frame at a time, so the
// page can redraw in between and the cycle counter ticks while you watch.
//
//   click Run ─▶ advanceRun ─▶ redraw ─▶ next animation frame ─▶ advanceRun …
//                 (40,000 cycles)                                  until end ≠ undefined
//
// BRK is Stage 17, so &00 is still unimplemented. Every playground program
// ends at one, though (its own, or the &00 at &0500 after the NOP slide), so
// Run treats "the next opcode is BRK" as a clean stop, the way a debugger's
// "run until break" does: PC is left on the BRK, which hasn't run.
//
// DOM-free, so Jest tests it; registers-panel.ts does the animation frames.

import { UnimplementedOpcodeError } from '../../cpu/cpu6502';
import { hex16 } from '../../util/bits';
import type { CpuTarget } from './debug-target';
import { formatCycles } from './registers-view-model';

/** BRK's opcode (MCS6500 Programming Manual, Appendix B). Run stops before it. */
export const BRK_OPCODE = 0x00;
/** One 50 Hz PAL video frame of the Model B's 2 MHz 6502: 2,000,000 / 50. */
export const CYCLES_PER_FRAME = 40_000;
/** Run gives up after 10 seconds of emulated time, in case a loop never ends. */
export const RUN_CYCLE_LIMIT = 20_000_000;

/** Why runFor came back. */
export type SliceStop = 'brk' | 'budget' | 'error';

export interface RunSlice {
  readonly steps: number;
  readonly cycles: number;
  readonly stop: SliceStop;
  /** The unimplemented-opcode message, if stop is 'error'. */
  readonly error: string | undefined;
}

/**
 * Runs whole instructions until maxCycles have been used (the last one may
 * overshoot by a few), the next opcode is BRK, or an unimplemented opcode
 * stops the CPU. Any other error is a real bug and is rethrown.
 */
export function runFor(target: CpuTarget, maxCycles: number): RunSlice {
  let steps = 0;
  let cycles = 0;
  try {
    while (cycles < maxCycles) {
      if (target.peek(target.registers.pc) === BRK_OPCODE) return { steps, cycles, stop: 'brk', error: undefined };
      cycles += target.step();
      steps++;
    }
  } catch (error) {
    if (!(error instanceof UnimplementedOpcodeError)) throw error;
    return { steps, cycles, stop: 'error', error: error.message };
  }
  return { steps, cycles, stop: 'budget', error: undefined };
}

/** How a whole Run ended: at BRK, at an unimplemented opcode, at the cycle limit, or by Stop. */
export type RunEnd = 'brk' | 'error' | 'limit' | 'stopped';

/** A Run's totals so far, across all its frames. end is undefined while it's still going. */
export interface RunState {
  readonly steps: number;
  readonly cycles: number;
  readonly end: RunEnd | undefined;
  readonly error: string | undefined;
}

export const RUN_START: RunState = { steps: 0, cycles: 0, end: undefined, error: undefined };

/**
 * Runs one frame's worth and adds it to the totals. The write log is cleared
 * first, so afterwards it holds just this frame's writes: the Memory panel
 * then marks the bytes being written right now.
 */
export function advanceRun(target: CpuTarget, state: RunState, limit = RUN_CYCLE_LIMIT, perFrame = CYCLES_PER_FRAME): RunState {
  target.writes.clear();
  const slice = runFor(target, Math.min(perFrame, limit - state.cycles));
  const steps = state.steps + slice.steps;
  const cycles = state.cycles + slice.cycles;
  let end: RunEnd | undefined;
  if (slice.stop === 'brk') end = 'brk';
  else if (slice.stop === 'error') end = 'error';
  else if (cycles >= limit) end = 'limit';
  return { steps, cycles, end, error: slice.error };
}

/** The Stop button. A run that has already ended stays as it was. */
export function stopRun(state: RunState): RunState {
  return state.end === undefined ? { ...state, end: 'stopped' } : state;
}

/** The panel's message, e.g. "Stopped at BRK (&0431) after 1,234 instructions, 340,000 cycles = 170 ms at 2 MHz". */
export function describeRunState(state: RunState, pc: number): string {
  const ran = `${state.steps.toLocaleString('en-GB')} ${state.steps === 1 ? 'instruction' : 'instructions'}, ${formatCycles(state.cycles)}`;
  switch (state.end) {
    case undefined:
      return `Running… ${ran}`;
    case 'brk':
      return `Stopped at BRK (&${hex16(pc)}) after ${ran}`;
    case 'limit':
      return `Stopped at the cycle limit after ${ran}`;
    case 'stopped':
      return `Stopped by you at &${hex16(pc)} after ${ran}`;
    case 'error':
      return `Stopped: ${state.error ?? 'unknown error'}, after ${ran}`;
  }
}
