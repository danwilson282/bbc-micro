// Subroutines: JSR and RTS (MCS6500 Programming Manual, §8.1 and §8.2).
//
//   JSR &nnnn  &20  3 bytes  6 cycles   push (JSR's address + 2), then PC = &nnnn
//   RTS        &60  1 byte   6 cycles   pull a word, then PC = word + 1
//
// No flags. JSR pushes the address of its own LAST byte, not of the next
// instruction, because it pushes PC before fetching that byte (64doc's JSR
// cycle table):
//
//   1 fetch opcode   2 fetch low byte   3 dummy stack read
//   4 push PCH       5 push PCL         6 fetch high byte, PC = target
//
// RTS then spends its last cycle adding the 1 back. The dummy reads (JSR
// cycle 3, RTS cycles 2, 3 and 6) aren't modelled: reading RAM has no side
// effects.

import { hi, lo, word } from '../../util/bits';
import type { Cpu6502 } from '../cpu6502';
import type { OpcodeDefinition } from '../opcodes';

/** JSR &nnnn, in the hardware's order. The "PC − 1" falls out of it: PC is still on the high byte when it's pushed. */
function jsr(cpu: Cpu6502): number {
  const r = cpu.regs;
  const low = cpu.fetchByte();
  cpu.push(hi(r.pc));
  cpu.push(lo(r.pc));
  r.pc = word(low, cpu.bus.read(r.pc));
  return 0;
}

/** RTS: pull low then high, and add the 1 that JSR left off. */
function rts(cpu: Cpu6502): number {
  const low = cpu.pull();
  const high = cpu.pull();
  cpu.regs.pc = (word(low, high) + 1) & 0xffff;
  return 0;
}

export const SUBROUTINES: readonly OpcodeDefinition[] = [
  { opcode: 0x20, mnemonic: 'JSR', mode: 'absolute', bytes: 3, cycles: 6, execute: jsr },
  { opcode: 0x60, mnemonic: 'RTS', mode: 'implied', bytes: 1, cycles: 6, execute: rts },
];
