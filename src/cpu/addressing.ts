// Addressing modes: how an instruction finds the byte it works on.
//
// Most modes end in one 16-bit EFFECTIVE ADDRESS (EA). LDA reads it, STA
// writes it, INC reads it and writes it back. Writing each mode once here
// means the wrap-around rules live in exactly one place.
//
// The 6502's ALU is 8 bits wide, so its address arithmetic happens a byte at a
// time. That gives the three rules everything below follows:
//   - zero-page modes add in 8 bits and drop the carry: &FF + 1 = &00
//   - absolute and (zp),Y indexing add the carry into the high byte in an
//     extra cycle, which is why a page crossing costs +1 on reads
//   - JMP (ind) never carries into the pointer's high byte (the NMOS bug)
//
// The addr* functions run inside step(), so they allocate nothing. Each one
// returns the EA and sets cpu.pageCrossed; the instruction decides what a
// crossing costs (reads +1, stores and read-modify-write always pay).

import { toSigned8, word } from '../util/bits';
import type { Cpu6502 } from './cpu6502';

/** The 13 addressing modes of the NMOS 6502 (MCS6500 Programming Manual, §5 and Appendix B). */
export type AddressingMode =
  | 'implied'
  | 'accumulator'
  | 'immediate'
  | 'zeroPage'
  | 'zeroPageX'
  | 'zeroPageY'
  | 'absolute'
  | 'absoluteX'
  | 'absoluteY'
  | 'indirect'
  | 'indexedIndirectX'
  | 'indirectIndexedY'
  | 'relative';

export interface ModeInfo {
  /** Human name, as the MCS6500 manual words it. */
  readonly name: string;
  /** Bytes after the opcode: 0, 1 or 2. */
  readonly operandBytes: 0 | 1 | 2;
  /** Assembler syntax with nn / nnnn for the operand, e.g. "&nn,X". */
  readonly syntax: string;
}

/** Facts about each mode, for the explorer now and the assembler/disassembler later (Stages 08, 18). */
export const MODES = {
  implied: { name: 'Implied', operandBytes: 0, syntax: '' },
  accumulator: { name: 'Accumulator', operandBytes: 0, syntax: 'A' },
  immediate: { name: 'Immediate', operandBytes: 1, syntax: '#&nn' },
  zeroPage: { name: 'Zero page', operandBytes: 1, syntax: '&nn' },
  zeroPageX: { name: 'Zero page,X', operandBytes: 1, syntax: '&nn,X' },
  zeroPageY: { name: 'Zero page,Y', operandBytes: 1, syntax: '&nn,Y' },
  absolute: { name: 'Absolute', operandBytes: 2, syntax: '&nnnn' },
  absoluteX: { name: 'Absolute,X', operandBytes: 2, syntax: '&nnnn,X' },
  absoluteY: { name: 'Absolute,Y', operandBytes: 2, syntax: '&nnnn,Y' },
  indirect: { name: 'Indirect', operandBytes: 2, syntax: '(&nnnn)' },
  indexedIndirectX: { name: '(Indirect,X)', operandBytes: 1, syntax: '(&nn,X)' },
  indirectIndexedY: { name: '(Indirect),Y', operandBytes: 1, syntax: '(&nn),Y' },
  relative: { name: 'Relative', operandBytes: 1, syntax: '&nnnn' },
} as const satisfies Record<AddressingMode, ModeInfo>;

// --- Pure address arithmetic -------------------------------------------------
// No bus, no CPU: just the wrap rules. The workbench explorer uses these too,
// so it can never disagree with the CPU.

/** Zero page,X / ,Y and the (zp,X) pointer: 8-bit add, carry dropped. &FF + &01 = &00. */
export function zeroPageIndexed(zp: number, index: number): number {
  return (zp + index) & 0xff;
}

/** Absolute,X / ,Y and (zp),Y: 16-bit add, wrapping &FFFF + &01 to &0000. */
export function indexed(base: number, index: number): number {
  return (base + index) & 0xffff;
}

/** True if from and to are in different pages (their high bytes differ). */
export function crossesPage(from: number, to: number): boolean {
  return ((from ^ to) & 0xff00) !== 0;
}

/** Where a zero-page pointer keeps its high byte: the next byte, still in page zero. &FF → &00. */
export function zeroPagePointerHigh(zp: number): number {
  return (zp + 1) & 0xff;
}

