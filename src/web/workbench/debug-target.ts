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

import type { TestBus } from '../../memory/test-bus';

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
