// Arithmetic: ADC (add with carry) and SBC (subtract with carry). Both set
// N, V, Z and C (MCS6500 Programming Manual, chapter 2).
//
// The 6502 has one adder and no subtractor. SBC feeds the adder the operand
// with every bit inverted: A + ~M + C equals A − M − (1 − C) in 8 bits, so C
// works as an inverted borrow (C=1 means "no borrow"). Both instructions call
// addWithCarry, and SBC just passes value ^ 0xff.
//
// With D=1 they work in binary-coded decimal instead (Stage 11): each nibble
// is a digit 0-9, and a digit that goes past 9 (or below 0) is fixed up by 6.
// The NMOS 6502 does that fix-up in the same cycle, so its flags are odd: in
// decimal ADC, N and V see the sum half-way through the fix-up and Z sees the
// plain binary sum. Only A and C are decimal. Decimal SBC's flags are all the
// binary ones. Source: Bruce Clark, "Decimal Mode" (6502.org), Appendix A.

import type { AddressedMode } from '../addressing';
import { setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';
import type { Registers } from '../registers';
import { readOperand } from './read-operand';

/**
 * The adder: A + value + C → A. C is the ninth bit of the sum. V is set when
 * A and value have the same sign but the result's sign differs: the signed
 * answer didn't fit in −128…+127. e.g. &50 + &50 = &A0: C=0, V=1.
 * Writes into regs, so it's safe on the hot path.
 */
export function addWithCarry(regs: Registers, value: number): void {
  const a = regs.a;
  const sum = a + value + (regs.c ? 1 : 0);
  const result = sum & 0xff;
  regs.c = sum > 0xff;
  regs.v = ((a ^ result) & (value ^ result) & 0x80) !== 0;
  regs.a = result;
  setNZ(regs, result);
}

/** SBC: the same adder with the operand inverted. &05 − &03 (C=1) = &05 + &FC + 1 = &102 → &02, C=1. */
export function subtractWithCarry(regs: Registers, value: number): void {
  addWithCarry(regs, value ^ 0xff);
}

/**
 * Decimal ADC, as the NMOS 6502 does it. A and C are the BCD answer; N and V
 * come from the sum after the low digit is fixed up but before the high one
 * is; Z comes from the binary sum. e.g. &99 + &01 = &00 with C=1, but N=1
 * (half-fixed &A0) and Z=0 (binary &9A). Invalid BCD follows the same steps:
 * &0F + &00 = &15.
 */
export function addDecimal(regs: Registers, value: number): void {
  const a = regs.a;
  const carry = regs.c ? 1 : 0;
  // The low digit. Past 9: add 6 to skip &A-&F, and carry &10 into the tens.
  let low = (a & 0x0f) + (value & 0x0f) + carry;
  if (low >= 0x0a) low = ((low + 0x06) & 0x0f) + 0x10;
  // The half-fixed sum, up to &1FF. This is what N and V see.
  let sum = (a & 0xf0) + (value & 0xf0) + low;
  regs.n = (sum & 0x80) !== 0;
  regs.v = ((a ^ sum) & (value ^ sum) & 0x80) !== 0;
  // The high digit. Past 9: add &60, which carries out into bit 8.
  if (sum >= 0xa0) sum += 0x60;
  regs.c = sum > 0xff;
  regs.z = ((a + value + carry) & 0xff) === 0;
  regs.a = sum & 0xff;
}

/**
 * Decimal SBC, as the NMOS 6502 does it. Every flag is exactly as in binary,
 * so subtractWithCarry sets them, and only A gets the decimal answer.
 * e.g. &10 − &01 (C=1) = &09, where binary gives &0F. Below 0: &00 − &01 = &99, C=0.
 */
export function subtractDecimal(regs: Registers, value: number): void {
  const a = regs.a;
  const borrow = regs.c ? 0 : 1;
  subtractWithCarry(regs, value);
  // The low digit. Below 0: take 6 more to skip &F-&A, and borrow &10 from the tens.
  let low = (a & 0x0f) - (value & 0x0f) - borrow;
  if (low < 0) low = ((low - 0x06) & 0x0f) - 0x10;
  // The high digit. Below 0: take &60 more. & 0xff then wraps it, like a borrow out.
  let diff = (a & 0xf0) - (value & 0xf0) + low;
  if (diff < 0) diff -= 0x60;
  regs.a = diff & 0xff;
}

/** ADC: decimal if D is set, binary if not. D can change between any two instructions, so it's checked every time. */
export function add(regs: Registers, value: number): void {
  if (regs.d) addDecimal(regs, value);
  else addWithCarry(regs, value);
}

/** SBC: decimal if D is set, binary if not. */
export function subtract(regs: Registers, value: number): void {
  if (regs.d) subtractDecimal(regs, value);
  else subtractWithCarry(regs, value);
}

function adc(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'ADC', mode, bytes, cycles, execute: readOperand(mode, add) };
}

function sbc(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'SBC', mode, bytes, cycles, execute: readOperand(mode, subtract) };
}

/**
 * The 16 arithmetic opcodes (MCS6500 Programming Manual, Appendix B). Same
 * modes and base cycles as LDA, in both binary and decimal mode: the NMOS
 * 6502's fix-up costs no extra cycle (the 65C02's does). The undocumented
 * SBC # duplicate at &EB is left for the Part 12 extras.
 */
export const ARITHMETIC: readonly OpcodeDefinition[] = [
  //  opcode  mode                bytes cycles
  adc(0x69, 'immediate', 2, 2), //        ADC #&nn
  adc(0x65, 'zeroPage', 2, 3), //         ADC &nn
  adc(0x75, 'zeroPageX', 2, 4), //        ADC &nn,X
  adc(0x6d, 'absolute', 3, 4), //         ADC &nnnn
  adc(0x7d, 'absoluteX', 3, 4), //        ADC &nnnn,X   +1 on page cross
  adc(0x79, 'absoluteY', 3, 4), //        ADC &nnnn,Y   +1 on page cross
  adc(0x61, 'indexedIndirectX', 2, 6), // ADC (&nn,X)
  adc(0x71, 'indirectIndexedY', 2, 5), // ADC (&nn),Y   +1 on page cross

  sbc(0xe9, 'immediate', 2, 2), //        SBC #&nn
  sbc(0xe5, 'zeroPage', 2, 3), //         SBC &nn
  sbc(0xf5, 'zeroPageX', 2, 4), //        SBC &nn,X
  sbc(0xed, 'absolute', 3, 4), //         SBC &nnnn
  sbc(0xfd, 'absoluteX', 3, 4), //        SBC &nnnn,X   +1 on page cross
  sbc(0xf9, 'absoluteY', 3, 4), //        SBC &nnnn,Y   +1 on page cross
  sbc(0xe1, 'indexedIndirectX', 2, 6), // SBC (&nn,X)
  sbc(0xf1, 'indirectIndexedY', 2, 5), // SBC (&nn),Y   +1 on page cross
];
