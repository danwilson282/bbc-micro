// JMP: load PC with an address (MCS6500 Programming Manual, §4.0).
//
//   JMP &nnnn    &4C  3 bytes  3 cycles   PC = &nnnn
//   JMP (&nnnn)  &6C  3 bytes  5 cycles   PC = the word stored at &nnnn
//
// No flags, no stack. The effective address IS the result: JMP &3000 never
// reads &3000, it just goes there. The indirect mode's NMOS page-wrap bug
// (JMP (&10FF) takes its high byte from &1000) lives in addrIndirect, so
// nothing here has to know about it.

import { addrAbsolute, addrIndirect } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import type { OpcodeDefinition } from '../opcodes';

/** JMP &nnnn */
function jmpAbsolute(cpu: Cpu6502): number {
  cpu.regs.pc = addrAbsolute(cpu);
  return 0;
}

/** JMP (&nnnn): the BBC's MOS calls all go through one of these, via vectors in page 2. */
function jmpIndirect(cpu: Cpu6502): number {
  cpu.regs.pc = addrIndirect(cpu);
  return 0;
}

export const JUMPS: readonly OpcodeDefinition[] = [
  { opcode: 0x4c, mnemonic: 'JMP', mode: 'absolute', bytes: 3, cycles: 3, execute: jmpAbsolute },
  { opcode: 0x6c, mnemonic: 'JMP', mode: 'indirect', bytes: 3, cycles: 5, execute: jmpIndirect },
];
