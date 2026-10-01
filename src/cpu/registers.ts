// The 6502's programmer-visible registers (MCS6500 Programming Manual, §1).
//
//   A   8 bits   accumulator: arithmetic and logic
//   X   8 bits   index register
//   Y   8 bits   index register
//   S   8 bits   stack pointer: the next free slot is &0100 + S (page 1)
//   PC  16 bits  program counter: address of the next byte to fetch
//   P   the status flags, kept as six booleans (see flags.ts)
//
// These are plain JS numbers, so anything that writes them must mask:
// & 0xff for A, X, Y and S, & 0xffff for PC.

import type { StatusFlags } from './flags';

export interface Registers extends StatusFlags {
  a: number;
  x: number;
  y: number;
  s: number;
  pc: number;
}

/**
 * The state we choose for power-on. A real 6502's registers power up to
 * whatever the transistors settle to; zero is our deterministic stand-in.
 * Only reset() makes the state meaningful: it sets PC, I and S.
 */
export function createRegisters(): Registers {
  return { a: 0, x: 0, y: 0, s: 0, pc: 0, n: false, v: false, d: false, i: false, z: false, c: false };
}
