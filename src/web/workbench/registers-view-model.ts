// The registers panel's view-model: pure functions that decide what to show.
//
//   A  &00  0 / 0        X  &00 ...      S  &FD  next push → &01FD
//   PC &0400             P  &24  %00100100
//   N V - B D I Z C      (lights; "-" and B are drawn as "not stored")
//   Next: &0400: &EA NOP
//
// No DOM here: registers-panel.ts turns this into elements, Jest tests this.

import { UnimplementedOpcodeError } from '../../cpu/cpu6502';
import { P_B, P_C, P_D, P_I, P_N, P_UNUSED, P_V, P_Z, packP } from '../../cpu/flags';
import { OPCODES } from '../../cpu/opcodes';
import { hex16, hex8, toSigned8 } from '../../util/bits';
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
  /** e.g. "&0400: &EA NOP". */
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
  const registers = cells.map((cell, i) => ({
    ...cell,
    changed: previous !== undefined && previous.registers[i]?.value !== cell.value,
  }));

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
  const mnemonic = entry === undefined ? '(not implemented yet)' : entry.mnemonic;
  const next = { address: r.pc, opcode, text: `&${hex16(r.pc)}: &${hex8(opcode)} ${mnemonic}` };

  return { registers, flags, next, cycles: formatCycles(target.cycles) };
}

/** "9 cycles = 4.5 µs at 2 MHz": each 6502 cycle on the Model B is 0.5 µs. */
export function formatCycles(cycles: number): string {
  const unit = cycles === 1 ? 'cycle' : 'cycles';
  return `${cycles.toLocaleString('en-GB')} ${unit} = ${(cycles / 2).toLocaleString('en-GB')} µs at 2 MHz`;
}

export interface StepResult {
  readonly steps: number;
  readonly cycles: number;
  /** Set if an unimplemented opcode stopped the run early. */
  readonly error: string | undefined;
}

/**
 * Steps up to n instructions, stopping early at an unimplemented opcode. The
 * error becomes a message for the panel instead of an exception; any other
 * error is a real bug and is rethrown.
 */
export function stepMany(target: CpuTarget, n: number): StepResult {
  let steps = 0;
  let cycles = 0;
  try {
    while (steps < n) {
      cycles += target.step();
      steps++;
    }
  } catch (error) {
    if (!(error instanceof UnimplementedOpcodeError)) throw error;
    return { steps, cycles, error: error.message };
  }
  return { steps, cycles, error: undefined };
}
