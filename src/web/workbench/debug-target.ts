// What the workbench panels look at.
//
// Panels never use the CPU's Bus directly, because on a real machine a bus
// read can have side effects: reading the System VIA's T1 counter at &FE44
// clears IFR bit 6 (6522 datasheet). A debugger that used read() to draw page
// &FE would change the program it was watching. So panels use peek(), which
// promises no side effects, and poke(), the debugger's write.
//
// DOM-free on purpose, so Jest can test it. Core objects (like BbcModelB in
// Part 5) satisfy this interface structurally: they just need these members,
// and never have to import anything from src/web/.

import { Cpu6502, type InterruptKind } from '../../cpu/cpu6502';
import { Tracer } from '../../cpu/trace';
import type { Clocked } from '../../devices/clocked';
import type { NamedIrqSource } from '../../devices/irq-source';
import type { Registers } from '../../cpu/registers';
import type { Bus } from '../../memory/bus';
import type { TestBus } from '../../memory/test-bus';
import { WriteRecorder, type WriteLog } from '../../memory/write-recorder';
import { Doorbell } from '../../playground/doorbell';

export interface DebugTarget {
  /** Shown in the workbench header, e.g. "CPU playground (64K TestBus)". */
  readonly name: string;
  /** The byte at address & 0xffff, 0..255, with no side effects. */
  peek(address: number): number;
  /** Debugger write: stores value & 0xff at address & 0xffff. */
  poke(address: number, value: number): void;
}

/**
 * Adapts a flat TestBus. All 64K is plain RAM, so a read has no side effects
 * and peek can simply be read. Stage 21's memory map needs a real peek.
 */
export function testBusTarget(bus: TestBus, name = 'CPU playground (64K TestBus)'): DebugTarget {
  return {
    name,
    peek: (address) => bus.read(address & 0xffff),
    poke: (address, value) => {
      bus.write(address & 0xffff, value & 0xff);
    },
  };
}

/**
 * What the playground's CPU runs on: a Bus for the CPU, plus peek and poke for
 * the panels. A BbcMemoryMap (Stage 21, the browser) or a TestBus (tests, demos).
 */
export type PlaygroundMemory = Bus & Pick<DebugTarget, 'peek' | 'poke'>;

/**
 * A target with a CPU in it. step() and reset() go through the target, not
 * straight to the CPU, because from Part 5 a machine step also ticks devices.
 */
export interface CpuTarget extends DebugTarget {
  /** The live registers. Panels read them; only step() and reset() change them. */
  readonly registers: Readonly<Registers>;
  /** Total CPU cycles since power-on. */
  readonly cycles: number;
  /**
   * Runs one instruction and returns its cycles. May throw UnimplementedOpcodeError.
   * If an interrupt is due, the step is the 7-cycle interrupt sequence instead.
   */
  step(): number;
  /** What the next step() will do instead of an instruction, if anything (Stage 17). */
  readonly pendingInterrupt: InterruptKind | undefined;
  /** Runs the reset sequence and returns its cycles. */
  reset(): number;
  /**
   * The CPU's bus writes since the log was last cleared (stepMany clears it
   * at the start of each run). Pokes aren't in it: they're the debugger's.
   */
  readonly writes: WriteLog;
}

/** A CPU target with interrupt buttons wired to something (Stage 17). */
export interface InterruptTarget extends CpuTarget {
  /** The IRQ button: rings the doorbell at &FC00, which holds IRQ until the handler answers it. */
  ringIrq(): void;
  /** The NMI button: one pulse on /NMI (asserted then released), so one falling edge. */
  pulseNmi(): void;
  /** Is something holding the IRQ line? Worked out now, from the devices. */
  readonly irqLine: boolean;
  /** Who is holding it, e.g. ["the doorbell", "System VIA"]. Empty when released. For panels, not the hot path. */
  readonly irqHolders: readonly string[];
  /** Is the NMI edge detector's latch set? */
  readonly nmiPending: boolean;
}

/** How irqHolders names the playground's doorbell. */
export const DOORBELL_HOLDER = 'the doorbell';