/**
 * Where JMP (ptr) reads its high byte. The NMOS 6502 increments only the low
 * byte of the pointer, so JMP (&30FF) reads &30FF then &3000, not &3100.
 * (The 65C02 fixed this; the Model B's 6502 has the bug.)
 */
export function jmpIndirectHigh(ptr: number): number {
  return (ptr & 0xff00) | ((ptr + 1) & 0xff);
}

/** A branch target: next-instruction address + signed offset (-128..+127). */
export function relativeTarget(pc: number, offset: number): number {
  return (pc + toSigned8(offset)) & 0xffff;
}

// --- Effective-address functions ----------------------------------------------
// Each is called after step() has fetched the opcode, so PC is on the first
// operand byte. Each fetches its operand (advancing PC), reads any pointer,
// sets cpu.pageCrossed, and returns the EA. Implied and accumulator have no EA.

/** Two operand bytes, low first (6502 memory order). */
function fetchWord(cpu: Cpu6502): number {
  const low = cpu.fetchByte();
  const high = cpu.fetchByte();
  return word(low, high);
}

/** #&nn: the operand byte IS the data, so its own address (PC) is the EA. */
export function addrImmediate(cpu: Cpu6502): number {
  const ea = cpu.regs.pc;
  cpu.regs.pc = (ea + 1) & 0xffff;
  cpu.pageCrossed = false;
  return ea;
}

/** &nn: the high byte is &00. */
export function addrZeroPage(cpu: Cpu6502): number {
  cpu.pageCrossed = false;
  return cpu.fetchByte();
}

/** &nn,X: stays in page zero. */
export function addrZeroPageX(cpu: Cpu6502): number {
  cpu.pageCrossed = false;
  return zeroPageIndexed(cpu.fetchByte(), cpu.regs.x);
}

/** &nn,Y: stays in page zero. Only LDX and STX use it. */
export function addrZeroPageY(cpu: Cpu6502): number {
  cpu.pageCrossed = false;
  return zeroPageIndexed(cpu.fetchByte(), cpu.regs.y);
}

/** &nnnn */
export function addrAbsolute(cpu: Cpu6502): number {
  cpu.pageCrossed = false;
  return fetchWord(cpu);
}

/** &nnnn,X */
export function addrAbsoluteX(cpu: Cpu6502): number {
  const base = fetchWord(cpu);
  const ea = indexed(base, cpu.regs.x);
  cpu.pageCrossed = crossesPage(base, ea);
  return ea;
}

/** &nnnn,Y */
export function addrAbsoluteY(cpu: Cpu6502): number {
  const base = fetchWord(cpu);
  const ea = indexed(base, cpu.regs.y);
  cpu.pageCrossed = crossesPage(base, ea);
  return ea;
}

/** (&nnnn): JMP only. The EA is the word stored at the pointer, with the page-wrap bug. */
export function addrIndirect(cpu: Cpu6502): number {
  const ptr = fetchWord(cpu);
  const bus = cpu.bus;
  cpu.pageCrossed = false;
  return word(bus.read(ptr), bus.read(jmpIndirectHigh(ptr)));
}

/** (&nn,X): add X to the zero-page address first, then read the pointer there. */
export function addrIndexedIndirectX(cpu: Cpu6502): number {
  const zp = zeroPageIndexed(cpu.fetchByte(), cpu.regs.x);
  const bus = cpu.bus;
  cpu.pageCrossed = false;
  return word(bus.read(zp), bus.read(zeroPagePointerHigh(zp)));
}

/** (&nn),Y: read the pointer at &nn first, then add Y to it. */
export function addrIndirectIndexedY(cpu: Cpu6502): number {
  const zp = cpu.fetchByte();
  const bus = cpu.bus;
  const base = word(bus.read(zp), bus.read(zeroPagePointerHigh(zp)));
  const ea = indexed(base, cpu.regs.y);
  cpu.pageCrossed = crossesPage(base, ea);
  return ea;
}

/**
 * Branch offset: returns the target. The offset counts from the NEXT
 * instruction (PC after the operand). pageCrossed means a taken branch costs
 * +2 rather than +1 (Stage 14).
 */
export function addrRelative(cpu: Cpu6502): number {
  const offset = cpu.fetchByte();
  const next = cpu.regs.pc;
  const target = relativeTarget(next, offset);
  cpu.pageCrossed = crossesPage(next, target);
  return target;
}
