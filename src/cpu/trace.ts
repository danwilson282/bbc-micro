// The trace logger: one entry per CPU step, recorded just BEFORE it runs.
//
// A trace is what actually ran, in order, with the registers at each step.
// Diff two traces (ours and a trusted one) and the first line that differs is
// where the emulator first went wrong. That's how Stages 19 and 20 get debugged.
//
// record() is called before every step, so it's on the hot path: it copies
// numbers into preallocated typed arrays and builds nothing. The arrays are a
// RING BUFFER: entry capacity+1 overwrites entry 1, so the tracer holds the
// most recent `capacity` steps in fixed memory however long the program runs.
// Strings are only made when someone looks (recent(), formatTraceLine()).
//
// The tracer never calls step() itself, and the CPU knows nothing about it:
// whoever owns the CPU calls tracer.record(cpu) and then cpu.step().

import { hex16, hex8 } from '../util/bits';
import type { Cpu6502 } from './cpu6502';
import { IRQ_VECTOR, NMI_VECTOR } from './cpu6502';
import { disassemble, type Labels, type Peek } from './disassembler';
import { P_B, P_C, P_D, P_I, P_N, P_UNUSED, P_V, P_Z, packP } from './flags';
import { OPCODES } from './opcodes';

/** What a step was: an instruction, or the 7-cycle IRQ/NMI sequence (Stage 17). */
export type TraceKind = 'instruction' | 'irq' | 'nmi';

/** Kind codes as stored in the ring buffer. */
const KIND_INSTRUCTION = 0;
const KIND_IRQ = 1;
const KIND_NMI = 2;
const KINDS: readonly TraceKind[] = ['instruction', 'irq', 'nmi'];

/** One step, as recorded. Built by recent() for display; never on the hot path. */
export interface TraceEntry {
  readonly kind: TraceKind;
  /** Total CPU cycles before the step. */
  readonly cycles: number;
  /** PC before the step: the instruction's address, or where the interrupt struck. */
  readonly pc: number;
  /** The instruction's 1-3 bytes as they were when it ran. Empty for an interrupt. */
  readonly bytes: readonly number[];
  readonly a: number;
  readonly x: number;
  readonly y: number;
  readonly s: number;
  /** P as a byte, bit 5 = 1 and B = 0 (what an IRQ would push). */
  readonly p: number;
}

export const DEFAULT_TRACE_CAPACITY = 1024;

export class Tracer {
  private readonly mask: number;
  private readonly kind: Uint8Array;
  private readonly pc: Uint16Array;
  /** 3 bytes per entry: the opcode and the 2 bytes after it, used or not. */
  private readonly bytes: Uint8Array;
  /** 4 bytes per entry: A, X, Y, S. */
  private readonly regs: Uint8Array;
  private readonly p: Uint8Array;
  /** Float64, not Uint32: at 2 MHz a 32-bit count would wrap after 36 minutes. */
  private readonly cycles: Float64Array;
  private count = 0;

  /** peek reads memory with no side effects. capacity must be a power of two (so a mask can wrap the index). */
  constructor(
    private readonly peek: Peek,
    readonly capacity = DEFAULT_TRACE_CAPACITY,
  ) {
    if (capacity < 1 || (capacity & (capacity - 1)) !== 0) {
      throw new RangeError(`trace capacity must be a power of two, not ${String(capacity)}`);
    }
    this.mask = capacity - 1;
    this.kind = new Uint8Array(capacity);
    this.pc = new Uint16Array(capacity);
    this.bytes = new Uint8Array(capacity * 3);
    this.regs = new Uint8Array(capacity * 4);
    this.p = new Uint8Array(capacity);
    this.cycles = new Float64Array(capacity);
  }

  /** Steps recorded since the last clear(). Can be more than capacity. */
  get recorded(): number {
    return this.count;
  }

  /** Entries held right now: at most capacity. */
  get length(): number {
    return Math.min(this.count, this.capacity);
  }

