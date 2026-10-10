// Stall detection: has the program stopped reaching new code?
//
// A trap (run-to-trap.ts) is one instruction going nowhere: PC stops moving.
// Firmware waiting for hardware is different. The MOS's CTRL+SHIFT wait is a
// 60-instruction loop over four routines 10K apart, so PC moves all the time
// and doesn't stay in any small range. What gives it away is that nothing
// NEW runs: a booting machine keeps reaching code it hasn't run before, and a
// stalled one only goes round code it has.
//
// So we keep, for each of the 65,536 addresses, the step at which it first
// and last ran (0 = never), and the cycle count when a new address last
// appeared. No new address for stallCycles = stalled.
//
// record() runs before every step, so it's typed-array reads and writes only.

import type { TraceEntry } from './trace';

/** One emulated second at 2 MHz. Longer than any honest wait in the MOS boot (the memory clear is ~0.2 s). */
export const DEFAULT_STALL_CYCLES = 2_000_000;

export class StallDetector {
  /** Step number (1-based) at which each address first ran; 0 = never. Float64 so it can't wrap. */
  private readonly first = new Float64Array(0x10000);
  /** Step number at which each address last ran; 0 = never. */
  private readonly last = new Float64Array(0x10000);
  private steps = 0;
  /** Step number of the most recent first-time address. */
  private lastNewStep = 0;
  private lastNew = 0;

  constructor(readonly stallCycles = DEFAULT_STALL_CYCLES) {}

  /** Total cycles (cpu.cycles) at the moment the most recent first-time address was about to run. */
  get lastNewCycle(): number {
    return this.lastNew;
  }

  /** Steps recorded since construction or clear(). */
  get recorded(): number {
    return this.steps;
  }

  /**
   * Notes that the instruction at pc is about to run, with the CPU's total
   * cycles so far. Call it just before cpu.step(). Hot path: no allocation.
   */
  record(pc: number, cycles: number): void {
    const step = ++this.steps;
    const a = pc & 0xffff;
    if (this.first[a] === 0) {
      this.first[a] = step;
      this.lastNewStep = step;
      this.lastNew = cycles;
    }
    this.last[a] = step;
  }

  /** True if something has run, and no new address has appeared for at least stallCycles. */
  isStalled(cycles: number): boolean {
    return this.steps > 0 && cycles - this.lastNew >= this.stallCycles;
  }

  /** The step number (1 = the first recorded) at which address first ran, or undefined if it never has. */
  firstRun(address: number): number | undefined {
    const step = this.first[address & 0xffff] ?? 0;
    return step === 0 ? undefined : step;
  }

  /**
   * The loop: every address that ran in the second half of the stall (the
   * steps since the last new address). The instructions that led into the
   * loop ran only near its start, so they drop out. Sorted, low to high.
   * Not on the hot path: it looks at all 65,536 addresses.
   */
  loopAddresses(): number[] {
    const since = this.lastNewStep + (this.steps - this.lastNewStep) / 2;
    const loop: number[] = [];
    for (let a = 0; a < 0x10000; a++) {
      if ((this.last[a] ?? 0) > since) loop.push(a);
    }
    return loop;
  }

  /** Forgets every address: the next one recorded is new. */
  clear(): void {
    this.first.fill(0);
    this.last.fill(0);
    this.steps = 0;
    this.lastNewStep = 0;
    this.lastNew = 0;
  }
}

/**
 * The most recent full lap of a loop, from a trace of it. The lap starts at
 * the instruction that ran the fewest times in the trace (more than once):
 * one that runs once a lap. (Any old instruction won't do: the MOS's
 * keyTest runs twice a lap.) Of those, the lowest address. Returns the entries from its last-but-one visit
 * up to just before its last, or [] if there aren't two laps to see.
 */
export function lastLap(entries: readonly TraceEntry[]): TraceEntry[] {
  const counts = new Map<number, number>();
  for (const e of entries) counts.set(e.pc, (counts.get(e.pc) ?? 0) + 1);
  let anchor: number | undefined;
  let fewest = Infinity;
  // Ties go to the lowest address: usually the top of the loop, which reads best.
  for (const [pc, n] of counts) {
    if (n >= 2 && (n < fewest || (n === fewest && pc < (anchor ?? 0x10000)))) {
      fewest = n;
      anchor = pc;
    }
  }
  if (anchor === undefined) return [];
  let end = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.pc !== anchor) continue;
    if (end < 0) end = i;
    else return entries.slice(i, end);
  }
  return [];
}
