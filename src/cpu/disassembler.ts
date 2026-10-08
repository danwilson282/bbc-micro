// The disassembler: bytes in memory → "LDA (&70),Y".
//
// It's the CPU's decoder run without the execute: the same OPCODES lookup
// step() does, then entry.mnemonic and entry.mode are printed instead of
// entry.execute() being run. Sharing the table means the disassembler can never
// disagree with the CPU about what a byte means.
//
// Decoding only works forwards from a known instruction start. Instructions
// are 1-3 bytes and nothing in a byte says "I'm an opcode", so the same bytes
// decode differently from a different start (A9 01 2C A9 02 is LDA #1 / BIT
// from the A9, LDA #2 from the second A9).
//
// It reads memory through a Peek, never the bus: on the real machine some
// reads have side effects (&FE44 clears a VIA interrupt flag), and a debugger
// must not change the program it's looking at.
//
// The text it prints is valid input for our assembler (Stage 08), so
// disassemble → assemble gives the same bytes back. Not on the hot path, so it
// allocates freely.

import { hex16, hex8, word } from '../util/bits';
import { MODES, relativeTarget, type AddressingMode } from './addressing';
import { OPCODES } from './opcodes';

/** Reads a byte with no side effects: a DebugTarget's peek, or a TestBus's read. */
export type Peek = (address: number) => number;

/** Address → name, e.g. from the assembler's symbols. Operands with a name print as the name. */
export type Labels = ReadonlyMap<number, string>;

export interface DisassembledInstruction {
  readonly address: number;
  /** 1-3 bytes, opcode first. */
  readonly bytes: readonly number[];
  /** "LDA", or ".byte" for an opcode the CPU doesn't run. */
  readonly mnemonic: string;
  /** Undefined for .byte. */
  readonly mode: AddressingMode | undefined;
  /** "#&41", "(&70),Y", "&040D", "A" or "". */
  readonly operand: string;
  /** mnemonic + operand: "LDA (&70),Y". */
  readonly text: string;
  /**
   * The address the operand names: a branch or jump target, a data address,
   * or the pointer for indirect modes. Undefined for immediate (that's data),
   * implied and accumulator.
   */
  readonly target: number | undefined;
  /** Where the next instruction starts: address + length, wrapped to 16 bits. */
  readonly next: number;
}

/** "&70" or "&7C28", or the label if there is one. */
function addressText(value: number, digits: 2 | 4, labels: Labels | undefined): string {
  return labels?.get(value) ?? `&${digits === 2 ? hex8(value) : hex16(value)}`;
}

/** The operand as written: MODES' syntax with nn / nnnn swapped for the value (or its label). */
function formatOperand(mode: AddressingMode, value: number, labels: Labels | undefined): string {
  switch (mode) {
    case 'implied':
      return '';
    case 'immediate':
      // Data, never an address, so never a label.
      return `#&${hex8(value)}`;
    case 'relative':
      return addressText(value, 4, labels);
    default: {
      const digits = MODES[mode].operandBytes === 1 ? 2 : 4;
      const placeholder = digits === 2 ? '&nn' : '&nnnn';
      return MODES[mode].syntax.replace(placeholder, addressText(value, digits, labels));
    }
  }
}

/** Decodes the instruction at address. Reads 1-3 bytes through peek, wrapping past &FFFF. */
export function disassemble(peek: Peek, address: number, labels?: Labels): DisassembledInstruction {
  const start = address & 0xffff;
  const at = (offset: number): number => peek((start + offset) & 0xffff) & 0xff;
  const opcode = at(0);
  const entry = OPCODES[opcode];

  if (entry === undefined) {
    // Undocumented: shown as one byte of data. (The real chip gives some of these 2 or 3 bytes; Part 12.)
    const operand = `&${hex8(opcode)}`;
    return { address: start, bytes: [opcode], mnemonic: '.byte', mode: undefined, operand, text: `.byte ${operand}`, target: undefined, next: (start + 1) & 0xffff };
  }

  const { mnemonic, mode } = entry;
  const operandBytes = MODES[mode].operandBytes;
  const bytes = [opcode];
  for (let i = 1; i <= operandBytes; i++) bytes.push(at(i));
  const next = (start + 1 + operandBytes) & 0xffff;

  // The value the operand bytes hold: one byte, or a word stored low byte first.
  let value = operandBytes === 2 ? word(bytes[1] ?? 0, bytes[2] ?? 0) : (bytes[1] ?? 0);
  // A branch holds an offset from the next instruction; show where it lands.
  if (mode === 'relative') value = relativeTarget(next, value);

  const operand = formatOperand(mode, value, labels);
  const target = operandBytes === 0 || mode === 'immediate' ? undefined : value;
  return { address: start, bytes, mnemonic, mode, operand, text: operand === '' ? mnemonic : `${mnemonic} ${operand}`, target, next };
}

/** count instructions in a row from start, each one beginning where the last ended. */
export function disassembleRange(peek: Peek, start: number, count: number, labels?: Labels): DisassembledInstruction[] {
  const lines: DisassembledInstruction[] = [];
  let address = start & 0xffff;
  for (let i = 0; i < count; i++) {
    const instruction = disassemble(peek, address, labels);
    lines.push(instruction);
    address = instruction.next;
  }
  return lines;
}
