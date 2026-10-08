// BRK and RTI (MCS6500 Programming Manual, Chapter 9 and Appendix A).
//
//   BRK  &00  1 byte  7 cycles   PC + 2, push PC and P (B = 1), set I, PC from &FFFE
//   RTI  &40  1 byte  6 cycles   pull P, then PC (low, high), no + 1
//
// BRK is the hardware interrupt sequence (cpu.enterInterrupt) started by an
// instruction. It's 1 byte long but skips the next one too, the "padding" or
// "signature" byte: the BBC puts an error number there. RTI undoes any of
// BRK, IRQ or NMI. It pulls P first, so every flag comes back, I included.
// The dummy reads (BRK cycle 2 reads the padding byte; RTI cycles 2 and 3)
// aren't modelled: reading RAM has no side effects.

import { word } from '../../util/bits';
import { IRQ_VECTOR, type Cpu6502 } from '../cpu6502';
import { unpackP } from '../flags';
import type { OpcodeDefinition } from '../opcodes';

/** BRK: step over the padding byte, then the shared sequence with B = 1, through the IRQ vector. */
function brk(cpu: Cpu6502): number {
  const r = cpu.regs;
  r.pc = (r.pc + 1) & 0xffff;
  cpu.enterInterrupt(IRQ_VECTOR, true);
  return 0;
}

/** RTI: pull P (unpackP drops bits 5 and 4), then PC low and high. The pushed PC was exact, so no + 1. */
function rti(cpu: Cpu6502): number {
  unpackP(cpu.regs, cpu.pull());
  const low = cpu.pull();
  const high = cpu.pull();
  cpu.regs.pc = word(low, high);
  return 0;
}

export const INTERRUPTS: readonly OpcodeDefinition[] = [
  { opcode: 0x00, mnemonic: 'BRK', mode: 'implied', bytes: 1, cycles: 7, execute: brk },
  { opcode: 0x40, mnemonic: 'RTI', mode: 'implied', bytes: 1, cycles: 6, execute: rti },
];
