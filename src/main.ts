// Browser entry point. Builds the Part 2 "CPU playground" (a 6502 on a flat
// 64K TestBus) and mounts the workbench beside the screen canvas.

import { Cpu6502, RESET_VECTOR } from './cpu/cpu6502';
import { TestBus } from './memory/test-bus';
import { hex16, hex8, hi, lo } from './util/bits';
import { createAddressingPanel } from './web/workbench/addressing-panel';
import { playgroundTarget } from './web/workbench/debug-target';
import { createMemoryPanel } from './web/workbench/memory-panel';
import { createWorkbench } from './web/workbench/panel';
import { createRegistersPanel } from './web/workbench/registers-panel';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('Missing #screen canvas');
const host = document.querySelector<HTMLElement>('#workbench');
if (!host) throw new Error('Missing #workbench element');

// &7C00 is where Mode 7 screen memory starts on a real Model B (AUG, memory
// map). Nothing draws it yet, but it's a familiar place to put a message.
const MODE7_SCREEN = 0x7c00;
// The playground program: one page of NOPs (&EA) at &0400. The byte after it,
// &0500, is &00 (BRK), which isn't implemented yet, so stepping off the end
// shows the unimplemented-opcode error.
const PROGRAM = 0x0400;
const NOP = 0xea;

const bus = new TestBus();
bus.load(MODE7_SCREEN, Array.from('HELLO, BBC MICRO', (c) => c.charCodeAt(0)));
bus.load(PROGRAM, new Array<number>(0x100).fill(NOP));
// The reset vector, low byte first: &FFFC = &00, &FFFD = &04.
bus.load(RESET_VECTOR, [lo(PROGRAM), hi(PROGRAM)]);

// Pointers for the addressing-mode explorer's examples (Stage 05):
//   &70/&71 = 00 7C  a pointer to the Mode 7 screen, for LDA (&70),Y
//   &FF/&00 = 00 7C  the same pointer straddling the end of page zero
//   &30FF = 00, &3000 = 04, &3100 = 80  the JMP (&30FF) trap: the NMOS bug
//     jumps to &0400; a "correct" CPU would go to &8000
bus.load(0x0070, [lo(MODE7_SCREEN), hi(MODE7_SCREEN)]);
bus.write(0x00ff, lo(MODE7_SCREEN));
bus.write(0x0000, hi(MODE7_SCREEN));
bus.write(0x30ff, 0x00);
bus.write(0x3000, 0x04);
bus.write(0x3100, 0x80);

const cpu = new Cpu6502(bus);
cpu.reset();

const target = playgroundTarget(cpu, bus);
const workbench = createWorkbench(host, target.name);
const refreshAll = (): void => {
  workbench.refreshAll();
};
workbench.add(createRegistersPanel(target, { onRun: refreshAll }));
const memory = createMemoryPanel(target, {
  start: PROGRAM,
  onPoke: refreshAll,
  pc: () => target.registers.pc,
});
workbench.add(memory);
workbench.add(createAddressingPanel(target));

// A console handle for experimenting in DevTools, e.g.
//   workbench.poke(0x0401, 0xa9)   // then Step twice
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
      const cycles = target.step();
      workbench.refreshAll();
      return cycles;
    },
    cpu,
    help: `workbench.poke(0x${hex16(PROGRAM)}, 0xa9), workbench.step(), workbench.peek(addr), workbench.goTo(addr), workbench.cpu.regs`,
  },
});
