// Logic: AND, ORA and EOR work on A one bit at a time, with no carry from
// one bit to the next. BIT tests bits without changing A (MCS6500
// Programming Manual, chapter 2).
//
// Think of the operand as a mask that picks which bits of A to work on:
//   AND  clears the bits that are 0 in the mask   &B5 AND &0F = &05
//   ORA  sets the bits that are 1 in the mask     &05 ORA &C0 = &C5
//   EOR  flips the bits that are 1 in the mask    &C5 EOR &FF = &3A
// All three set N and Z from the result and leave V and C alone: a result
// can't carry or overflow when no bit affects another.

import type { AddressedMode } from '../addressing';
import { P_N, P_V, setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';
import type { Registers } from '../registers';
import { readOperand, type OperandAlu } from './read-operand';

/** AND: A ← A ∧ M. Clears every bit of A that is 0 in M. */
export function and(regs: Registers, value: number): void {
  regs.a = regs.a & value & 0xff;
  setNZ(regs, regs.a);
}

/** ORA: A ← A ∨ M. Sets every bit of A that is 1 in M. */
export function or(regs: Registers, value: number): void {
  regs.a = (regs.a | value) & 0xff;
  setNZ(regs, regs.a);
}

/** EOR: A ← A ⊻ M. Flips every bit of A that is 1 in M, so EOR #&FF is NOT. */
export function eor(regs: Registers, value: number): void {
  regs.a = (regs.a ^ value) & 0xff;
  setNZ(regs, regs.a);
}

/**
 * BIT: a test that changes nothing but flags. Z is set if A AND M is &00,
 * and that result is thrown away. N and V are copied from bits 7 and 6 of M
 * itself, so A plays no part in them. e.g. A=&01, M=&C1: Z=0, N=1, V=1.
 */
export function bit(regs: Registers, value: number): void {
  regs.z = (regs.a & value & 0xff) === 0;
  regs.n = (value & P_N) !== 0;
  regs.v = (value & P_V) !== 0;
}

type LogicMnemonic = 'AND' | 'ORA' | 'EOR' | 'BIT';

const ALU: Readonly<Record<LogicMnemonic, OperandAlu>> = { AND: and, ORA: or, EOR: eor, BIT: bit };

function row(mnemonic: LogicMnemonic, opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic, mode, bytes, cycles, execute: readOperand(mode, ALU[mnemonic]) };
}

/**
 * The 26 logic opcodes (MCS6500 Programming Manual, Appendix B). AND, ORA
 * and EOR share LDA's modes and base cycles: the bus work is the same, only
 * the ALU's job differs. BIT has just zero page and absolute on the NMOS
 * 6502; BIT # (&89) is a 65C02 addition and isn't on the Model B.
 */
export const LOGIC: readonly OpcodeDefinition[] = [
  //  mnemonic opcode mode               bytes cycles
  row('ORA', 0x09, 'immediate', 2, 2), //        ORA #&nn
  row('ORA', 0x05, 'zeroPage', 2, 3), //         ORA &nn
  row('ORA', 0x15, 'zeroPageX', 2, 4), //        ORA &nn,X
  row('ORA', 0x0d, 'absolute', 3, 4), //         ORA &nnnn
  row('ORA', 0x1d, 'absoluteX', 3, 4), //        ORA &nnnn,X   +1 on page cross
  row('ORA', 0x19, 'absoluteY', 3, 4), //        ORA &nnnn,Y   +1 on page cross
  row('ORA', 0x01, 'indexedIndirectX', 2, 6), // ORA (&nn,X)
  row('ORA', 0x11, 'indirectIndexedY', 2, 5), // ORA (&nn),Y   +1 on page cross

  row('AND', 0x29, 'immediate', 2, 2), //        AND #&nn
  row('AND', 0x25, 'zeroPage', 2, 3), //         AND &nn
  row('AND', 0x35, 'zeroPageX', 2, 4), //        AND &nn,X
  row('AND', 0x2d, 'absolute', 3, 4), //         AND &nnnn
  row('AND', 0x3d, 'absoluteX', 3, 4), //        AND &nnnn,X   +1 on page cross
  row('AND', 0x39, 'absoluteY', 3, 4), //        AND &nnnn,Y   +1 on page cross
  row('AND', 0x21, 'indexedIndirectX', 2, 6), // AND (&nn,X)
  row('AND', 0x31, 'indirectIndexedY', 2, 5), // AND (&nn),Y   +1 on page cross

  row('EOR', 0x49, 'immediate', 2, 2), //        EOR #&nn
  row('EOR', 0x45, 'zeroPage', 2, 3), //         EOR &nn
  row('EOR', 0x55, 'zeroPageX', 2, 4), //        EOR &nn,X
  row('EOR', 0x4d, 'absolute', 3, 4), //         EOR &nnnn
  row('EOR', 0x5d, 'absoluteX', 3, 4), //        EOR &nnnn,X   +1 on page cross
  row('EOR', 0x59, 'absoluteY', 3, 4), //        EOR &nnnn,Y   +1 on page cross
  row('EOR', 0x41, 'indexedIndirectX', 2, 6), // EOR (&nn,X)
  row('EOR', 0x51, 'indirectIndexedY', 2, 5), // EOR (&nn),Y   +1 on page cross

  row('BIT', 0x24, 'zeroPage', 2, 3), //         BIT &nn
  row('BIT', 0x2c, 'absolute', 3, 4), //         BIT &nnnn
];
