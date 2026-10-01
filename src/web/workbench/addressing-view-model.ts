// The addressing-mode explorer's view-model: given a mode, an operand and the
// registers, list each step the 6502 takes to find the effective address.
//
//   LDA (&70),Y          &0400: B1 70
//   1. Operand &70: the pointer lives in zero page at &0070/&0071.
//   2. Read pointer low byte from &0070: &00.
//   3. Read pointer high byte from &0071: &7C. Pointer = &7C00.
//   4. Add Y: &00 + &05 = &05, no carry. EA = &7C05.
//   EA = &7C05, which holds &48            5 cycles
//
// It uses the same pure helpers as the CPU (cpu/addressing.ts), so it can't
// disagree about wrap rules, and it reads memory only through peek(), so
// exploring changes nothing. No DOM here: addressing-panel.ts draws it.

import {
  MODES,
  crossesPage,
  indexed,
  jmpIndirectHigh,
  relativeTarget,
  zeroPageIndexed,
  zeroPagePointerHigh,
  type AddressingMode,
} from '../../cpu/addressing';
import { hex16, hex8, hi, lo, toSigned8, word } from '../../util/bits';
import { parseHexAddress, parseHexByte } from './memory-view-model';

/** How a page crossing changes an instruction's cycle count. */
type Penalty = 'none' | 'pageCross' | 'branch';

interface Example {
  readonly mnemonic: string;
  readonly opcode: number;
  /** Base cycles (MCS6500 Programming Manual, Appendix A). */
  readonly cycles: number;
  readonly penalty: Penalty;
}

/** One real instruction per mode, to show the bytes and cycles. LDA where LDA has the mode. */
export const EXAMPLES: Readonly<Record<AddressingMode, Example>> = {
  implied: { mnemonic: 'NOP', opcode: 0xea, cycles: 2, penalty: 'none' },
  accumulator: { mnemonic: 'ASL', opcode: 0x0a, cycles: 2, penalty: 'none' },
  immediate: { mnemonic: 'LDA', opcode: 0xa9, cycles: 2, penalty: 'none' },
  zeroPage: { mnemonic: 'LDA', opcode: 0xa5, cycles: 3, penalty: 'none' },
  zeroPageX: { mnemonic: 'LDA', opcode: 0xb5, cycles: 4, penalty: 'none' },
  zeroPageY: { mnemonic: 'LDX', opcode: 0xb6, cycles: 4, penalty: 'none' },
  absolute: { mnemonic: 'LDA', opcode: 0xad, cycles: 4, penalty: 'none' },
  absoluteX: { mnemonic: 'LDA', opcode: 0xbd, cycles: 4, penalty: 'pageCross' },
  absoluteY: { mnemonic: 'LDA', opcode: 0xb9, cycles: 4, penalty: 'pageCross' },
  indirect: { mnemonic: 'JMP', opcode: 0x6c, cycles: 5, penalty: 'none' },
  indexedIndirectX: { mnemonic: 'LDA', opcode: 0xa1, cycles: 6, penalty: 'none' },
  indirectIndexedY: { mnemonic: 'LDA', opcode: 0xb1, cycles: 5, penalty: 'pageCross' },
  relative: { mnemonic: 'BNE', opcode: 0xd0, cycles: 2, penalty: 'branch' },
};

export interface ExplorerInput {
  readonly mode: AddressingMode;
  /** A byte for 1-operand-byte modes (the signed offset for relative), a word for 2. */
  readonly operand: number;
  readonly a: number;
  readonly x: number;
  readonly y: number;
  /** Address of the opcode byte. */
  readonly pc: number;
}

export interface ExplainStep {
  readonly text: string;
  /** A wrap-around, page crossing or hardware bug worth noticing. */
  readonly warn: boolean;
}

export interface Explanation {
  /** e.g. "LDA (&70),Y". */
  readonly instruction: string;
  /** e.g. "&0400: B1 70". */
  readonly bytes: string;
  readonly steps: readonly ExplainStep[];
  /** undefined for implied and accumulator. For relative, the branch target. */
  readonly ea: number | undefined;
  readonly pageCrossed: boolean;
  readonly result: string;
  readonly cycles: string;
}