/** A CPU target that keeps a trace of the steps it has run (Stage 18). */
export interface TracedTarget extends CpuTarget {
  /** The last 1,024 steps, recorded just before each ran. Cleared by reset(). */
  readonly trace: Tracer;
}

/**
 * The playground: a 6502 on some memory (the BBC memory map in the browser
 * since Stage 21, a flat TestBus in most tests), with a WriteRecorder between
 * them so the workbench can see what the CPU wrote, and a doorbell at &FC00
 * for the IRQ button to ring (Stage 17), and a tracer that notes each step
 * just before it runs (Stage 18), and any clocked devices (the VIAs, Stage 25)
 * ticked by each step's cycles. The IRQ sources (the VIAs, Stage 26) share
 * the CPU's IRQ line with the doorbell: a wire-OR, so any one holds it low.
 *
 *   Cpu6502 ──▶ WriteRecorder ──▶ Doorbell ──▶ memory ◀── peek / poke
 *                                                ▲
 *                                     Tracer ────┘ (peeks the bytes at PC)
 *
 * peek and poke go straight to the memory, so the debugger's own writes are
 * never mistaken for the CPU's. Returns the CPU too, for the console handle.
 */
export function playgroundTarget(
  memory: PlaygroundMemory,
  name = 'CPU playground (6502 on a 64K TestBus)',
  devices: readonly Clocked[] = [],
  irqSources: readonly NamedIrqSource[] = [],
): InterruptTarget & TracedTarget & { readonly cpu: Cpu6502 } {
  const doorbell = new Doorbell(memory);
  const recorder = new WriteRecorder(doorbell);
  const cpu = new Cpu6502(recorder);
  const base: DebugTarget = {
    name,
    peek: (address) => memory.peek(address & 0xffff),
    poke: (address, value) => {
      memory.poke(address & 0xffff, value & 0xff);
    },
  };
  const trace = new Tracer((address) => base.peek(address));
  // The IRQ line: low while the doorbell OR any source holds it (wire-OR).
  // An indexed loop, so nothing is allocated per step.
  const lineHeld = (): boolean => {
    if (doorbell.ringing) return true;
    for (let i = 0; i < irqSources.length; i++) if (irqSources[i]?.source.irq) return true;
    return false;
  };
  // Copy the line to the CPU's /IRQ pin, before and after each step: a step
  // can change it (a timer runs out, the handler acknowledges), and so can the
  // debugger between steps (a VIA panel button). Part 5's machine does the same (BUILD-PLAN §3).
  const syncIrq = (): void => {
    cpu.irq = lineHeld();
  };
  // Time passes for the devices too: an indexed loop, so nothing is allocated per step.
  const tickDevices = (cycles: number): void => {
    for (let i = 0; i < devices.length; i++) devices[i]?.tick(cycles);
  };
  return {
    ...base,
    cpu,
    trace,
    registers: cpu.regs,
    get cycles() {
      return cpu.cycles;
    },
    step: () => {
      syncIrq();
      trace.record(cpu);
      const cycles = cpu.step();
      tickDevices(cycles);
      syncIrq();
      return cycles;
    },
    // /RES reaches the doorbell, which goes quiet (the VIAs' own /RES is the
    // power-on's job: Stage 23). Its 7 cycles still pass. The trace starts again.
    reset: () => {
      trace.clear();
      doorbell.reset();
      syncIrq();
      const cycles = cpu.reset();
      tickDevices(cycles);
      return cycles;
    },
    writes: recorder,
    get pendingInterrupt() {
      syncIrq();
      return cpu.pendingInterrupt;
    },
    ringIrq: () => {
      doorbell.ring();
      syncIrq();
    },
    pulseNmi: () => {
      cpu.setNmi(true);
      cpu.setNmi(false);
    },
    get irqLine() {
      return lineHeld();
    },
    get irqHolders() {
      const holders: string[] = doorbell.ringing ? [DOORBELL_HOLDER] : [];
      for (const { name, source } of irqSources) if (source.irq) holders.push(name);
      return holders;
    },
    get nmiPending() {
      return cpu.nmiPending;
    },
  };
}
