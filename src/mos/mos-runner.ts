// Running the MOS headless: CPU + memory map + ROMs, and nothing else.
//
// This is a test rig, not a machine. There are no devices behind SHEILA
// (every slot but ROMSEL floats), no interrupts and no clock for anything
// but the CPU. Stage 27's BbcModelB is the machine. This is for watching
// firmware run until it needs hardware we haven't built, and seeing where.
//
// Around each step it calls the tracer (what ran), the stall detector (is
// anything new still running?) and the call stack (how did we get here?).
// That's the 1.7x tracing cost measured in Stage 20, which is fine here.

import { CallStack } from '../cpu/call-stack';
import { Cpu6502 } from '../cpu/cpu6502';
import { DEFAULT_STALL_CYCLES, StallDetector } from '../cpu/stall-detector';
import { DEFAULT_TRACE_CAPACITY, Tracer } from '../cpu/trace';
import type { BbcMemoryMap } from '../memory/bbc-memory-map';

export interface MosRunnerOptions {
  /** No new code for this many cycles = stalled. Default: one emulated second. */
  readonly stallCycles?: number;
  /** Trace ring buffer size (a power of two). */
  readonly traceCapacity?: number;
}

export interface MosRunResult {
  /** stall: nothing new ran for stallCycles. limit: maxCycles ran out first. */
  readonly kind: 'stall' | 'limit';
  /** Steps and cycles run by this call. */
  readonly instructions: number;
  readonly cycles: number;
  /** PC when it stopped. */
  readonly pc: number;
  /** For a stall, the loop's addresses (see StallDetector.loopAddresses). Empty for a limit. */
  readonly loop: readonly number[];
}

export class MosRunner {
  readonly cpu: Cpu6502;
  readonly tracer: Tracer;
  readonly stall: StallDetector;
  readonly calls: CallStack;

  constructor(
    readonly map: BbcMemoryMap,
    options: MosRunnerOptions = {},
  ) {
    const peek = (address: number): number => map.peek(address);
    this.cpu = new Cpu6502(map);
    this.tracer = new Tracer(peek, options.traceCapacity ?? DEFAULT_TRACE_CAPACITY);
    this.stall = new StallDetector(options.stallCycles ?? DEFAULT_STALL_CYCLES);
    this.calls = new CallStack(peek);
  }

  /** Presses RESET: the CPU's reset sequence, and every record starts again. RAM and the devices are left alone. */
  reset(): number {
    this.tracer.clear();
    this.stall.clear();
    this.calls.clear();
    return this.cpu.reset();
  }

  /** One CPU step, watched. Returns its cycles. Hot path: nothing allocated. */
  step(): number {
    const cpu = this.cpu;
    this.tracer.record(cpu);
    this.stall.record(cpu.regs.pc, cpu.cycles);
    this.calls.before(cpu);
    const cycles = cpu.step();
    this.calls.after(cpu);
    return cycles;
  }

  /** Steps until the stall detector says stalled, or at least maxCycles have run. */
  runUntilStall(maxCycles: number): MosRunResult {
    const cpu = this.cpu;
    let cycles = 0;
    let instructions = 0;
    while (cycles < maxCycles) {
      if (this.stall.isStalled(cpu.cycles)) {
        return { kind: 'stall', instructions, cycles, pc: cpu.regs.pc, loop: this.stall.loopAddresses() };
      }
      cycles += this.step();
      instructions++;
    }
    return { kind: 'limit', instructions, cycles, pc: cpu.regs.pc, loop: [] };
  }
}
