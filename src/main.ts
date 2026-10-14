// Browser entry point. Builds the machine (a BbcModelB, since Stage 27) and
// mounts the workbench beside the screen canvas. Two ways to use it:
//
//   /                 the playground: Assemble & Run puts your program in RAM,
//                     with the reset vector pointing at it, and powers on
//   /?machine=mos     the real ROMs from roms/, powered on into MOS 1.20 and
//                     run in real time by the frame loop (Stage 30)
//   /?machine=mos&paused   the same, but powered on and left paused at the
//                     reset vector, to step through the MOS from its first instruction
//
// Either way, MODE 7's screen memory is drawn on the canvas as SAA5050
// teletext dots (Stage 31), with its text in a transparent layer on top.

import { BbcModelB } from './machine/bbc-model-b';
import { MOS_LABELS } from './mos/mos-labels';
import { Doorbell } from './playground/doorbell';
import { fetchStandardRoms } from './web/rom-fetch';
import { createFrameLoop } from './web/frame-loop';
import { createRunControls } from './web/run-controls';
import { createScreenCanvas } from './web/screen-canvas';
import { createTextScreen } from './web/text-screen';
import { mode7CellAddress, mode7StartAddress } from './video/mode7-text';
import { TEST_PAGE_COUNT, teletextTestPage } from './video/teletext-test-page';
import { teletextFlashVisible } from './video/teletext-attributes';
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

const screenFrame = document.querySelector<HTMLElement>('.screen-frame');
// instanceof narrows querySelector's Element to the canvas, so no cast is needed.
const screenElement = screenFrame?.querySelector('#screen');
if (!screenFrame || !(screenElement instanceof HTMLCanvasElement)) throw new Error('Missing #screen canvas in .screen-frame');
const host = document.querySelector<HTMLElement>('#workbench');
if (!host) throw new Error('Missing #workbench element');
// Registers, Stack and Memory sit under the screen; the other panels go in the workbench column.
const underScreen = document.querySelector<HTMLElement>('#under-screen');
if (!underScreen) throw new Error('Missing #under-screen element');

const params = new URLSearchParams(window.location.search);
const mosMode = params.get('machine') === 'mos';
const startPaused = params.has('paused');
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

// The screen: MODE 7's 1,000 bytes from wherever the CRTC's R12/R13 say it
// starts (the MOS scrolls by moving that), drawn as teletext dots on the
// canvas (Stage 31), with the same cells as invisible text on top.
const screenCanvas = createScreenCanvas(screenElement);
const textScreen = createTextScreen();
screenFrame.append(textScreen.element);
const peekScreen = (address: number): number => machine.peek(address);
// The SAA5050 times its own flash by counting fields (Stage 33), so the
// phase comes from the vsyncs so far: paused, it stops blinking. (In the
// playground the fake vsync is off, so flashing text stays shown.)
const drawScreen = (): void => {
  const start = mode7StartAddress(machine.crtc.register(12), machine.crtc.register(13));
  screenCanvas.draw(peekScreen, start, teletextFlashVisible(machine.vsync.pulses));
  textScreen.draw(peekScreen, start);
};

const refreshAll = (): void => {
  workbench.refreshAll();
  drawScreen();
};

// ── The frame loop (Stage 30): MOS mode runs in real time ────────────────
//
// Every BBC frame draws the screen. The panels rebuild their tables, which
// costs more, and nobody reads a hex dump at 50 Hz: they refresh at most 10
// times a second while running, and once more on pause. The write log is
// cleared with each panel refresh, so the Memory panel marks what was
// written since the last one.
const PANEL_REFRESH_MS = 100;
let lastPanelRefresh = 0;
let framesRun = 0;
const loop = createFrameLoop(
  {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => {
      cancelAnimationFrame(id);
    },
  },
  {
    runFrame: () => {
      machine.runFrame();
      framesRun++;
    },
    draw: () => {
      drawScreen();
      const now = performance.now();
      if (now - lastPanelRefresh < PANEL_REFRESH_MS) return;
      lastPanelRefresh = now;
      workbench.refreshAll();
      target.writes.clear();
      controls.update(true, framesRun, loop.speed);
    },
    onError: (error) => {
      refreshAll();
      controls.say(`Stopped: ${error instanceof Error ? error.message : String(error)}`, true);
    },
  },
);

