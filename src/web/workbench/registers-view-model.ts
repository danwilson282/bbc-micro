// The registers panel's view-model: pure functions that decide what to show.
//
//   A  &B5  %1011 0101  181 / −75      (A, X, Y: bits that just changed are marked)
//   X  &00  %0000 0000  0 / 0          S  &FD  next push → &01FD
//   PC &0400             P  &24  %00100100
//   N V - B D I Z C      (lights; "-" and B are drawn as "not stored")
//   Next: &0400: &EA NOP
//   Next: IRQ → &0700 (vector &FFFE), before &0400: &EA NOP   (an interrupt is due)
//
// No DOM here: registers-panel.ts turns this into elements, Jest tests this.

import { IRQ_VECTOR, NMI_VECTOR, UnimplementedOpcodeError } from '../../cpu/cpu6502';
import { P_B, P_C, P_D, P_I, P_N, P_UNUSED, P_V, P_Z, packP } from '../../cpu/flags';
import { OPCODES } from '../../cpu/opcodes';
import { hex16, hex8, toSigned8, word } from '../../util/bits';
import type { CpuTarget } from './debug-target';

export type RegisterName = 'A' | 'X' | 'Y' | 'S' | 'PC' | 'P';
export type FlagName = 'N' | 'V' | '-' | 'B' | 'D' | 'I' | 'Z' | 'C';

export interface RegisterCell {
  readonly name: RegisterName;
  readonly value: number;
  /** e.g. "&3F", or "&0400" for PC. */
  readonly hex: string;
  /** A second reading of the value: decimal, a stack address, or binary. */
  readonly detail: string;
  /** e.g. "%1011 0101" for A, X and Y; "" for S, PC and P (P's binary is its detail). */
  readonly binary: string;
  /** A, X and Y's eight bits, bit 7 first; empty for the others. */
  readonly bits: readonly RegisterBit[];
  readonly changed: boolean;
}

export interface RegisterBit {
  /** 7 down to 0. */
  readonly bit: number;
  readonly on: boolean;
  /** This bit differs from the previous view: e.g. only bit 5 after EOR #&20. */
  readonly changed: boolean;
}

export interface FlagLight {
  readonly name: FlagName;
  /** The bit as it would be pushed by an IRQ (bit 5 = 1, B = 0). */
  readonly on: boolean;
  /** False for B and bit 5: the 6502 has no flip-flop for them. */
  readonly stored: boolean;
  readonly title: string;
  readonly changed: boolean;
}

export interface NextInstruction {
  readonly address: number;
  readonly opcode: number;
  /** e.g. "&0400: &EA NOP", or "IRQ → &0700 (vector &FFFE), before &0400: &EA NOP" when an interrupt is due. */
  readonly text: string;
}

export interface RegistersView {
  readonly registers: readonly RegisterCell[];
  readonly flags: readonly FlagLight[];
  readonly next: NextInstruction;
  readonly cycles: string;
}

/** Bit 7 down to bit 0, as the MCS6500 manual draws P. */
const FLAG_BITS: readonly { name: FlagName; mask: number; title: string }[] = [
  { name: 'N', mask: P_N, title: 'Negative: bit 7 of the last result' },
  { name: 'V', mask: P_V, title: 'oVerflow: signed overflow' },
  { name: '-', mask: P_UNUSED, title: 'Bit 5: not stored, always pushed as 1' },
  { name: 'B', mask: P_B, title: 'Break: not stored, only exists in the pushed copy of P' },
  { name: 'D', mask: P_D, title: 'Decimal mode' },
  { name: 'I', mask: P_I, title: 'IRQ disable' },
  { name: 'Z', mask: P_Z, title: 'Zero: the last result was &00' },
  { name: 'C', mask: P_C, title: 'Carry' },
];

