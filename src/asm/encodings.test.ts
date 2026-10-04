import type { AddressingMode } from '../cpu/addressing';
import { OPCODES } from '../cpu/opcodes';
import { ENCODINGS, encodingsOf, isMnemonic, opcodeFor, type Mnemonic } from './encodings';

/** Every (mnemonic, mode, opcode) row in the table. */
function allEncodings(): { mnemonic: Mnemonic; mode: AddressingMode; opcode: number }[] {
  const rows: { mnemonic: Mnemonic; mode: AddressingMode; opcode: number }[] = [];
  for (const mnemonic of Object.keys(ENCODINGS).filter(isMnemonic)) {
    for (const [mode, opcode] of encodingsOf(mnemonic)) rows.push({ mnemonic, mode, opcode });
  }
  return rows;
}

describe('the 6502 encoding table', () => {
  it('has the 56 documented mnemonics and 151 documented opcodes (MCS6500 manual, Appendix B)', () => {
    expect(Object.keys(ENCODINGS)).toHaveLength(56);
    expect(allEncodings()).toHaveLength(151);
  });

  it('gives every opcode byte to at most one (mnemonic, mode)', () => {
    const opcodes = allEncodings().map((row) => row.opcode);
    expect(new Set(opcodes).size).toBe(opcodes.length);
    for (const opcode of opcodes) {
      expect(opcode).toBeGreaterThanOrEqual(0x00);
      expect(opcode).toBeLessThanOrEqual(0xff);
    }
  });

  it('agrees with the CPU on every opcode the CPU implements so far', () => {
    const byOpcode = new Map(allEncodings().map((row) => [row.opcode, row]));
    OPCODES.forEach((entry, opcode) => {
      if (entry === undefined) return;
      expect({ opcode, mnemonic: entry.mnemonic, mode: entry.mode }).toEqual({ opcode, ...byOpcode.get(opcode) });
    });
  });

  // Group one (cc = 01) is laid out aaabbbcc: aaa picks the instruction, bbb the
  // mode. An independent check on the hand-typed table.
  const GROUP_ONE: readonly Mnemonic[] = ['ORA', 'AND', 'EOR', 'ADC', 'STA', 'LDA', 'CMP', 'SBC'];
  const GROUP_ONE_MODES: readonly AddressingMode[] = [
    'indexedIndirectX', // bbb 000
    'zeroPage', //         001
    'immediate', //        010
    'absolute', //         011
    'indirectIndexedY', // 100
    'zeroPageX', //        101
    'absoluteY', //        110
    'absoluteX', //        111
  ];
  it.each(GROUP_ONE.map((m, aaa) => [m, aaa] as const))(
    'group-one %s follows the aaabbb01 bit pattern (aaa = %i; STA has no immediate)',
    (mnemonic, aaa) => {
      GROUP_ONE_MODES.forEach((mode, bbb) => {
        const expected = mnemonic === 'STA' && mode === 'immediate' ? undefined : (aaa << 5) | (bbb << 2) | 0b01;
        expect(opcodeFor(mnemonic, mode)).toBe(expected);
      });
    },
  );

  it('gives the eight branches only Relative mode, at xxy10000', () => {
    const branches: readonly Mnemonic[] = ['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ'];
    branches.forEach((mnemonic, i) => {
      expect([...encodingsOf(mnemonic)]).toEqual([['relative', (i << 5) | 0x10]]);
    });
  });

  it('recognises mnemonics in upper case only (the assembler upper-cases first)', () => {
    expect(isMnemonic('LDA')).toBe(true);
    expect(isMnemonic('lda')).toBe(false);
    expect(isMnemonic('LDQ')).toBe(false);
    expect(isMnemonic('toString')).toBe(false);
  });
});
