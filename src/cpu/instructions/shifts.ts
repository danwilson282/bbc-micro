// Shifts & rotates: move every bit of a byte one place left or right. The
// bit that falls off the end goes into C (MCS6500 Programming Manual,
// chapter 10).
//
//   ASL  C ← b7 ← … ← b0 ← 0       left: × 2
//   LSR  0 → b7 → … → b0 → C       right: ÷ 2, remainder in C
//   ROL  C ← b7 ← … ← b0 ← C       left, old C in at the bottom
//   ROR  C → b7 → … → b0 → C       right, old C in at the top
//
// All four set N and Z from the result and leave V alone, even when ASL turns
// &40 (+64) into &80 (-128). The rotates treat C and the byte as one 9-bit
// ring, which is how a shift carries from one byte of a bigger number to the
// next: ASL the low byte, then ROL the high byte.

import type { Cpu6502 } from '../cpu6502';
import { P_C, P_N, setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';
import type { Registers } from '../registers';
import { readModifyWrite, type RmwMode } from './rmw';

/** ASL: C ← bit 7, every bit one place left, a 0 into bit 0. e.g. &C0 → &80, C=1. */
export function asl(regs: Registers, value: number): number {
  const result = (value << 1) & 0xff;
  regs.c = (value & P_N) !== 0;
  setNZ(regs, result);
  return result;
}

/** LSR: C ← bit 0, every bit one place right, a 0 into bit 7 (so N is always 0). e.g. &73 → &39, C=1. */
export function lsr(regs: Registers, value: number): number {
  const result = (value & 0xff) >> 1;
  regs.c = (value & P_C) !== 0;
  setNZ(regs, result);
  return result;
}

/** ROL: C ← bit 7, every bit one place left, the old C into bit 0. e.g. &01 with C=1 → &03, C=0. */
export function rol(regs: Registers, value: number): number {
  const result = ((value << 1) | (regs.c ? 0x01 : 0x00)) & 0xff;
  regs.c = (value & P_N) !== 0;
  setNZ(regs, result);
  return result;
}

/** ROR: C ← bit 0, every bit one place right, the old C into bit 7. e.g. &00 with C=1 → &80, C=0. */
export function ror(regs: Registers, value: number): number {
  const result = (((value & 0xff) >> 1) | (regs.c ? 0x80 : 0x00)) & 0xff;
  regs.c = (value & P_C) !== 0;
  setNZ(regs, result);
  return result;
}

type ShiftMnemonic = 'ASL' | 'LSR' | 'ROL' | 'ROR';
type Alu = (regs: Registers, value: number) => number;

const ALU: Readonly<Record<ShiftMnemonic, Alu>> = { ASL: asl, LSR: lsr, ROL: rol, ROR: ror };

/** ASL A and friends: the ALU reads A and writes A. No bus access, so 2 cycles flat. Built once at module load. */
function accumulator(alu: Alu): (cpu: Cpu6502) => number {
  return (cpu) => {
    cpu.regs.a = alu(cpu.regs, cpu.regs.a);
    return 0;
  };
}

function onA(mnemonic: ShiftMnemonic, opcode: number): OpcodeDefinition {
  return { opcode, mnemonic, mode: 'accumulator', bytes: 1, cycles: 2, execute: accumulator(ALU[mnemonic]) };
}

function onMemory(mnemonic: ShiftMnemonic, opcode: number, mode: RmwMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic, mode, bytes, cycles, execute: readModifyWrite(mode, ALU[mnemonic]) };
}

/**
 * The 20 shift and rotate opcodes (MCS6500 Programming Manual, Appendix B).
 * The memory forms share INC's modes and cycles: same cc = %10 group, same
 * read-modify-write bus work, a different ALU job in the middle.
 */
export const SHIFTS: readonly OpcodeDefinition[] = [
  //       mnemonic opcode mode        bytes cycles
  onA('ASL', 0x0a), //                             ASL A
  onMemory('ASL', 0x06, 'zeroPage', 2, 5), //      ASL &nn
  onMemory('ASL', 0x16, 'zeroPageX', 2, 6), //     ASL &nn,X
  onMemory('ASL', 0x0e, 'absolute', 3, 6), //      ASL &nnnn
  onMemory('ASL', 0x1e, 'absoluteX', 3, 7), //     ASL &nnnn,X   always 7

  onA('ROL', 0x2a), //                             ROL A
  onMemory('ROL', 0x26, 'zeroPage', 2, 5), //      ROL &nn
  onMemory('ROL', 0x36, 'zeroPageX', 2, 6), //     ROL &nn,X
  onMemory('ROL', 0x2e, 'absolute', 3, 6), //      ROL &nnnn
  onMemory('ROL', 0x3e, 'absoluteX', 3, 7), //     ROL &nnnn,X   always 7

  onA('LSR', 0x4a), //                             LSR A
  onMemory('LSR', 0x46, 'zeroPage', 2, 5), //      LSR &nn
  onMemory('LSR', 0x56, 'zeroPageX', 2, 6), //     LSR &nn,X
  onMemory('LSR', 0x4e, 'absolute', 3, 6), //      LSR &nnnn
  onMemory('LSR', 0x5e, 'absoluteX', 3, 7), //     LSR &nnnn,X   always 7

  onA('ROR', 0x6a), //                             ROR A
  onMemory('ROR', 0x66, 'zeroPage', 2, 5), //      ROR &nn
  onMemory('ROR', 0x76, 'zeroPageX', 2, 6), //     ROR &nn,X
  onMemory('ROR', 0x6e, 'absolute', 3, 6), //      ROR &nnnn
  onMemory('ROR', 0x7e, 'absoluteX', 3, 7), //     ROR &nnnn,X   always 7
];
