// Browser entry point. Builds the Part 2 "CPU playground" (a 6502 on a flat
// 64K TestBus) and mounts the workbench beside the screen canvas.

import { TestBus } from './memory/test-bus';
import type { ListingLine } from './playground/listing';
import { EXAMPLES, findExample } from './playground/examples';
import { PROGRAM_PAGE, installProgram } from './playground/setup';
import { TRACE_HEADER, formatTraceLine } from './cpu/trace';
import { hex16, hex8 } from './util/bits';
import { createAddressingPanel } from './web/workbench/addressing-panel';
import { createAssemblerPanel } from './web/workbench/assembler-panel';
import { createConverterPanel } from './web/workbench/converter-panel';
import { createDisassemblyPanel } from './web/workbench/disassembly-panel';
import { labelsFromSymbols } from './web/workbench/disassembly-view-model';
import { createInterruptsPanel } from './web/workbench/interrupts-panel';
import { playgroundTarget } from './web/workbench/debug-target';
import { createListingPanel } from './web/workbench/listing-panel';
import { createMemoryPanel } from './web/workbench/memory-panel';
import { createWorkbench } from './web/workbench/panel';
import { createRegistersPanel } from './web/workbench/registers-panel';
import { createStackPanel } from './web/workbench/stack-panel';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('Missing #screen canvas');
const host = document.querySelector<HTMLElement>('#workbench');
if (!host) throw new Error('Missing #workbench element');
// Registers, Stack and Memory sit under the screen; the other panels go in the workbench column.
const underScreen = document.querySelector<HTMLElement>('#under-screen');
if (!underScreen) throw new Error('Missing #under-screen element');

// Programs come from the Assembler panel (Stage 08). The current stage's
// example runs by default; ?program=stores or ?program=loads starts with an
// earlier stage's instead.
const initial = findExample(new URLSearchParams(window.location.search).get('program'));

const bus = new TestBus();
// The target puts a WriteRecorder between the CPU and the bus (Stage 07).
const target = playgroundTarget(bus);
let listing: readonly ListingLine[] = [];
// Address → name, from the last assembly, so the Disassembly panel can say "JSR one".
let labels: ReadonlyMap<number, string> = new Map();

const workbench = createWorkbench(host, target.name);
const refreshAll = (): void => {
  workbench.refreshAll();
};

const memory = createMemoryPanel(target, {
  start: PROGRAM_PAGE,
  onPoke: refreshAll,
  pc: () => target.registers.pc,
  writes: target.writes,
});

// Assemble & Run: a clean playground with the new bytes in it (installProgram
// also puts back "HELLO, BBC MICRO" at &7C00 and the explorer's pointers),
// the reset vector pointing at the first byte, and a CPU reset.
const registers = createRegistersPanel(target, { onRun: refreshAll });
const assembler = createAssemblerPanel({
  examples: EXAMPLES,
  initial,
  onAssembled: (assembly, entry) => {
    registers.stop();
    listing = assembly.lines;
    labels = labelsFromSymbols(assembly.symbols);
    installProgram(bus, assembly.lines, entry);
    target.reset();
    target.writes.clear();
    memory.goTo(entry);
    refreshAll();
  },
});
workbench.add(registers, underScreen);
workbench.add(createInterruptsPanel(target, { onChange: refreshAll }), underScreen);
workbench.add(createStackPanel(target), underScreen);
workbench.add(memory, underScreen);
workbench.add(assembler);
workbench.add(createListingPanel(target, () => listing));
workbench.add(createDisassemblyPanel(target, () => labels));
workbench.add(createAddressingPanel(target));
workbench.add(createConverterPanel());
assembler.assembleAndRun();

// A console handle for experimenting in DevTools, e.g.
//   workbench.poke(0x0401, 0xff)   // then Reset and Step
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
    trace: (count = 20): string => [TRACE_HEADER, ...target.trace.recent(count).map((entry) => formatTraceLine(entry, labels))].join('\n'),
    irq: (): void => {
      target.ringIrq();
      workbench.refreshAll();
    },
    nmi: (): void => {
      target.pulseNmi();
      workbench.refreshAll();
    },
    help: `workbench.poke(0x${hex16(PROGRAM_PAGE + 1)}, 0xff), workbench.step(), workbench.peek(addr), workbench.goTo(addr), workbench.trace(20), workbench.irq(), workbench.nmi(), workbench.cpu.regs`,
  },
});
