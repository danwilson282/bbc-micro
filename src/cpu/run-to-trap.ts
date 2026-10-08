// Running a self-checking 6502 program until it traps.
//
// Test programs such as Klaus Dormann's report their result by looping
// forever on one instruction: JMP * on success, BNE * (D0 FE) and the like on
// failure. No correct instruction leaves PC where it was, except a jump or
// branch to itself, so "PC didn't move" means "trapped". Where it trapped
// says what happened.

import type { Cpu6502 } from './cpu6502';
import type { StepFunction } from './singlestep';

export interface TrapResult {
  /** trap: PC stopped moving. limit: maxCycles ran out first. */
  readonly kind: 'trap' | 'limit';
  /** Where it stopped. For a trap, the address of the trapping instruction. */
  readonly pc: number;
  /** Cycles run by this call, including the trapping instruction once. */
  readonly cycles: number;
  /** Steps run by this call, including the trapping instruction once. */
  readonly instructions: number;
}

const STEP: StepFunction = (cpu) => cpu.step();

/**
 * Steps until an instruction leaves PC unchanged, or until at least maxCycles
 * have run. Hot path: the loop allocates nothing; the result is made once.
 * step is cpu.step() unless a test or demo passes one with a planted bug.
 */
export function runToTrap(cpu: Cpu6502, maxCycles: number, step: StepFunction = STEP): TrapResult {
  const r = cpu.regs;
  let cycles = 0;
  let instructions = 0;
  while (cycles < maxCycles) {
    const before = r.pc;
    cycles += step(cpu);
    instructions++;
    if (r.pc === before) return { kind: 'trap', pc: before, cycles, instructions };
  }
  return { kind: 'limit', pc: r.pc, cycles, instructions };
}
