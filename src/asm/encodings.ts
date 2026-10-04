// The encoding table: which opcode byte each (mnemonic, addressing mode) pair
// assembles to. The mirror image of the CPU's OPCODES table, which goes from
// byte to (mnemonic, mode).
//
// It lists all 151 documented NMOS 6502 opcodes (MCS6500 Microcomputer Family
// Programming Manual, Appendix B), including the ones the CPU can't execute
// yet. A missing mode means "no such instruction": STX has no Absolute,Y, so
// "STX &1234,Y" is an assembly error.
//
// Kept separate from OPCODES on purpose. OPCODES only holds what's
// implemented; this table must know everything. A test checks the two agree
// wherever both have an entry.

import type { AddressingMode } from '../cpu/addressing';

export const ENCODINGS = {
  // Group one (opcode pattern aaabbb01): eight modes each, except STA.
  ORA: { indexedIndirectX: 0x01, zeroPage: 0x05, immediate: 0x09, absolute: 0x0d, indirectIndexedY: 0x11, zeroPageX: 0x15, absoluteY: 0x19, absoluteX: 0x1d },
  AND: { indexedIndirectX: 0x21, zeroPage: 0x25, immediate: 0x29, absolute: 0x2d, indirectIndexedY: 0x31, zeroPageX: 0x35, absoluteY: 0x39, absoluteX: 0x3d },
  EOR: { indexedIndirectX: 0x41, zeroPage: 0x45, immediate: 0x49, absolute: 0x4d, indirectIndexedY: 0x51, zeroPageX: 0x55, absoluteY: 0x59, absoluteX: 0x5d },
  ADC: { indexedIndirectX: 0x61, zeroPage: 0x65, immediate: 0x69, absolute: 0x6d, indirectIndexedY: 0x71, zeroPageX: 0x75, absoluteY: 0x79, absoluteX: 0x7d },
  STA: { indexedIndirectX: 0x81, zeroPage: 0x85, absolute: 0x8d, indirectIndexedY: 0x91, zeroPageX: 0x95, absoluteY: 0x99, absoluteX: 0x9d },
  LDA: { indexedIndirectX: 0xa1, zeroPage: 0xa5, immediate: 0xa9, absolute: 0xad, indirectIndexedY: 0xb1, zeroPageX: 0xb5, absoluteY: 0xb9, absoluteX: 0xbd },
  CMP: { indexedIndirectX: 0xc1, zeroPage: 0xc5, immediate: 0xc9, absolute: 0xcd, indirectIndexedY: 0xd1, zeroPageX: 0xd5, absoluteY: 0xd9, absoluteX: 0xdd },
  SBC: { indexedIndirectX: 0xe1, zeroPage: 0xe5, immediate: 0xe9, absolute: 0xed, indirectIndexedY: 0xf1, zeroPageX: 0xf5, absoluteY: 0xf9, absoluteX: 0xfd },

  // Shifts and rotates: Accumulator instead of Immediate.
  ASL: { accumulator: 0x0a, zeroPage: 0x06, zeroPageX: 0x16, absolute: 0x0e, absoluteX: 0x1e },
  ROL: { accumulator: 0x2a, zeroPage: 0x26, zeroPageX: 0x36, absolute: 0x2e, absoluteX: 0x3e },
  LSR: { accumulator: 0x4a, zeroPage: 0x46, zeroPageX: 0x56, absolute: 0x4e, absoluteX: 0x5e },
  ROR: { accumulator: 0x6a, zeroPage: 0x66, zeroPageX: 0x76, absolute: 0x6e, absoluteX: 0x7e },

  // Memory increment and decrement (read-modify-write).
  INC: { zeroPage: 0xe6, zeroPageX: 0xf6, absolute: 0xee, absoluteX: 0xfe },
  DEC: { zeroPage: 0xc6, zeroPageX: 0xd6, absolute: 0xce, absoluteX: 0xde },

  // X and Y loads, stores and compares. LDX/STX index by Y, not X.
  LDX: { immediate: 0xa2, zeroPage: 0xa6, zeroPageY: 0xb6, absolute: 0xae, absoluteY: 0xbe },
  LDY: { immediate: 0xa0, zeroPage: 0xa4, zeroPageX: 0xb4, absolute: 0xac, absoluteX: 0xbc },
  STX: { zeroPage: 0x86, zeroPageY: 0x96, absolute: 0x8e },
  STY: { zeroPage: 0x84, zeroPageX: 0x94, absolute: 0x8c },
  CPX: { immediate: 0xe0, zeroPage: 0xe4, absolute: 0xec },
  CPY: { immediate: 0xc0, zeroPage: 0xc4, absolute: 0xcc },

  BIT: { zeroPage: 0x24, absolute: 0x2c },

  // Jumps. JMP is the only instruction with plain Indirect.
  JMP: { absolute: 0x4c, indirect: 0x6c },
  JSR: { absolute: 0x20 },

  // Branches (pattern xxy10000): Relative only.
  BPL: { relative: 0x10 },
  BMI: { relative: 0x30 },
  BVC: { relative: 0x50 },
  BVS: { relative: 0x70 },
  BCC: { relative: 0x90 },
  BCS: { relative: 0xb0 },
  BNE: { relative: 0xd0 },
  BEQ: { relative: 0xf0 },

  // One-byte (implied) instructions.
  BRK: { implied: 0x00 },
  RTI: { implied: 0x40 },
  RTS: { implied: 0x60 },
  PHP: { implied: 0x08 },
  PLP: { implied: 0x28 },
  PHA: { implied: 0x48 },
  PLA: { implied: 0x68 },
  CLC: { implied: 0x18 },
  SEC: { implied: 0x38 },
  CLI: { implied: 0x58 },
  SEI: { implied: 0x78 },
  CLV: { implied: 0xb8 },
  CLD: { implied: 0xd8 },
  SED: { implied: 0xf8 },
  DEY: { implied: 0x88 },
  INY: { implied: 0xc8 },
  DEX: { implied: 0xca },
  INX: { implied: 0xe8 },
  TXA: { implied: 0x8a },
  TYA: { implied: 0x98 },
  TXS: { implied: 0x9a },
  TAY: { implied: 0xa8 },
  TAX: { implied: 0xaa },
  TSX: { implied: 0xba },
  NOP: { implied: 0xea },
} as const satisfies Record<string, Partial<Record<AddressingMode, number>>>;

export type Mnemonic = keyof typeof ENCODINGS;

/** True if text is a documented mnemonic. Expects upper case. */
export function isMnemonic(text: string): text is Mnemonic {
  return Object.hasOwn(ENCODINGS, text);
}

/** The opcode for mnemonic in mode, or undefined if that combination doesn't exist. */
export function opcodeFor(mnemonic: Mnemonic, mode: AddressingMode): number | undefined {
  const modes: Partial<Record<AddressingMode, number>> = ENCODINGS[mnemonic];
  return modes[mode];
}

/** The (mode, opcode) pairs a mnemonic has, in table order. */
export function encodingsOf(mnemonic: Mnemonic): readonly (readonly [AddressingMode, number])[] {
  const modes: Partial<Record<AddressingMode, number>> = ENCODINGS[mnemonic];
  const pairs: (readonly [AddressingMode, number])[] = [];
  for (const [mode, opcode] of Object.entries(modes)) {
    // Object.entries types keys as string; they're AddressingMode by construction.
    pairs.push([mode as AddressingMode, opcode]);
  }
  return pairs;
}
