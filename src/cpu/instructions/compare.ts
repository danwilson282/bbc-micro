// Compare: CMP, CPX and CPY subtract memory from A, X or Y, keep the flags
// and throw the answer away (MCS6500 Programming Manual, §4.2).
//
//   C = 1 if register ≥ M   (as unsigned numbers: "no borrow")
//   Z = 1 if register = M
//   N = bit 7 of (register − M) & &FF   (NOT "less than": it wraps)
//
// The ALU does A + ~M + 1, like SBC with the carry in forced to 1, so no SEC
// is needed first. V is left alone and D is ignored: compares are always
// binary. The register itself never changes.

import type { AddressedMode } from '../addressing';
import type { StatusFlags } from '../flags';
import type { OpcodeDefinition } from '../opcodes';
import type { Registers } from '../registers';
import { readOperand, type OperandAlu } from './read-operand';

/**
 * Sets C, Z and N as if value were subtracted from register. Plain integer
 * arithmetic: the difference is −255…+255, and "≥ 0" is the carry out.
 * e.g. &40 vs &30: &10, C=1 Z=0 N=0. &20 vs &30: &F0, C=0 Z=0 N=1.
 */
export function compare(flags: StatusFlags, register: number, value: number): void {
  const difference = (register & 0xff) - (value & 0xff);
  flags.c = difference >= 0;
  flags.z = difference === 0;
  flags.n = (difference & 0x80) !== 0;
}

/** CMP: compare A with M. */
export function cmp(regs: Registers, value: number): void {
  compare(regs, regs.a, value);
}

/** CPX: compare X with M. Typically ends a counting-up loop: INX, CPX #n, BNE. */
export function cpx(regs: Registers, value: number): void {
  compare(regs, regs.x, value);
}

/** CPY: compare Y with M. */
export function cpy(regs: Registers, value: number): void {
  compare(regs, regs.y, value);
}

type CompareMnemonic = 'CMP' | 'CPX' | 'CPY';

const ALU: Readonly<Record<CompareMnemonic, OperandAlu>> = { CMP: cmp, CPX: cpx, CPY: cpy };

function row(mnemonic: CompareMnemonic, opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic, mode, bytes, cycles, execute: readOperand(mode, ALU[mnemonic]) };
}

/**
 * The 14 compare opcodes (MCS6500 Programming Manual, Appendix B). CMP is in
 * the cc = %01 group at aaa = %110, so it has all eight of LDA's modes and
 * cycles. CPX and CPY are in the cc = %00 group and have only three.
 */
export const COMPARE: readonly OpcodeDefinition[] = [
  //  mnemonic opcode mode               bytes cycles
  row('CMP', 0xc9, 'immediate', 2, 2), //        CMP #&nn
  row('CMP', 0xc5, 'zeroPage', 2, 3), //         CMP &nn
  row('CMP', 0xd5, 'zeroPageX', 2, 4), //        CMP &nn,X
  row('CMP', 0xcd, 'absolute', 3, 4), //         CMP &nnnn
  row('CMP', 0xdd, 'absoluteX', 3, 4), //        CMP &nnnn,X   +1 on page cross
  row('CMP', 0xd9, 'absoluteY', 3, 4), //        CMP &nnnn,Y   +1 on page cross
  row('CMP', 0xc1, 'indexedIndirectX', 2, 6), // CMP (&nn,X)
  row('CMP', 0xd1, 'indirectIndexedY', 2, 5), // CMP (&nn),Y   +1 on page cross

  row('CPX', 0xe0, 'immediate', 2, 2), //        CPX #&nn
  row('CPX', 0xe4, 'zeroPage', 2, 3), //         CPX &nn
  row('CPX', 0xec, 'absolute', 3, 4), //         CPX &nnnn

  row('CPY', 0xc0, 'immediate', 2, 2), //        CPY #&nn
  row('CPY', 0xc4, 'zeroPage', 2, 3), //         CPY &nn
  row('CPY', 0xcc, 'absolute', 3, 4), //         CPY &nnnn
];
