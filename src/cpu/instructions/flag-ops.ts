// Flag instructions: set or clear one bit of P (MCS6500 Programming Manual,
// chapter 3). All implied mode, 1 byte, 2 cycles, and no other flag changes.
//
// Only SED and CLD are here so far. They came forward from Stage 14 so that
// Stage 11's programs can switch decimal mode on and off. Stage 14 adds CLC,
// SEC, CLI, SEI and CLV to this list.

import type { Cpu6502 } from '../cpu6502';
import type { OpcodeDefinition } from '../opcodes';

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
  { opcode: 0xf8, mnemonic: 'SED', mode: 'implied', bytes: 1, cycles: 2, execute: sed },
  { opcode: 0xd8, mnemonic: 'CLD', mode: 'implied', bytes: 1, cycles: 2, execute: cld },
];
