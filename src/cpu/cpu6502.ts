// The MOS 6502 CPU: registers, reset, and the fetch-decode-execute loop.
//
// Timing is instruction-stepped (BUILD-PLAN §3): step() runs one whole
// instruction and returns how many 2 MHz cycles it took, so the machine can
// tick the devices by the same amount. step() is the hot path and allocates
// nothing.

import type { Bus } from '../memory/bus';
import { hex16, hex8, hi, lo, word } from '../util/bits';
import { packP } from './flags';
import { OPCODES } from './opcodes';
import { createRegisters, type Registers } from './registers';

/** RESET vector: low byte at &FFFC, high byte at &FFFD (MCS6500 manual; AUG memory map). */
export const RESET_VECTOR = 0xfffc;
/** Cycles in the reset sequence (6502.org "Reset"; Visual6502 traces). */
export const RESET_CYCLES = 7;
/** NMI vector: &FFFA/&FFFB (MCS6500 manual, Chapter 9). MOS 1.20 points it at &0D00 in RAM. */
export const NMI_VECTOR = 0xfffa;
/** IRQ vector, shared with BRK: &FFFE/&FFFF (MCS6500 manual, Chapter 9). */
export const IRQ_VECTOR = 0xfffe;
/** Cycles in the IRQ/NMI/BRK sequence: 2 reads, 3 pushes, 2 vector reads (64doc). */
export const INTERRUPT_CYCLES = 7;

/** Which interrupt the next step() will take instead of an instruction. */
export type InterruptKind = 'nmi' | 'irq';
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
  /**
   * The /IRQ input pin, level-sensitive: true while something is pulling it
   * low ("asserted"). Whoever owns the CPU sets it before each step, from the
   * devices' own lines (BUILD-PLAN §3). The CPU keeps no memory of it: if it
   * goes false before the CPU looks, the request is simply gone.
   */
  irq = false;
  /**
   * The NMI edge detector's latch. setNmi() sets it on a false → true change
   * of the line; taking the NMI clears it. So a pulse is never lost, and a
   * line held low fires only once.
   */
  nmiPending = false;
  /** The /NMI line's last level, so setNmi() can spot an edge. */
  private nmiLine = false;

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
    // Our choice, not a datasheet fact: a stale NMI shouldn't fire into the
    // freshly reset program. irq belongs to the devices, so it's left alone.
    this.nmiPending = false;
    r.s = (r.s - 3) & 0xff;
    r.i = true;
    r.pc = word(this.bus.read(RESET_VECTOR), this.bus.read(RESET_VECTOR + 1));
    this.cycles += RESET_CYCLES;
    return RESET_CYCLES;
  }

  /**
   * Drives the /NMI pin: true = pulled low (asserted). Only the change from
   * released to asserted (the falling edge, in volts) requests an NMI.
   */
  setNmi(asserted: boolean): void {
    if (asserted && !this.nmiLine) this.nmiPending = true;
    this.nmiLine = asserted;
  }

  /** What the next step() will do instead of an instruction, if anything. NMI wins over IRQ. */
  get pendingInterrupt(): InterruptKind | undefined {
    if (this.nmiPending) return 'nmi';
    if (this.irq && !this.regs.i) return 'irq';
    return undefined;
  }

  /**
   * Runs one instruction: fetch the opcode at PC, look it up, execute it.
   * Returns the cycles it took. On an unimplemented opcode, throws with PC
   * and the cycle count unchanged, so you can see exactly where it stopped.
   *
   * First, though, it looks at the interrupt inputs, as the chip does at the
   * end of every instruction. If one is due, this step is the 7-cycle
   * interrupt sequence instead, and the handler's first instruction is the
   * next step.
   */
  step(): number {
    const r = this.regs;
    if (this.nmiPending) {
      this.nmiPending = false;
      return this.interrupt(NMI_VECTOR);
    }
    if (this.irq && !r.i) return this.interrupt(IRQ_VECTOR);
    const opcode = this.bus.read(r.pc);
    const entry = OPCODES[opcode];
    if (entry === undefined) throw new UnimplementedOpcodeError(opcode, r.pc);
    r.pc = (r.pc + 1) & 0xffff;
    const taken = entry.cycles + entry.execute(this);
    this.cycles += taken;
    return taken;
  }

  /**
   * The sequence BRK, IRQ and NMI share (it's BRK's microcode): push PC high
   * then low, push P with bit 5 = 1 and B as given, set I, and load PC from
   * the vector, low byte first. D is left alone (NMOS; the 65C02 clears it).
   * BRK passes b = true, so its handler can tell it from an IRQ.
   */
  enterInterrupt(vector: number, b: boolean): void {
    const r = this.regs;
    this.push(hi(r.pc));
    this.push(lo(r.pc));
    this.push(packP(r, b));
    r.i = true;
    r.pc = word(this.bus.read(vector), this.bus.read((vector + 1) & 0xffff));
  }

  /** A hardware interrupt (IRQ or NMI): the shared sequence with B = 0, as a whole step. */
  private interrupt(vector: number): number {
    this.enterInterrupt(vector, false);
    this.cycles += INTERRUPT_CYCLES;
    return INTERRUPT_CYCLES;
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
