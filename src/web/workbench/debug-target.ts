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
import type { Registers } from '../../cpu/registers';
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
  /** Is something holding the IRQ line? */
  readonly irqLine: boolean;
  /** Is the NMI edge detector's latch set? */
  readonly nmiPending: boolean;
}

/**
 * The Part 2 playground: a 6502 on a flat 64K TestBus, with a WriteRecorder
 * between them so the workbench can see what the CPU wrote, and a doorbell
 * at &FC00 for the IRQ button to ring (Stage 17).
 *
 *   Cpu6502 ──▶ WriteRecorder ──▶ Doorbell ──▶ TestBus ◀── peek / poke
 *
 * peek and poke go straight to the TestBus, so the debugger's own writes are
 * never mistaken for the CPU's. Returns the CPU too, for the console handle.
 */
export function playgroundTarget(bus: TestBus, name = 'CPU playground (6502 on a 64K TestBus)'): InterruptTarget & { readonly cpu: Cpu6502 } {
  const doorbell = new Doorbell(bus);
  const recorder = new WriteRecorder(doorbell);
  const cpu = new Cpu6502(recorder);
  // After anything that might change the doorbell, copy its line to the CPU's
  // /IRQ pin. Part 5's machine does the same after ticking its devices (BUILD-PLAN §3).
  const syncIrq = (): void => {
    cpu.irq = doorbell.ringing;
  };
  return {
    ...testBusTarget(bus, name),
    cpu,
    registers: cpu.regs,
    get cycles() {
      return cpu.cycles;
    },
    step: () => {
      const cycles = cpu.step();
      syncIrq();
      return cycles;
    },
    // /RES reaches the devices too: the doorbell goes quiet.
    reset: () => {
      doorbell.reset();
      syncIrq();
      return cpu.reset();
    },
    writes: recorder,
    get pendingInterrupt() {
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
      return cpu.irq;
    },
    get nmiPending() {
      return cpu.nmiPending;
    },
  };
}
