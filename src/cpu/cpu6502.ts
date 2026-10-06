// The MOS 6502 CPU: registers, reset, and the fetch-decode-execute loop.
//
// Timing is instruction-stepped (BUILD-PLAN §3): step() runs one whole
// instruction and returns how many 2 MHz cycles it took, so the machine can
// tick the devices by the same amount. step() is the hot path and allocates
// nothing.

import type { Bus } from '../memory/bus';
import { hex16, hex8, word } from '../util/bits';
import { OPCODES } from './opcodes';
import { createRegisters, type Registers } from './registers';

/** RESET vector: low byte at &FFFC, high byte at &FFFD (MCS6500 manual; AUG memory map). */
export const RESET_VECTOR = 0xfffc;
/** Cycles in the reset sequence (6502.org "Reset"; Visual6502 traces). */
export const RESET_CYCLES = 7;
/**
 * The stack's page. The 6502 hard-wires the high byte of every stack address
 * to &01, so S (8 bits) only ever picks a byte in &0100-&01FF
 * (MCS6500 Programming Manual, §8 "Stack processing").
 */
export const STACK_PAGE = 0x0100;

/** Thrown by step() when the opcode's table slot is empty. PC is left on the opcode. */
export class UnimplementedOpcodeError extends Error {
  override readonly name = 'UnimplementedOpcodeError';

  constructor(
    readonly opcode: number,
    readonly address: number,
  ) {
    super(`unimplemented opcode &${hex8(opcode)} at &${hex16(address)}`);
  }
}

export class Cpu6502 {
  readonly regs: Registers = createRegisters();
  /** Total cycles since power-on. Not zeroed by reset: time keeps flowing. */
  cycles = 0;
  /**
   * Set by every addressing function (addressing.ts): did indexing carry into
   * the high byte? Read instructions add a cycle when it's true. A field, not
   * a return value, so the hot path never allocates a { ea, crossed } object.
   */
  pageCrossed = false;

  constructor(readonly bus: Bus) {}

  /**
   * The 7-cycle RESET sequence. The chip does three stack "pushes" with R/W
   * held high, so they are reads: nothing is written but S still drops by 3.
   * Then I is set and PC is loaded from &FFFC/&FFFD. A, X, Y and D are left
   * alone (the NMOS 6502 does not clear D; the 65C02 does). The three dummy
   * stack reads aren't modelled: reading RAM has no side effects.
   */
  reset(): number {
    const r = this.regs;
    r.s = (r.s - 3) & 0xff;
    r.i = true;
    r.pc = word(this.bus.read(RESET_VECTOR), this.bus.read(RESET_VECTOR + 1));
    this.cycles += RESET_CYCLES;
    return RESET_CYCLES;
  }

  /**
   * Runs one instruction: fetch the opcode at PC, look it up, execute it.
   * Returns the cycles it took. On an unimplemented opcode, throws with PC
   * and the cycle count unchanged, so you can see exactly where it stopped.
   */
  step(): number {
    const r = this.regs;
    const opcode = this.bus.read(r.pc);
    const entry = OPCODES[opcode];
    if (entry === undefined) throw new UnimplementedOpcodeError(opcode, r.pc);
    r.pc = (r.pc + 1) & 0xffff;
    const taken = entry.cycles + entry.execute(this);
    this.cycles += taken;
    return taken;
  }

  /**
   * Pushes a byte: write it at &0100 + S, then S - 1. S always points at the
   * next free slot (an "empty descending" stack). S wraps &00 → &FF, so the
   * stack never leaves page 1: it overwrites its own bottom instead.
   */
  push(value: number): void {
    const r = this.regs;
    this.bus.write(STACK_PAGE | r.s, value & 0xff);
    r.s = (r.s - 1) & 0xff;
  }

  /** Pulls a byte: S + 1 first, then read &0100 + S. The byte stays in memory; only S moves. */
  pull(): number {
    const r = this.regs;
    r.s = (r.s + 1) & 0xff;
    return this.bus.read(STACK_PAGE | r.s);
  }

  /** Reads the byte at PC and moves PC past it. The addressing modes use it for operand bytes. */
  fetchByte(): number {
    const r = this.regs;
    const value = this.bus.read(r.pc);
    r.pc = (r.pc + 1) & 0xffff;
    return value;
  }
}
