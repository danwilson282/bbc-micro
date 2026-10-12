// Watching the MOS run headless, until it needs hardware we haven't built,
// and seeing where.
//
// It watches anything that can step and keeps a trace (a MosMachine): the
// real BbcModelB since Stage 27, or Stage 23's bare rig (bareMos), a CPU on a
// memory map with no devices, no interrupts and no clock but the CPU's.
//
// Around each step the machine records the trace (what ran) and the runner
// asks the stall detector (is anything new still running?) and the call
// stack (how did we get here?). That's the 1.7x tracing cost measured in
// Stage 20, which is fine here.

import { CallStack } from '../cpu/call-stack';
import { Cpu6502 } from '../cpu/cpu6502';
import { DEFAULT_STALL_CYCLES, StallDetector } from '../cpu/stall-detector';
import { DEFAULT_TRACE_CAPACITY, Tracer } from '../cpu/trace';
import { BbcMemoryMap } from '../memory/bbc-memory-map';

export interface MosRunnerOptions {
  /** No new code for this many cycles = stalled. Default: one emulated second. */
  readonly stallCycles?: number;
  /** Trace ring buffer size (a power of two), for a bare map. A machine has its own tracer. */
  readonly traceCapacity?: number;
}

/** What MosRunner can watch: a BbcModelB has all of this. */
export interface MosMachine {
  readonly cpu: Cpu6502;
  /** Records each step just before it runs. step() does the recording. */
  readonly trace: Tracer;
  peek(address: number): number;
  step(): number;
  /** Whatever this machine's RESET is. For BbcModelB, the BREAK key. */
  reset(): number;
}

/**
 * Stage 23's rig: a CPU on the map, traced, and nothing else. No device is
 * ticked and nothing can interrupt, whatever is plugged into the map.
 */
export function bareMos(map: BbcMemoryMap, traceCapacity = DEFAULT_TRACE_CAPACITY): MosMachine {
  const cpu = new Cpu6502(map);
  const trace = new Tracer((address) => map.peek(address), traceCapacity);
  return {
    cpu,
    trace,
    peek: (address) => map.peek(address),
    step: () => {
      trace.record(cpu);
      return cpu.step();
    },
    reset: () => {
      trace.clear();
      return cpu.reset();
    },
  };
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
  readonly machine: MosMachine;
  readonly cpu: Cpu6502;
  /** The machine's own tracer. */
  readonly tracer: Tracer;
  readonly stall: StallDetector;
  readonly calls: CallStack;

  /** Given a bare map, watches bareMos(map): Stage 23's rig. */
  constructor(machine: MosMachine | BbcMemoryMap, options: MosRunnerOptions = {}) {
    this.machine = machine instanceof BbcMemoryMap ? bareMos(machine, options.traceCapacity) : machine;
    const peek = this.machine.peek.bind(this.machine);
    this.cpu = this.machine.cpu;
    this.tracer = this.machine.trace;
    this.stall = new StallDetector(options.stallCycles ?? DEFAULT_STALL_CYCLES);
    this.calls = new CallStack(peek);
  }

  /** Presses the machine's RESET, and every record starts again. RAM is left alone. */
  reset(): number {
    this.clear();
    return this.machine.reset();
  }

  /** Starts the stall detector, call stack and trace afresh, e.g. after a powerOn() done by hand. */
  clear(): void {
    this.tracer.clear();
    this.stall.clear();
    this.calls.clear();
  }

  /** One machine step, watched. Returns its cycles. Hot path: nothing allocated. */
  step(): number {
    const cpu = this.cpu;
    this.stall.record(cpu.regs.pc, cpu.cycles);
    this.calls.before(cpu);
    const cycles = this.machine.step();
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