const h8 = (v: number): string => `&${hex8(v)}`;
const h16 = (v: number): string => `&${hex16(v)}`;

/** Works out the EA the way the 6502 does, one step at a time, reading memory with peek. */
export function explainAddressing(input: ExplorerInput, peek: (address: number) => number): Explanation {
  const { mode, a, x, y } = input;
  const pc = input.pc & 0xffff;
  const example = EXAMPLES[mode];
  const info = MODES[mode];
  const operand = info.operandBytes === 1 ? input.operand & 0xff : input.operand & 0xffff;
  const steps: ExplainStep[] = [];
  const say = (text: string, warn = false): void => {
    steps.push({ text, warn });
  };
  let ea: number | undefined;
  let pageCrossed = false;

  /** Indexed add shared by abs,X / abs,Y / (zp),Y: the low-byte add, then any carry. */
  const addIndex = (base: number, reg: 'X' | 'Y', index: number): number => {
    const sum = indexed(base, index);
    const carry = lo(base) + index > 0xff;
    if (!carry) {
      say(`Add ${reg} to the low byte: ${h8(lo(base))} + ${h8(index)} = ${h8(lo(sum))}, no carry. EA = ${h16(sum)}.`);
      return sum;
    }
    pageCrossed = true;
    say(`Add ${reg} to the low byte: ${h8(lo(base))} + ${h8(index)} = ${h8(lo(sum))}, carry 1.`);
    say(
      `Page crossed! The CPU has already read ${h16(word(lo(sum), hi(base)))} (old high byte, wrong page) and throws it away. ` +
        `It adds the carry to the high byte, ${h8(hi(base))} → ${h8(hi(sum))}, in an extra cycle.`,
      true,
    );
    if (sum < base) say(`The high byte wrapped from &FF to &00: the address space wraps round to ${h16(sum)}.`, true);
    say(`EA = ${h16(sum)}.`);
    return sum;
  };

  /** Reads a two-byte pointer whose high byte lives at highAt (which may wrap). */
  const readPointer = (lowAt: number, highAt: number, wrapNote: string | undefined): number => {
    const low = peek(lowAt);
    say(`Read pointer low byte from ${h16(lowAt)}: ${h8(low)}.`);
    const high = peek(highAt);
    const pointer = word(low, high);
    if (wrapNote === undefined) {
      say(`Read pointer high byte from ${h16(highAt)}: ${h8(high)}. Pointer = ${h16(pointer)}.`);
    } else {
      say(`Read pointer high byte from ${h16(highAt)}, ${wrapNote}: ${h8(high)}. Pointer = ${h16(pointer)}.`, true);
    }
    return pointer;
  };

  /** zp + index in 8 bits, noting any dropped carry. */
  const zeroPageAdd = (zp: number, reg: 'X' | 'Y', index: number): number => {
    const sum = zeroPageIndexed(zp, index);
    if (zp + index > 0xff) {
      say(
        `Add ${reg} in 8 bits: ${h8(zp)} + ${h8(index)} = ${h16(zp + index)}, but the carry is dropped, so it stays in page zero: ${h16(sum)} (not ${h16(zp + index)}).`,
        true,
      );
    } else {
      say(`Add ${reg} in 8 bits: ${h8(zp)} + ${h8(index)} = ${h8(sum)}, i.e. ${h16(sum)}.`);
    }
    return sum;
  };

  switch (mode) {
    case 'implied':
      say('No operand bytes: the opcode alone says what to do (NOP does nothing; INX would use X).');
      break;
    case 'accumulator':
      say(`No operand bytes: the operand is the accumulator, A = ${h8(a)}.`);
      break;
    case 'immediate':
      ea = (pc + 1) & 0xffff;
      say(`The operand byte ${h8(operand)} follows the opcode, at ${h16(ea)}.`);
      say(`The data IS that byte, so the EA is its own address (PC): ${h16(ea)}.`);
      break;
    case 'zeroPage':
      ea = operand;
      say(`Operand ${h8(operand)} is a zero-page address: the high byte is &00, so EA = ${h16(ea)}.`);
      break;
    case 'zeroPageX':
    case 'zeroPageY':
      say(`Operand ${h8(operand)} is a zero-page address.`);
      ea = mode === 'zeroPageX' ? zeroPageAdd(operand, 'X', x) : zeroPageAdd(operand, 'Y', y);
      break;
    case 'absolute':
      ea = operand;
      say(`Operand bytes ${hex8(lo(operand))} ${hex8(hi(operand))} (low byte first) make the address ${h16(operand)}.`);
      say(`EA = ${h16(ea)}.`);
      break;
    case 'absoluteX':
    case 'absoluteY':
      say(`Operand bytes ${hex8(lo(operand))} ${hex8(hi(operand))} (low byte first): base = ${h16(operand)}.`);
      ea = mode === 'absoluteX' ? addIndex(operand, 'X', x) : addIndex(operand, 'Y', y);
      break;
    case 'indirect': {
      say(`Operand bytes ${hex8(lo(operand))} ${hex8(hi(operand))} (low byte first): the pointer is at ${h16(operand)}.`);
      const highAt = jmpIndirectHigh(operand);
      const bugNote =
        lo(operand) === 0xff
          ? `not ${h16((operand + 1) & 0xffff)}, because the NMOS 6502 increments only the pointer's low byte (the JMP indirect bug)`
          : undefined;
      ea = readPointer(operand, highAt, bugNote);
      say(`Jump target = ${h16(ea)}.`);
      break;
    }
    case 'indexedIndirectX': {
      say(`Operand ${h8(operand)}: a zero-page address. Index FIRST, then follow the pointer.`);
      const at = zeroPageAdd(operand, 'X', x);
      ea = readPointer(at, zeroPagePointerHigh(at), at === 0xff ? 'not &0100, because the pointer stays in page zero' : undefined);
      say(`EA = ${h16(ea)}.`);
      break;
    }
    case 'indirectIndexedY': {
      say(`Operand ${h8(operand)}: the pointer lives in zero page at ${h16(operand)}. Follow the pointer FIRST, then index.`);
      const pointer = readPointer(
        operand,
        zeroPagePointerHigh(operand),
        operand === 0xff ? 'not &0100, because the pointer stays in page zero' : undefined,
      );
      ea = addIndex(pointer, 'Y', y);
      break;
    }
    case 'relative': {
      const next = (pc + 2) & 0xffff;
      const offset = toSigned8(operand);
      ea = relativeTarget(next, operand);
      pageCrossed = crossesPage(next, ea);
      say(`Operand ${h8(operand)} is a signed offset: ${offset < 0 ? '−' : '+'}${String(Math.abs(offset))}.`);
      say(`It counts from the NEXT instruction, ${h16(next)} (PC after the 2-byte branch).`);
      say(`${h16(next)} ${offset < 0 ? '−' : '+'} ${String(Math.abs(offset))} = ${h16(ea)}.`);
      if (pageCrossed) {
        say(
          `The target is in page ${h8(hi(ea))} but the next instruction is in page ${h8(hi(next))}: a taken branch fixes the high byte in an extra cycle.`,
          true,
        );
      }
      break;
    }
  }

  return {
    instruction: instructionText(mode, operand, ea),
    bytes: bytesText(pc, example.opcode, operand, info.operandBytes),
    steps,
    ea,
    pageCrossed,
    result: resultText(mode, ea, a, peek),
    cycles: cyclesText(example, pageCrossed),
  };
}

