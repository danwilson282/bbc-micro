// Arithmetic: ADC (add with carry) and SBC (subtract with carry), in binary
// mode. Both set N, V, Z and C (MCS6500 Programming Manual, chapter 2).
//
// The 6502 has one adder and no subtractor. SBC feeds the adder the operand
// with every bit inverted: A + ~M + C equals A − M − (1 − C) in 8 bits, so C
// works as an inverted borrow (C=1 means "no borrow"). Both instructions call
// addWithCarry, and SBC just passes value ^ 0xff.
//
// Decimal mode (D=1) isn't modelled until Stage 11. Nothing can set D yet
// (SED is Stage 14), so for now ADC and SBC always work in binary.

import { EFFECTIVE_ADDRESS, type AddressedMode } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import { setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';
import type { Registers } from '../registers';

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
 * Builds an ADC or SBC execute function, once, at module load. Like LDA it
 * reads its operand, so a page crossing costs +1 (Stage 05).
 */
function arithmetic(mode: AddressedMode, alu: (regs: Registers, value: number) => void): (cpu: Cpu6502) => number {
  const effectiveAddress = EFFECTIVE_ADDRESS[mode];
  return (cpu) => {
    alu(cpu.regs, cpu.bus.read(effectiveAddress(cpu)));
    return cpu.pageCrossed ? 1 : 0;
  };
}

function adc(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'ADC', mode, bytes, cycles, execute: arithmetic(mode, addWithCarry) };
}

function sbc(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'SBC', mode, bytes, cycles, execute: arithmetic(mode, subtractWithCarry) };
}

/**
 * The 16 arithmetic opcodes (MCS6500 Programming Manual, Appendix B). Same
 * modes and base cycles as LDA. The undocumented SBC # duplicate at &EB is
 * left for the Part 12 extras.
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
