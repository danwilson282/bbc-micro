// A shadow call stack: the chain of calls that led to where the CPU is now.
//
// The 6502's own stack holds the return addresses, but mixed in with PHA'd
// data, so they can't be picked out afterwards. This records each call as it
// happens, outside the emulated machine: a JSR, BRK, IRQ or NMI pushes a
// frame (where from, where to, and S just after the push).
//
// Popping needs no knowledge of how the code returns. A frame lives while
// S <= its saved S. Once S rises above it, whatever was pushed with the frame
// has gone, and so has the frame. One rule covers RTS and RTI, PLA PLA (a
// return address thrown away) and TXS (the stack reset). A stack overflow,
// with S wrapping past &00, looks like S rising, and loses the frames. The
// program is broken by then anyway.
//
// Like the tracer, it never calls step(): the owner calls before(), step(),
// after(). Both are on the hot path: typed arrays, nothing allocated.

import type { Cpu6502 } from './cpu6502';
import type { Peek } from './disassembler';

export type CallKind = 'jsr' | 'brk' | 'irq' | 'nmi';

/** One call, as frames() reports it. Built only when asked. */
export interface CallFrame {
  readonly kind: CallKind;
  /** The JSR's or BRK's address, or the PC where an interrupt struck. */
  readonly from: number;
  /** Where it went: the subroutine, or the handler from the vector. */
  readonly to: number;
  /** S just after the push. The frame is gone once S rises above this. */
  readonly s: number;
}

/** A frame needs at least 2 bytes of stack (a JSR), so the 256-byte stack page holds at most 128. */
export const MAX_CALL_DEPTH = 128;

const OPCODE_BRK = 0x00;
const OPCODE_JSR = 0x20;

/** Kind codes as stored. NONE = this step doesn't call anything. */
const NONE = 0;
const KINDS: readonly CallKind[] = ['jsr', 'jsr', 'brk', 'irq', 'nmi'];
const JSR = 1;
const BRK = 2;
const IRQ = 3;
const NMI = 4;

export class CallStack {
  private readonly kind = new Uint8Array(MAX_CALL_DEPTH);
  private readonly from = new Uint16Array(MAX_CALL_DEPTH);
  private readonly to = new Uint16Array(MAX_CALL_DEPTH);
  private readonly s = new Uint8Array(MAX_CALL_DEPTH);
  private count = 0;
  /** What the step between before() and after() is going to do. */
  private pendingKind = NONE;
  private pendingFrom = 0;

  /** peek reads memory with no side effects (to see the opcode about to run). */
  constructor(private readonly peek: Peek) {}

  /** Frames held now. */
  get depth(): number {
    return this.count;
  }

  /** Call just before cpu.step(): notes whether this step is a call. */
  before(cpu: Cpu6502): void {
    const pc = cpu.regs.pc;
    const pending = cpu.pendingInterrupt;
    this.pendingFrom = pc;
    if (pending === 'nmi') this.pendingKind = NMI;
    else if (pending === 'irq') this.pendingKind = IRQ;
    else {
      const opcode = this.peek(pc);
      this.pendingKind = opcode === OPCODE_JSR ? JSR : opcode === OPCODE_BRK ? BRK : NONE;
    }
  }

  /** Call just after cpu.step(): pops the frames S has risen past, then pushes this step's call, if any. */
  after(cpu: Cpu6502): void {
    const s = cpu.regs.s;
    while (this.count > 0 && s > (this.s[this.count - 1] ?? 0xff)) this.count--;
    if (this.pendingKind === NONE || this.count >= MAX_CALL_DEPTH) return;
    const i = this.count++;
    this.kind[i] = this.pendingKind;
    this.from[i] = this.pendingFrom;
    this.to[i] = cpu.regs.pc;
    this.s[i] = s;
  }

  /** The frames, outermost first. */
  frames(): CallFrame[] {
    const frames: CallFrame[] = [];
    for (let i = 0; i < this.count; i++) {
      frames.push({ kind: KINDS[this.kind[i] ?? JSR] ?? 'jsr', from: this.from[i] ?? 0, to: this.to[i] ?? 0, s: this.s[i] ?? 0 });
    }
    return frames;
  }

  clear(): void {
    this.count = 0;
    this.pendingKind = NONE;
  }
}