function instructionText(mode: AddressingMode, operand: number, ea: number | undefined): string {
  const { mnemonic } = EXAMPLES[mode];
  const syntax = MODES[mode].syntax;
  if (syntax === '') return mnemonic;
  if (mode === 'relative') return `${mnemonic} ${h16(ea ?? 0)}`;
  const filled = syntax.replace('nnnn', hex16(operand)).replace('nn', hex8(operand));
  return `${mnemonic} ${filled}`;
}

function bytesText(pc: number, opcode: number, operand: number, operandBytes: 0 | 1 | 2): string {
  const bytes = [opcode, lo(operand), hi(operand)].slice(0, 1 + operandBytes);
  return `${h16(pc)}: ${bytes.map(hex8).join(' ')}`;
}

function resultText(mode: AddressingMode, ea: number | undefined, a: number, peek: (address: number) => number): string {
  if (mode === 'accumulator') return `No effective address: the instruction works on A = ${h8(a)}.`;
  if (ea === undefined) return 'No effective address.';
  if (mode === 'relative') return `Branch target = ${h16(ea)}`;
  if (mode === 'indirect') return `Jump target = ${h16(ea)}`;
  return `EA = ${h16(ea)}, which holds ${h8(peek(ea))}`;
}

function cyclesText(example: Example, pageCrossed: boolean): string {
  const c = example.cycles;
  switch (example.penalty) {
    case 'none':
      return `${String(c)} cycles`;
    case 'pageCross':
      return pageCrossed ? `${String(c)} + 1 (page crossed) = ${String(c + 1)} cycles` : `${String(c)} cycles`;
    case 'branch':
      return pageCrossed ? `${String(c)} cycles not taken, ${String(c + 2)} if taken (page crossed)` : `${String(c)} cycles not taken, ${String(c + 1)} if taken`;
  }
}

