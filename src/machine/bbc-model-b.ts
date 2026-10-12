// The BBC Micro Model B: the CPU, the memory map with its ROMs, and the
// chips, put together and moved forward in time together (Stage 27).
//
//   Cpu6502 ──▶ WriteRecorder ──▶ BbcMemoryMap ──▶ RAM, ROMs, SHEILA chips, FRED card
//      ▲                                                  │
//      └──────────── /IRQ ◀── wire-OR ◀── irq ────────────┘
//
// It's a scheduler as well as a box of parts. The real chips all run at once
// off one crystal; we take turns, one instruction at a time (BUILD-PLAN §3):
//
//   step():  sync /IRQ → trace → cpu.step() → tick every device → sync /IRQ
//
// /IRQ is open-collector on the Model B. Every chip that can interrupt is
// wired to the same line and can pull it low, so it's low while ANY of them
// holds it. The machine never stores the line: it asks every source again.
//
// Two resets, because the MOS tells them apart (Stage 23): powerOn() resets
// every chip, and reset() is the BREAK key, which resets only the CPU.
//
// step() and runCycles() are the hot path: no objects, closures or arrays
// are made in them, and the device lists are walked with indexed loops.

import { Cpu6502, type InterruptKind } from '../cpu/cpu6502';
import type { Registers } from '../cpu/registers';
import { Tracer } from '../cpu/trace';
import type { Clocked } from '../devices/clocked';
import type { IrqSource } from '../devices/irq-source';
import { Via6522 } from '../devices/via6522';
import { BbcMemoryMap } from '../memory/bbc-memory-map';
import type { IoDevice } from '../memory/io-device';
import { WriteRecorder, type WriteLog } from '../memory/write-recorder';

/** One 50 Hz PAL frame of the 2 MHz 6502: 2,000,000 / 50 (BUILD-PLAN §3). */
export const CYCLES_PER_FRAME = 40_000;

/** What irqHolders calls the two VIAs. */
export const SYSTEM_VIA_NAME = 'System VIA';
export const USER_VIA_NAME = 'User VIA';

/**
 * A card on the 1 MHz bus: it answers FRED (&FC00-&FCFF), can pull /IRQ
 * low, and is reset by the bus's /RST line (Advanced User Guide; BeebWiki "1MHz bus").
 */
export interface OneMhzBusCard extends IoDevice, IrqSource {
  /** For irqHolders, e.g. "the doorbell". */
  readonly name: string;
  reset(): void;
}

export class BbcModelB {
  readonly name: string;
  readonly systemVia = new Via6522();
  readonly userVia = new Via6522();
  readonly map: BbcMemoryMap;
  readonly cpu: Cpu6502;
  /** The last 1,024 steps, each recorded just before it ran. */
  readonly trace: Tracer;
  private readonly recorder: WriteRecorder;

  /** Everything ticked after a step. Pushed to only by plugIn(). */
  private readonly clocked: Clocked[];
  /** Everything wired to /IRQ, with the names the workbench shows. */
  private readonly irqSources: IrqSource[];
  private readonly irqNames: string[];
  private readonly cards: OneMhzBusCard[] = [];
  /**
   * Cycles still owed to runCycles(). An instruction can overshoot the
   * budget; the debt is carried into the next call, so time never drifts.
   */
  private budget = 0;

  constructor(name = 'BBC Model B') {
    this.name = name;
    this.map = new BbcMemoryMap({ devices: { systemVia: this.systemVia, userVia: this.userVia } });
    this.recorder = new WriteRecorder(this.map);
    this.cpu = new Cpu6502(this.recorder);
    this.trace = new Tracer((address) => this.map.peek(address));
    this.clocked = [this.systemVia, this.userVia];
    this.irqSources = [this.systemVia, this.userVia];
    this.irqNames = [SYSTEM_VIA_NAME, USER_VIA_NAME];
  }

  /**
   * Plugs a card into the 1 MHz bus: it answers FRED and joins the /IRQ
   * wire-OR. One card at a time, like the one socket. Not for the hot path.
   */
  plugIn(card: OneMhzBusCard): void {
    this.map.plugFred(card);
    this.cards.push(card);
    this.irqSources.push(card);
    this.irqNames.push(card.name);
    this.syncIrq();
  }

  // ── Time ───────────────────────────────────────────────────────────────