/** Pauses the loop (if running) and shows everything as it is now. */
function pause(): void {
  loop.pause();
  refreshAll();
  controls.update(false, framesRun, loop.speed);
}

function run(): void {
  registers.stop();
  loop.start();
  controls.update(true, framesRun, loop.speed);
}

/**
 * The teletext test pages (Stages 32 and 33): pokes a page's 1,000 bytes
 * into screen memory from wherever the screen starts now (after a scroll
 * that isn't &7C00), so it fills the screen top to bottom. With no page,
 * the next one in turn. It doesn't pause (Stage 33): the flash needs the
 * machine running, and the MOS only redraws what it prints.
 */
let testPageShown = 0;
function showTestPage(page = (testPageShown % TEST_PAGE_COUNT) + 1): void {
  const bytes = teletextTestPage(page);
  testPageShown = page;
  const start = mode7StartAddress(machine.crtc.register(12), machine.crtc.register(13));
  bytes.forEach((byte, cell) => {
    machine.poke(mode7CellAddress(start, cell), byte);
  });
  refreshAll();
  if (!loop.running) controls.say(`Showing teletext test page ${String(page)} of ${String(TEST_PAGE_COUNT)}. Run to see it flash.`);
}

const controls = createRunControls({
  onToggle: () => {
    if (loop.running) pause();
    else run();
  },
  onStepFrame: () => {
    target.writes.clear();
    loop.stepFrame();
    refreshAll();
    controls.update(false, framesRun, loop.speed);
  },
  onBreak: () => {
    machine.reset();
    target.writes.clear();
    refreshAll();
    if (!loop.running) controls.update(false, framesRun, loop.speed);
  },
  onTestPage: showTestPage,
  onPowerOn: () => {
    machine.powerOn();
    framesRun = 0;
    target.writes.clear();
    refreshAll();
    if (!loop.running) controls.update(false, framesRun, loop.speed);
  },
});
if (mosMode) screenFrame.after(controls.element);

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
// Step, Run or Reset in the Registers panel pause the frame loop first: one driver at a time.
const registers = createRegistersPanel(target, {
  onRun: refreshAll,
  onTakeControl: () => {
    if (loop.running) pause();
  },
});
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
    if (startPaused) controls.update(false, framesRun, loop.speed);
    else run();
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
      refreshAll();
    },
    goTo: (address: number): void => {
      memory.goTo(address);
    },
    step: (): number => {
      target.writes.clear();
      const cycles = target.step();
      refreshAll();
      return cycles;
    },
    machine,
    screen: screenCanvas,
    testPage: showTestPage,
    loop,
    pause,
    run,
    cpu: machine.cpu,
    map: bus,
    powerOn: (): void => {
      machine.powerOn();
      refreshAll();
    },
    systemVia,
    userVia,
    trace: (count = 20): string => [TRACE_HEADER, ...target.trace.recent(count).map((entry) => formatTraceLine(entry, labels))].join('\n'),
    irq: (): void => {
      target.ringIrq();
      refreshAll();
    },
    nmi: (): void => {
      target.pulseNmi();
      refreshAll();
    },
    help: `workbench.testPage(), workbench.pause(), workbench.run(), workbench.loop.speed, workbench.machine.runFrame(), workbench.powerOn(), workbench.poke(0x${hex16(PROGRAM_PAGE + 1)}, 0xff), workbench.step(), workbench.peek(addr), workbench.goTo(addr), workbench.trace(20), workbench.map.ioLog.recent(), workbench.userVia.pins('b'), workbench.systemVia.setControlLine('ca1', 0), workbench.irq(), workbench.nmi(), workbench.cpu.regs`,
  },
});
