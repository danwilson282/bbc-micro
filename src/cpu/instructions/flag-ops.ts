// Flag instructions: set or clear one bit of P (MCS6500 Programming Manual,
// chapter 3). All implied mode, 1 byte, 2 cycles, and no other flag changes.
//
// They sit in the "x8" column of the opcode map, in clear/set pairs for C, I
// and D. V only has a clear: there is no SEV. SED and CLD came forward to
// Stage 11 for decimal mode; the other five arrived with Stage 14.

import type { Cpu6502 } from '../cpu6502';
import type { OpcodeDefinition } from '../opcodes';

/** CLC: C = 0. Before the first ADC of an addition, so no stray carry gets added in. */
function clc(cpu: Cpu6502): number {
  cpu.regs.c = false;
  return 0;
}

/** SEC: C = 1. Before the first SBC of a subtraction: C=1 means "no borrow". */
function sec(cpu: Cpu6502): number {
  cpu.regs.c = true;
  return 0;
}

/** CLI: I = 0. IRQs may interrupt again: a line already held low is answered before the next instruction. */
function cli(cpu: Cpu6502): number {
  cpu.regs.i = false;
  return 0;
}

/** SEI: I = 1. Holds off IRQs (not NMIs). The MOS does this early in its reset code. */
function sei(cpu: Cpu6502): number {
  cpu.regs.i = true;
  return 0;
}

/** CLV: V = 0. There's no SEV: only ADC, SBC, BIT, PLP, RTI and the SO pin can set V. */
function clv(cpu: Cpu6502): number {
  cpu.regs.v = false;
  return 0;
}

/** SED: D = 1. ADC and SBC now work in BCD. */
function sed(cpu: Cpu6502): number {
  cpu.regs.d = true;
  return 0;
}

/** CLD: D = 0. ADC and SBC are binary again. The MOS reset code does this early, because D powers up random. */
function cld(cpu: Cpu6502): number {
  cpu.regs.d = false;
  return 0;
}

export const FLAG_OPS: readonly OpcodeDefinition[] = [
  { opcode: 0x18, mnemonic: 'CLC', mode: 'implied', bytes: 1, cycles: 2, execute: clc },
  { opcode: 0x38, mnemonic: 'SEC', mode: 'implied', bytes: 1, cycles: 2, execute: sec },
  { opcode: 0x58, mnemonic: 'CLI', mode: 'implied', bytes: 1, cycles: 2, execute: cli },
  { opcode: 0x78, mnemonic: 'SEI', mode: 'implied', bytes: 1, cycles: 2, execute: sei },
  { opcode: 0xb8, mnemonic: 'CLV', mode: 'implied', bytes: 1, cycles: 2, execute: clv },
  { opcode: 0xd8, mnemonic: 'CLD', mode: 'implied', bytes: 1, cycles: 2, execute: cld },
  { opcode: 0xf8, mnemonic: 'SED', mode: 'implied', bytes: 1, cycles: 2, execute: sed },
];
