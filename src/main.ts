// Browser entry point. Builds the machine (a BbcModelB, since Stage 27) and
// mounts the workbench beside the screen canvas. Two ways to use it:
//
//   /                 the playground: Assemble & Run puts your program in RAM,
//                     with the reset vector pointing at it, and powers on
//   /?machine=mos     the real ROMs from roms/, powered on into MOS 1.20

import { BbcModelB } from './machine/bbc-model-b';
import { MOS_LABELS } from './mos/mos-labels';
import { Doorbell } from './playground/doorbell';
import { fetchStandardRoms } from './web/rom-fetch';
import type { ListingLine } from './playground/listing';
import { EXAMPLES, findExample } from './playground/examples';
import { PROGRAM_PAGE, installProgram, pokeWriter } from './playground/setup';
import { TRACE_HEADER, formatTraceLine } from './cpu/trace';
import { hex16, hex8 } from './util/bits';
import { createAddressingPanel } from './web/workbench/addressing-panel';
import { createAssemblerPanel } from './web/workbench/assembler-panel';
import { createConverterPanel } from './web/workbench/converter-panel';
import { createDisassemblyPanel } from './web/workbench/disassembly-panel';
import { labelsFromSymbols } from './web/workbench/disassembly-view-model';
import { createInterruptsPanel } from './web/workbench/interrupts-panel';
import { machineTarget } from './web/workbench/debug-target';
import { createListingPanel } from './web/workbench/listing-panel';
import { createMemoryMapPanel } from './web/workbench/memory-map-panel';
import { createMemoryPanel } from './web/workbench/memory-panel';
import { createWorkbench } from './web/workbench/panel';
import { createRegistersPanel } from './web/workbench/registers-panel';
import { createStackPanel } from './web/workbench/stack-panel';
import { createViaPanel } from './web/workbench/via-panel';
import { SYSTEM_VIA_BASE, USER_VIA_BASE } from './web/workbench/via-view-model';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (!canvas) throw new Error('Missing #screen canvas');
const host = document.querySelector<HTMLElement>('#workbench');
if (!host) throw new Error('Missing #workbench element');
// Registers, Stack and Memory sit under the screen; the other panels go in the workbench column.
const underScreen = document.querySelector<HTMLElement>('#under-screen');
if (!underScreen) throw new Error('Missing #under-screen element');

const params = new URLSearchParams(window.location.search);
const mosMode = params.get('machine') === 'mos';
// Programs come from the Assembler panel (Stage 08). The current stage's
// example runs by default; ?program=stores or ?program=loads starts with an
// earlier stage's instead.
const initial = findExample(params.get('program'));

// The machine (Stage 27): CPU, memory map, both VIAs ticked after every step
// and wired to /IRQ. Every other SHEILA chip is still a placeholder (Stage 21).
// The Stage 17 doorbell is a card on its 1 MHz bus, so the IRQ button has
// something to ring, in either mode.
const machine = new BbcModelB(mosMode ? 'BBC Model B running MOS 1.20 from roms/' : 'BBC Model B, playground: your program instead of the MOS');
// The fake 50 Hz vsync on the System VIA's CA1 (Stage 29) is for the MOS. In
// the playground it would fight the VIA panel's CA1 button, which Stage 26's
// example counts, so it's off there.
if (!mosMode) machine.vsync.enabled = false;
const doorbell = new Doorbell(machine.map);
machine.plugIn(doorbell);
const target = machineTarget(machine, doorbell);
const { map: bus, systemVia, userVia } = machine;
let listing: readonly ListingLine[] = [];
// Address → name, so the Disassembly panel can say "JSR one": from the last
// assembly, or the MOS's routines and vectors.
let labels: ReadonlyMap<number, string> = mosMode ? MOS_LABELS : new Map();

const workbench = createWorkbench(host, target.name);
const refreshAll = (): void => {
  workbench.refreshAll();
};

