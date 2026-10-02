// Browser entry point. Builds the Part 2 "CPU playground" (a 6502 on a flat
// 64K TestBus) and mounts the workbench beside the screen canvas.

import { RESET_VECTOR } from './cpu/cpu6502';
import { TestBus } from './memory/test-bus';
import { listingEnd, loadListing, type ListingLine } from './playground/listing';
import { LOADS_PROGRAM } from './playground/loads-program';
import { MODE7_SCREEN, loadPlaygroundData } from './playground/setup';
import { STORES_PROGRAM } from './playground/stores-program';
import { hex16, hex8, hi, lo } from './util/bits';
import { createAddressingPanel } from './web/workbench/addressing-panel';
import { playgroundTarget } from './web/workbench/debug-target';
import { createListingPanel } from './web/workbench/listing-panel';
import { createMemoryPanel } from './web/workbench/memory-panel';
import { createWorkbench } from './web/workbench/panel';
import { createRegistersPanel } from './web/workbench/registers-panel';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('Missing #screen canvas');
const host = document.querySelector<HTMLElement>('#workbench');
if (!host) throw new Error('Missing #workbench element');

// The playground program: a hand-assembled listing at &0400, then NOPs (&EA)
// to the end of the page. The byte after that, &0500, is &00 (BRK), which
// isn't implemented yet, so stepping off the end shows the
// unimplemented-opcode error. The current stage's program runs by default;
// ?program=loads runs Stage 06's instead.
const PROGRAMS: Readonly<Record<string, readonly ListingLine[]>> = {
  loads: LOADS_PROGRAM, //   Stage 06
  stores: STORES_PROGRAM, // Stage 07
};
const requested = new URLSearchParams(window.location.search).get('program') ?? 'stores';
const program = PROGRAMS[requested] ?? STORES_PROGRAM;
const PROGRAM = program[0]?.address ?? 0x0400;
const PAGE_END = 0x0500;
const NOP = 0xea;

const bus = new TestBus();
// "HELLO, BBC MICRO" at &7C00 and the pointer to it at &70/&71.
loadPlaygroundData(bus);
loadListing(bus, program);
const nopsFrom = listingEnd(program);
bus.load(nopsFrom, new Array<number>(PAGE_END - nopsFrom).fill(NOP));
// The reset vector, low byte first: &FFFC = &00, &FFFD = &04.
bus.load(RESET_VECTOR, [lo(PROGRAM), hi(PROGRAM)]);

// More pointers for the addressing-mode explorer's examples (Stage 05):
//   &FF/&00 = 00 7C  the &70 pointer again, straddling the end of page zero
//   &30FF = 00, &3000 = 04, &3100 = 80  the JMP (&30FF) trap: the NMOS bug
//     jumps to &0400; a "correct" CPU would go to &8000
bus.write(0x00ff, lo(MODE7_SCREEN));
bus.write(0x0000, hi(MODE7_SCREEN));
bus.write(0x30ff, 0x00);
bus.write(0x3000, 0x04);
bus.write(0x3100, 0x80);

// The target puts a WriteRecorder between the CPU and the bus (Stage 07).
const target = playgroundTarget(bus);
target.reset();
const workbench = createWorkbench(host, target.name);
const refreshAll = (): void => {
  workbench.refreshAll();
};
workbench.add(createRegistersPanel(target, { onRun: refreshAll }));
workbench.add(createListingPanel(target, program));
const memory = createMemoryPanel(target, {
  start: PROGRAM,
  onPoke: refreshAll,
  pc: () => target.registers.pc,
  writes: target.writes,
});
workbench.add(memory);
workbench.add(createAddressingPanel(target));

// A console handle for experimenting in DevTools, e.g.
//   workbench.poke(0x0404, 0xff)   // stores program: LDA #&00 becomes LDA #&FF; then Reset and Step
Object.assign(window, {
  workbench: {
    peek: (address: number): string => `&${hex8(target.peek(address))}`,
    poke: (address: number, value: number): void => {
      target.poke(address, value);
      workbench.refreshAll();
    },
    goTo: (address: number): void => {
      memory.goTo(address);
    },
    step: (): number => {
      target.writes.clear();
      const cycles = target.step();
      workbench.refreshAll();
      return cycles;
    },
    cpu: target.cpu,
    help: `workbench.poke(0x${hex16(PROGRAM + 4)}, 0xff), workbench.step(), workbench.peek(addr), workbench.goTo(addr), workbench.cpu.regs`,
  },
});
