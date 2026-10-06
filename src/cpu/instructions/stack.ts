// Stack instructions: PHA, PLA, PHP, PLP (MCS6500 Programming Manual, §8).
// All implied mode, 1 byte. The stack is page 1, and S points at the next
// free slot, so a push writes then decrements and a pull increments then
// reads (cpu.push / cpu.pull).
//
//   PHA  &48  3 cycles   A → stack                      no flags
//   PLA  &68  4 cycles   stack → A                      N Z
//   PHP  &08  3 cycles   P → stack, bits 5 and 4 = 1    no flags
//   PLP  &28  4 cycles   stack → P, bits 5 and 4 dropped  all six
//
// A pull costs one more cycle than a push because S has to be incremented
// before the read can happen. That cycle is a dummy read of the stack at the
// old S, which we don't model (reading RAM has no side effects).

import type { Cpu6502 } from '../cpu6502';
import { packP, setNZ, unpackP } from '../flags';
import type { OpcodeDefinition } from '../opcodes';

/** PHA: push A. */
function pha(cpu: Cpu6502): number {
  cpu.push(cpu.regs.a);
  return 0;
}

/** PLA: pull into A, setting N and Z like a load. */
function pla(cpu: Cpu6502): number {
  const value = cpu.pull();
  cpu.regs.a = value;
  setNZ(cpu.regs, value);
  return 0;
}

/**
 * PHP: push P. The chip has no flip-flops for bits 5 and 4, so it drives
 * both as 1: e.g. D, I and C set pushes %0011 1101 = &3D. B = 1 marks
 * "pushed by an instruction" (IRQ and NMI push B = 0, Stage 17).
 */
function php(cpu: Cpu6502): number {
  cpu.push(packP(cpu.regs, true));
  return 0;
}

/** PLP: pull into P. unpackP drops bits 5 and 4: there's nowhere to put them. */
function plp(cpu: Cpu6502): number {
  unpackP(cpu.regs, cpu.pull());
  return 0;
}

function implied(opcode: number, mnemonic: string, cycles: number, execute: (cpu: Cpu6502) => number): OpcodeDefinition {
  return { opcode, mnemonic, mode: 'implied', bytes: 1, cycles, execute };
}

/** The 4 stack opcodes, in opcode order. They sit in the x8 column, alongside the flag instructions. */
export const STACK: readonly OpcodeDefinition[] = [
  implied(0x08, 'PHP', 3, php),
  implied(0x28, 'PLP', 4, plp),
  implied(0x48, 'PHA', 3, pha),
  implied(0x68, 'PLA', 4, pla),
];