// The switch between the two modes, at the top of the workbench column.
const modes = document.createElement('nav');
modes.className = 'machine-switch';
modes.setAttribute('aria-label', 'Machine');
for (const [label, href, current] of [
  ['Playground', '/', !mosMode],
  ['MOS 1.20', '/?machine=mos', mosMode],
] as const) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  if (current) link.setAttribute('aria-current', 'page');
  modes.append(link);
}
const romStatus = document.createElement('span');
romStatus.className = 'rom-status';
modes.append(romStatus);
host.prepend(modes);

const memory = createMemoryPanel(target, {
  // MOS mode opens on page 2: the MOS's vectors and variables (&028D, the BREAK type).
  start: mosMode ? 0x0200 : PROGRAM_PAGE,
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
    // Through poke, so the vectors at &FFFA-&FFFF land in the MOS ROM image.
    installProgram(pokeWriter(machine), assembly.lines, entry);
    // A fresh playground is a power-on, which resets the VIAs. The Reset
    // button is BREAK: it resets the CPU and leaves them alone (Stage 23).
    machine.powerOn();
    target.writes.clear();
    bus.clearIoHistory();
    memory.goTo(entry);
    refreshAll();
  },
});
workbench.add(registers, underScreen);
workbench.add(createInterruptsPanel(target, { onChange: refreshAll }), underScreen);
workbench.add(createStackPanel(target), underScreen);
workbench.add(memory, underScreen);
// No assembler in MOS mode: assembling would overwrite the MOS's reset vector.
if (!mosMode) {
  workbench.add(assembler);
  workbench.add(createListingPanel(target, () => listing));
}
workbench.add(createDisassemblyPanel(target, () => labels));
workbench.add(
  createMemoryMapPanel(bus, {
    pc: () => target.registers.pc,
    onGo: (address) => {
      memory.goTo(address);
    },
    onClear: () => {
      bus.clearIoHistory();
      refreshAll();
    },
  }),
);
workbench.add(
  createViaPanel(
    [
      { name: 'System VIA', base: SYSTEM_VIA_BASE, via: systemVia },
      { name: 'User VIA', base: USER_VIA_BASE, via: userVia },
    ],
    // The System VIA first: the Stage 26 example uses it, as the MOS does.
    { initial: 0, onChange: refreshAll },
  ),
);
workbench.add(createAddressingPanel(target));
workbench.add(createConverterPanel());

if (mosMode) {
  romStatus.textContent = 'loading ROMs…';
  void fetchStandardRoms(bus).then((report) => {
    const missing = report.missing.map((rom) => rom.file);
    romStatus.textContent = `ROMs: ${report.loaded.map((rom) => rom.file).join(', ') || 'none'}${missing.length > 0 ? ` (missing: ${missing.join(', ')})` : ''}`;
    if (!report.loaded.some((rom) => rom.id === 'mos')) {
      romStatus.textContent += '. Without os12.rom there is nothing to run: put it in roms/ and reload.';
      return;
    }
    machine.powerOn();
    memory.goTo(0x0200);
    refreshAll();
  });
} else {
  assembler.assembleAndRun();
}

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
    machine,
    cpu: machine.cpu,
    map: bus,
    powerOn: (): void => {
      machine.powerOn();
      workbench.refreshAll();
    },
    systemVia,
    userVia,
    trace: (count = 20): string => [TRACE_HEADER, ...target.trace.recent(count).map((entry) => formatTraceLine(entry, labels))].join('\n'),
    irq: (): void => {
      target.ringIrq();
      workbench.refreshAll();
    },
    nmi: (): void => {
      target.pulseNmi();
      workbench.refreshAll();
    },
    help: `workbench.machine.runFrame(), workbench.powerOn(), workbench.poke(0x${hex16(PROGRAM_PAGE + 1)}, 0xff), workbench.step(), workbench.peek(addr), workbench.goTo(addr), workbench.trace(20), workbench.map.ioLog.recent(), workbench.userVia.pins('b'), workbench.systemVia.setControlLine('ca1', 0), workbench.irq(), workbench.nmi(), workbench.cpu.regs`,
  },
});