  /**
   * Notes the CPU's state before its next step. Call it just before cpu.step().
   * Hot path: typed-array writes only, nothing allocated.
   */
  record(cpu: Cpu6502): void {
    const slot = this.count & this.mask;
    const r = cpu.regs;
    // An interrupt due now means this step is the interrupt sequence, not the instruction at PC.
    const pending = cpu.pendingInterrupt;
    this.kind[slot] = pending === 'nmi' ? KIND_NMI : pending === 'irq' ? KIND_IRQ : KIND_INSTRUCTION;
    this.pc[slot] = r.pc;
    // Copy the bytes now: self-modifying code may change them before anyone looks.
    const b = slot * 3;
    this.bytes[b] = this.peek(r.pc);
    this.bytes[b + 1] = this.peek((r.pc + 1) & 0xffff);
    this.bytes[b + 2] = this.peek((r.pc + 2) & 0xffff);
    const g = slot * 4;
    this.regs[g] = r.a;
    this.regs[g + 1] = r.x;
    this.regs[g + 2] = r.y;
    this.regs[g + 3] = r.s;
    this.p[slot] = packP(r, false);
    this.cycles[slot] = cpu.cycles;
    this.count++;
  }

  /** The last count entries, oldest first. */
  recent(count: number): TraceEntry[] {
    const n = Math.min(count, this.length);
    const entries: TraceEntry[] = [];
    for (let i = this.count - n; i < this.count; i++) entries.push(this.entry(i & this.mask));
    return entries;
  }

  clear(): void {
    this.count = 0;
  }

  private entry(slot: number): TraceEntry {
    const kind = KINDS[this.kind[slot] ?? KIND_INSTRUCTION] ?? 'instruction';
    const b = slot * 3;
    const opcode = this.bytes[b] ?? 0;
    // An undocumented opcode is shown as 1 byte, as the disassembler does.
    const length = kind === 'instruction' ? (OPCODES[opcode]?.bytes ?? 1) : 0;
    const g = slot * 4;
    return {
      kind,
      cycles: this.cycles[slot] ?? 0,
      pc: this.pc[slot] ?? 0,
      bytes: Array.from(this.bytes.subarray(b, b + length)),
      a: this.regs[g] ?? 0,
      x: this.regs[g + 1] ?? 0,
      y: this.regs[g + 2] ?? 0,
      s: this.regs[g + 3] ?? 0,
      p: this.p[slot] ?? 0,
    };
  }
}

/** P's bits, high to low, with the letter shown when set. Bits 5 and 4 aren't stored, so they're "-". */
const FLAG_LETTERS: readonly (readonly [number, string])[] = [
  [P_N, 'N'],
  [P_V, 'V'],
  [P_UNUSED, '-'],
  [P_B, '-'],
  [P_D, 'D'],
  [P_I, 'I'],
  [P_Z, 'Z'],
  [P_C, 'C'],
];

/** P as letters in bit order, capital = set: &A4 → "Nv--dIzc". */
export function formatFlags(p: number): string {
  return FLAG_LETTERS.map(([mask, letter]) => (letter === '-' ? '-' : (p & mask) !== 0 ? letter : letter.toLowerCase())).join('');
}

/** Column headings that line up with formatTraceLine(). */
export const TRACE_HEADER = '  cycle  PC     bytes     instruction       A  X  Y  S  NV--DIZC';

/**
 * One trace line, e.g.
 *       7  &0400  A2 FF     LDX #&FF          00 00 00 FD nv--dIzc
 * The registers are the state BEFORE the instruction: its result is on the next line.
 */
export function formatTraceLine(entry: TraceEntry, labels?: Labels): string {
  let instruction: string;
  if (entry.kind === 'instruction') {
    // Disassemble the recorded bytes, not today's memory.
    const { bytes, pc } = entry;
    instruction = disassemble((address) => bytes[(address - pc) & 0xffff] ?? 0, pc, labels).text;
  } else {
    const vector = entry.kind === 'nmi' ? NMI_VECTOR : IRQ_VECTOR;
    instruction = `${entry.kind.toUpperCase()} (via &${hex16(vector)})`;
  }
  const regs = [entry.a, entry.x, entry.y, entry.s].map(hex8).join(' ');
  return [
    String(entry.cycles).padStart(7),
    '  ',
    `&${hex16(entry.pc)}`,
    '  ',
    entry.bytes.map(hex8).join(' ').padEnd(10),
    instruction.padEnd(18),
    regs,
    ' ',
    formatFlags(entry.p),
  ].join('');
}