// --- Parsing the panel's text fields ------------------------------------------

export interface ExplorerFields {
  readonly mode: string;
  readonly operand: string;
  readonly a: string;
  readonly x: string;
  readonly y: string;
  readonly pc: string;
}

export type ParseResult = { readonly ok: true; readonly input: ExplorerInput } | { readonly ok: false; readonly error: string };

function isMode(text: string): text is AddressingMode {
  return Object.hasOwn(MODES, text);
}

/** Turns the panel's text fields into an input, or says which field is wrong. */
export function parseExplorerInput(fields: ExplorerFields): ParseResult {
  if (!isMode(fields.mode)) return { ok: false, error: `Unknown mode "${fields.mode}"` };
  const mode = fields.mode;
  const bytes = MODES[mode].operandBytes;

  let operand = 0;
  if (bytes > 0) {
    const parsed = bytes === 1 ? parseHexByte(fields.operand) : parseHexAddress(fields.operand);
    if (parsed === undefined) {
      return { ok: false, error: bytes === 1 ? 'Operand must be one byte, &00-&FF' : 'Operand must be an address, &0000-&FFFF' };
    }
    operand = parsed;
  }

  const registers: { a?: number; x?: number; y?: number } = {};
  for (const name of ['a', 'x', 'y'] as const) {
    const value = parseHexByte(fields[name]);
    if (value === undefined) return { ok: false, error: `${name.toUpperCase()} must be one byte, &00-&FF` };
    registers[name] = value;
  }
  const pc = parseHexAddress(fields.pc);
  if (pc === undefined) return { ok: false, error: 'Instruction address must be &0000-&FFFF' };

  return { ok: true, input: { mode, operand, a: registers.a ?? 0, x: registers.x ?? 0, y: registers.y ?? 0, pc } };
}

export interface Preset {
  readonly label: string;
  readonly fields: ExplorerFields;
}

const at0400 = { a: '00', x: '00', y: '00', pc: '&0400' } as const;

/** Worked examples for the panel's buttons. main.ts plants the pointers they follow. */
export const PRESETS: readonly Preset[] = [
  { label: 'Zero-page wrap: LDA &FF,X', fields: { ...at0400, mode: 'zeroPageX', operand: '&FF', x: '01' } },
  { label: 'Page cross: LDA &30F8,Y', fields: { ...at0400, mode: 'absoluteY', operand: '&30F8', y: '10' } },
  { label: 'Screen pointer: LDA (&70),Y', fields: { ...at0400, mode: 'indirectIndexedY', operand: '&70', y: '07' } },
  { label: 'Pointer wrap: LDA (&FF,X)', fields: { ...at0400, mode: 'indexedIndirectX', operand: '&FF' } },
  { label: 'JMP bug: JMP (&30FF)', fields: { ...at0400, mode: 'indirect', operand: '&30FF' } },
  { label: 'Branch back: BNE −128', fields: { ...at0400, mode: 'relative', operand: '&80' } },
];