/** Builds the panel's data. If previous is given, anything that differs from it is marked changed. */
export function buildRegistersView(target: CpuTarget, previous?: RegistersView): RegistersView {
  const r = target.registers;
  const p = packP(r, false);
  const byteDetail = (v: number): string => `${String(v)} / ${String(toSigned8(v)).replace('-', '−')}`;

  const cells: { name: RegisterName; value: number; hex: string; detail: string }[] = [
    { name: 'A', value: r.a, hex: `&${hex8(r.a)}`, detail: byteDetail(r.a) },
    { name: 'X', value: r.x, hex: `&${hex8(r.x)}`, detail: byteDetail(r.x) },
    { name: 'Y', value: r.y, hex: `&${hex8(r.y)}`, detail: byteDetail(r.y) },
    { name: 'S', value: r.s, hex: `&${hex8(r.s)}`, detail: `next push → &01${hex8(r.s)}` },
    { name: 'PC', value: r.pc, hex: `&${hex16(r.pc)}`, detail: '' },
    { name: 'P', value: p, hex: `&${hex8(p)}`, detail: `%${p.toString(2).padStart(8, '0')}` },
  ];
  const registers = cells.map((cell, i) => {
    const before = previous?.registers[i]?.value;
    const isByte = cell.name === 'A' || cell.name === 'X' || cell.name === 'Y';
    return {
      ...cell,
      binary: isByte ? formatBinary(cell.value) : '',
      // old EOR new has a 1 exactly where a bit flipped.
      bits: isByte ? bitsOf(cell.value, before === undefined ? 0 : before ^ cell.value) : [],
      changed: previous !== undefined && before !== cell.value,
    };
  });

  const flags = FLAG_BITS.map(({ name, mask, title }, i) => {
    const on = (p & mask) !== 0;
    return {
      name,
      on,
      stored: name !== '-' && name !== 'B',
      title,
      changed: previous !== undefined && previous.flags[i]?.on !== on,
    };
  });

  const opcode = target.peek(r.pc);
  const entry = OPCODES[opcode];
  const mnemonic = entry === undefined ? '(undocumented: not implemented)' : entry.mnemonic;
  const instruction = `&${hex16(r.pc)}: &${hex8(opcode)} ${mnemonic}`;
  const due = target.pendingInterrupt;
  let text = instruction;
  if (due !== undefined) {
    const vector = due === 'nmi' ? NMI_VECTOR : IRQ_VECTOR;
    const handler = word(target.peek(vector), target.peek(vector + 1));
    text = `${due.toUpperCase()} → &${hex16(handler)} (vector &${hex16(vector)}), before ${instruction}`;
  }
  const next = { address: r.pc, opcode, text };

  return { registers, flags, next, cycles: formatCycles(target.cycles) };
}

/** A byte in binary with the nibbles split, one per hex digit: &B5 → "%1011 0101". */
export function formatBinary(value: number): string {
  const bits = (value & 0xff).toString(2).padStart(8, '0');
  return `%${bits.slice(0, 4)} ${bits.slice(4)}`;
}

/** The eight bits of value, bit 7 first, marking the ones set in changedMask. */
function bitsOf(value: number, changedMask: number): RegisterBit[] {
  const bits: RegisterBit[] = [];
  for (let bit = 7; bit >= 0; bit--) {
    const mask = 1 << bit;
    bits.push({ bit, on: (value & mask) !== 0, changed: (changedMask & mask) !== 0 });
  }
  return bits;
}

/** The panel's message after a run: "Ran 1 (4 cycles), 1 write". Writes are only mentioned if there were some. */
export function describeRun(result: StepResult): string {
  const writes = result.writes === 0 ? '' : `, ${String(result.writes)} ${result.writes === 1 ? 'write' : 'writes'}`;
  const ran = `Ran ${String(result.steps)}`;
  if (result.error !== undefined) return result.steps > 0 ? `${ran}${writes}, then stopped: ${result.error}` : result.error;
  return `${ran} (${String(result.cycles)} cycles)${writes}`;
}

/**
 * "9 cycles = 4.5 µs at 2 MHz": each 6502 cycle on the Model B is 0.5 µs.
 * Longer runs switch to ms (from 2,000 cycles) and seconds (from 2,000,000).
 */
export function formatCycles(cycles: number): string {
  const unit = cycles === 1 ? 'cycle' : 'cycles';
  return `${cycles.toLocaleString('en-GB')} ${unit} = ${emulatedTime(cycles)} at 2 MHz`;
}

/** How long cycles take at 2 MHz: "4.5 µs", "170 ms", "4.43 s". */
function emulatedTime(cycles: number): string {
  const microseconds = cycles / 2;
  if (microseconds < 1000) return `${microseconds.toLocaleString('en-GB')} µs`;
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} ms`;
  return `${(microseconds / 1_000_000).toLocaleString('en-GB', { maximumFractionDigits: 2 })} s`;
}

export interface StepResult {
  readonly steps: number;
  readonly cycles: number;
  /** Bus writes the CPU made during the run. */
  readonly writes: number;
  /** Set if an unimplemented opcode stopped the run early. */
  readonly error: string | undefined;
}

/**
 * Steps up to n instructions, stopping early at an unimplemented opcode. The
 * error becomes a message for the panel instead of an exception; any other
 * error is a real bug and is rethrown.
 *
 * Clears the write log first, once, so afterwards it holds everything this
 * run wrote: one instruction for Step, up to 16 for Step ×16.
 */
export function stepMany(target: CpuTarget, n: number): StepResult {
  let steps = 0;
  let cycles = 0;
  target.writes.clear();
  try {
    while (steps < n) {
      cycles += target.step();
      steps++;
    }
  } catch (error) {
    if (!(error instanceof UnimplementedOpcodeError)) throw error;
    return { steps, cycles, writes: target.writes.count, error: error.message };
  }
  return { steps, cycles, writes: target.writes.count, error: undefined };
}
