// Loads: LDA, LDX, LDY. Copy one byte from memory into a register and set N
// and Z from it. C, V, D and I are left alone (MCS6500 Programming Manual §2).
//
// Every load is the same three steps: find the byte (the mode's EA function
// from Stage 05), copy it into the register, set N and Z. So one factory
// builds all 18 execute functions, once, when this module loads.

import { EFFECTIVE_ADDRESS, type AddressedMode } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import { setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';

type LoadRegister = 'a' | 'x' | 'y';

/**
 * Builds a load's execute function. Runs at module load, never inside step(),
 * so the closure it returns is created once and only ever called after that.
 * Loads are reads, so a page crossing costs +1: the 6502 reads optimistically
 * and only spends the fix-up cycle when the index carried (Stage 05).
 */
function load(register: LoadRegister, mode: AddressedMode): (cpu: Cpu6502) => number {
  const effectiveAddress = EFFECTIVE_ADDRESS[mode];
  return (cpu) => {
    const value = cpu.bus.read(effectiveAddress(cpu));
    cpu.regs[register] = value;
    setNZ(cpu.regs, value);
    return cpu.pageCrossed ? 1 : 0;
  };
}

function lda(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'LDA', mode, bytes, cycles, execute: load('a', mode) };
}

function ldx(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'LDX', mode, bytes, cycles, execute: load('x', mode) };
}

function ldy(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'LDY', mode, bytes, cycles, execute: load('y', mode) };
}

/**
 * The 18 load opcodes (MCS6500 Programming Manual, Appendix B). Cycles are the
 * base count; absoluteX, absoluteY and indirectIndexedY add 1 on a page cross.
 */
export const LOADS: readonly OpcodeDefinition[] = [
  //  opcode  mode                bytes cycles
  lda(0xa9, 'immediate', 2, 2), //        LDA #&nn
  lda(0xa5, 'zeroPage', 2, 3), //         LDA &nn
  lda(0xb5, 'zeroPageX', 2, 4), //        LDA &nn,X
  lda(0xad, 'absolute', 3, 4), //         LDA &nnnn
  lda(0xbd, 'absoluteX', 3, 4), //        LDA &nnnn,X   +1 on page cross
  lda(0xb9, 'absoluteY', 3, 4), //        LDA &nnnn,Y   +1 on page cross
  lda(0xa1, 'indexedIndirectX', 2, 6), // LDA (&nn,X)
  lda(0xb1, 'indirectIndexedY', 2, 5), // LDA (&nn),Y   +1 on page cross

  // LDX can't index by X, so where LDA would use X it uses Y.
  ldx(0xa2, 'immediate', 2, 2), //        LDX #&nn
  ldx(0xa6, 'zeroPage', 2, 3), //         LDX &nn
  ldx(0xb6, 'zeroPageY', 2, 4), //        LDX &nn,Y
  ldx(0xae, 'absolute', 3, 4), //         LDX &nnnn
  ldx(0xbe, 'absoluteY', 3, 4), //        LDX &nnnn,Y   +1 on page cross

  // LDY can't index by Y, so it uses X.
  ldy(0xa0, 'immediate', 2, 2), //        LDY #&nn
  ldy(0xa4, 'zeroPage', 2, 3), //         LDY &nn
  ldy(0xb4, 'zeroPageX', 2, 4), //        LDY &nn,X
  ldy(0xac, 'absolute', 3, 4), //         LDY &nnnn
  ldy(0xbc, 'absoluteX', 3, 4), //        LDY &nnnn,X   +1 on page cross
];