  /**
   * One instruction (or interrupt sequence), then every device ticked by the
   * cycles it took. Returns those cycles. May throw UnimplementedOpcodeError.
   */
  step(): number {
    // The debugger may have changed a device since the last step (a VIA panel button).
    this.syncIrq();
    this.trace.record(this.cpu);
    const cycles = this.cpu.step();
    this.tick(cycles);
    // A timer may have run out, or the handler acknowledged a flag.
    this.syncIrq();
    return cycles;
  }

  /**
   * Runs whole instructions until n more cycles have been used, counting any
   * overshoot left from the last call. Returns the cycles actually run: a
   * few more or fewer than n, but the running total never drifts more than
   * one instruction from the sum of the n's.
   */
  runCycles(n: number): number {
    this.budget += n;
    let ran = 0;
    while (this.budget > 0) {
      const cycles = this.step();
      this.budget -= cycles;
      ran += cycles;
    }
    return ran;
  }

  /** One 50 Hz frame's worth: runCycles(40,000). */
  runFrame(): number {
    return this.runCycles(CYCLES_PER_FRAME);
  }

  // ── Resets ─────────────────────────────────────────────────────────────

  /**
   * Switching on: every chip's /RES (the VIAs clear IER, so the MOS sees
   * &80 at &FE4E), the 1 MHz bus cards, and the CPU's reset sequence. RAM
   * is left as it is: clearing it is the MOS's job. Returns the CPU's 7 cycles.
   */
  powerOn(): number {
    this.systemVia.reset();
    this.userVia.reset();
    return this.reset();
  }

  /**
   * The BREAK key: the CPU's reset sequence. The VIAs keep their registers,
   * which is how the MOS knows it's a BREAK (Stage 23). The 1 MHz bus cards
   * are reset too (see the Stage 27 doc's Gotchas). The trace and the frame
   * budget start again; the reset's 7 cycles pass for the devices.
   */
  reset(): number {
    for (let i = 0; i < this.cards.length; i++) this.cards[i]?.reset();
    this.trace.clear();
    this.budget = 0;
    this.syncIrq();
    const cycles = this.cpu.reset();
    this.tick(cycles);
    this.syncIrq();
    return cycles;
  }

  /** One pulse on /NMI (asserted then released): one falling edge for the CPU's latch. */
  pulseNmi(): void {
    this.cpu.setNmi(true);
    this.cpu.setNmi(false);
  }

  // ── The IRQ line ───────────────────────────────────────────────────────

  /** The wire-OR, worked out now: is any source holding /IRQ low? */
  get irqLine(): boolean {
    const sources = this.irqSources;
    for (let i = 0; i < sources.length; i++) if (sources[i]?.irq) return true;
    return false;
  }

  /** Who is holding /IRQ, by name. Allocates: for panels and demos, not the hot path. */
  get irqHolders(): readonly string[] {
    const holders: string[] = [];
    this.irqSources.forEach((source, i) => {
      if (source.irq) holders.push(this.irqNames[i] ?? '?');
    });
    return holders;
  }

  /** Is the CPU's NMI edge latch set? */
  get nmiPending(): boolean {
    return this.cpu.nmiPending;
  }

  /** What the next step() will do instead of an instruction, if anything. */
  get pendingInterrupt(): InterruptKind | undefined {
    this.syncIrq();
    return this.cpu.pendingInterrupt;
  }

  // ── For the debugger ───────────────────────────────────────────────────

  get registers(): Readonly<Registers> {
    return this.cpu.regs;
  }

  /** CPU cycles since the machine was made, resets included. */
  get cycles(): number {
    return this.cpu.cycles;
  }

  /** The CPU's bus writes since the log was last cleared. */
  get writes(): WriteLog {
    return this.recorder;
  }

  /** The byte at address, with no side effects. */
  peek(address: number): number {
    return this.map.peek(address & 0xffff);
  }

  /** A tool's write: RAM, the ROM images (an EPROM programmer), or a device register. */
  poke(address: number, value: number): void {
    this.map.poke(address & 0xffff, value & 0xff);
  }

  private tick(cycles: number): void {
    const devices = this.clocked;
    for (let i = 0; i < devices.length; i++) devices[i]?.tick(cycles);
  }

  /** Copies the wire-OR to the CPU's /IRQ pin. */
  private syncIrq(): void {
    this.cpu.irq = this.irqLine;
  }
}
