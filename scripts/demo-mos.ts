// Stage 23 demo: MOS 1.20 running headless, from RESET to the point where it
// stalls waiting for hardware.
//
//   npm run demo:mos
//
// Part 1 powers on. Part 2 prints the first instructions as an annotated
// trace. Part 3 runs until nothing new has run for an emulated second, and
// lists the milestones on the way. Part 4 takes the stall apart: the call
// chain, one lap of the loop, the I/O it does, and what the MOS now believes.
// Part 5 is an experiment: the same run with a "System VIA" that reads &00.

import { RESET_VECTOR } from '../src/cpu/cpu6502';
import { lastLap } from '../src/cpu/stall-detector';
import { TRACE_HEADER } from '../src/cpu/trace';
import { BbcMemoryMap, type BbcMemoryMapOptions } from '../src/memory/bbc-memory-map';
import type { IoDevice } from '../src/memory/io-device';
import { loadStandardRoms, romPath } from '../src/memory/rom-files';
import { describeIoAddress } from '../src/memory/sheila';
import { MOS_LABELS, describeMosVariable, formatMosTraceLine, mosHeading } from '../src/mos/mos-labels';
import { MosRunner } from '../src/mos/mos-runner';
import { hex16, hex8 } from '../src/util/bits';

const FIRST_INSTRUCTIONS = 46;
const MAX_CYCLES = 40_000_000; // 20 emulated seconds: far more than either run needs
const CYCLES_PER_MS = 2000;

function name(address: number): string {
  return MOS_LABELS.get(address) ?? `&${hex16(address)}`;
}

function bbcTime(cycles: number): string {
  return `${(cycles / CYCLES_PER_MS).toFixed(1)} ms`;
}

/** Builds a map with the ROMs from roms/, or explains what's missing and returns undefined. */
function machine(options: BbcMemoryMapOptions = {}): BbcMemoryMap | undefined {
  const map = new BbcMemoryMap(options);
  const report = loadStandardRoms(map);
  if (!report.loaded.some((r) => r.id === 'mos')) return undefined;
  return map;
}

/** The first time each named routine ran, in order: how far the boot got, and when. */
function printMilestones(runner: MosRunner, limit: number): void {
  console.log('\n  Milestones: the first time each named routine ran');
  const reached = [...MOS_LABELS.entries()]
    .map(([address, label]) => ({ address, label, step: runner.stall.firstRun(address) }))
    .filter((m): m is { address: number; label: string; step: number } => m.step !== undefined)
    .sort((a, b) => a.step - b.step);
  const shown = reached.slice(0, limit);
  for (const m of shown) console.log(`    step ${String(m.step).padStart(6)}  &${hex16(m.address)}  ${m.label}`);
  if (reached.length > shown.length) console.log(`    … and ${String(reached.length - shown.length)} more`);
}

/** Runs to the stall and prints the milestones (up to milestoneLimit), the call chain and one lap. */
function runAndExplain(runner: MosRunner, milestoneLimit: number): void {
  const result = runner.runUntilStall(MAX_CYCLES);
  const { stall } = runner;
  if (result.kind !== 'stall') {
    console.log(`  no stall within ${String(MAX_CYCLES)} cycles: PC = &${hex16(result.pc)}`);
    return;
  }
  console.log(`  Stalled. ${String(result.instructions).padStart(7)} instructions, ${String(result.cycles)} cycles (${bbcTime(result.cycles)} of BBC time).`);
  console.log(`  The last new address ran at cycle ${String(stall.lastNewCycle)} (${bbcTime(stall.lastNewCycle)}); after that, a whole`);
  console.log('  emulated second of nothing new.');

  if (milestoneLimit > 0) printMilestones(runner, milestoneLimit);

  console.log('\n  How it got here: the shadow call stack, outermost first');
  for (const f of runner.calls.frames()) {
    const how = f.kind === 'jsr' ? `JSR ${name(f.to)}` : `${f.kind.toUpperCase()} → ${name(f.to)}`;
    console.log(`    &${hex16(f.from)}  ${how.padEnd(26)} (S = &${hex8(f.s)})`);
  }

  const lap = lastLap(runner.tracer.recent(runner.tracer.length));
  const routines = new Set(result.loop.map((a) => MOS_LABELS.get(a)).filter((l) => l !== undefined));
  console.log(`\n  The loop: ${String(result.loop.length)} addresses between &${hex16(result.loop[0] ?? 0)} and &${hex16(result.loop[result.loop.length - 1] ?? 0)}, through ${[...routines].join(', ')}.`);
  console.log(`  One lap (${String(lap.length)} instructions), from the trace:`);
  console.log(`  ${TRACE_HEADER}`);
  for (const e of lap) {
    const heading = mosHeading(e.pc);
    if (heading !== undefined) console.log(`  ${heading}`);
    console.log(`  ${formatMosTraceLine(e)}`);
  }
}

/** The text in mode 7 screen memory, &7C00-&7FE7: 25 rows of 40 bytes, near enough ASCII. */
function printMode7(map: BbcMemoryMap): void {
  console.log(`    ┌${'─'.repeat(40)}┐`);
  for (let row = 0; row < 25; row++) {
    let text = '';
    for (let col = 0; col < 40; col++) {
      const b = map.peek(0x7c00 + row * 40 + col) & 0x7f;
      text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ';
    }
    if (row < 7) console.log(`    │${text}│`);
  }
  console.log(`    │${' '.repeat(16)}…       ${' '.repeat(16)}│`);
  console.log(`    └${'─'.repeat(40)}┘`);
}

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: power on ──');
const map = machine();
if (map === undefined) {
  console.log(`  skipped: ${romPath({ id: 'mos', file: 'os12.rom', name: 'MOS 1.20', slot: 'mos' })} is missing (Acorn copyright, so you supply it).`);
  process.exit(0);
}
const runner = new MosRunner(map);
runner.reset();
const resetVector = map.peek(RESET_VECTOR) | (map.peek(RESET_VECTOR + 1) << 8);
console.log(`  ROMs in. No devices: every SHEILA chip but ROMSEL floats. No interrupts, no screen, no keyboard.`);
console.log(`  RESET: 7 cycles, I = 1, S = &${hex8(runner.cpu.regs.s)}, PC = (&FFFC) = &${hex16(resetVector)}.`);

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log(`\n── Part 2: the first ${String(FIRST_INSTRUCTIONS)} instructions, annotated ──`);
console.log('  Names in operands: the AUG\'s OS calls and vectors, and our names for routines (see the doc).');
console.log('  Comments: why a line is there, or what it touches. Registers are BEFORE each line.');
console.log(`  ${TRACE_HEADER}`);
for (let i = 0; i < FIRST_INSTRUCTIONS; i++) runner.step();
for (const e of runner.tracer.recent(FIRST_INSTRUCTIONS)) {
  const heading = mosHeading(e.pc);
  if (heading !== undefined) console.log(`  ${heading}`);
  console.log(`  ${formatMosTraceLine(e)}`);
}
console.log('  The first surprise is at &D9D7: IER (&FE4E) has no chip behind it, so the read');
console.log('  floats to &FE, the high byte of the operand just fetched. ASL gives &FC, not &00: "BREAK, not');
console.log('  power-on". And every keyTest (&F037 LDX &FE4F) floats to &FE too: bit 7 set, "key down".');

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: run until nothing new runs for one emulated second (2,000,000 cycles) ──');
runAndExplain(runner, 24);

// ── Part 4 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 4: why there ──');
console.log('  The last 10 I/O accesses (from the Stage 21 log): one keyTest for SHIFT, one for CTRL.');
const io = map.ioLog.recent(10);
for (const access of io) {
  const what = access.write ? `write &${hex8(access.value)}` : `read  &${hex8(access.value)}`;
  console.log(`    &${hex16(access.address)}  ${what}   ${describeIoAddress(access.address).text}`);
}
console.log('  keyTest asks about SHIFT (key &00), then CTRL (key &01). Each answer is LDX &FE4F, which floats');
console.log('  to &FE: bit 7 set, "held down". CTRL and SHIFT held together means "halt scrolling" on a real');
console.log('  BBC, so the VDU code waits, inside the line feed of the start-up message, for them to be let go.');
console.log('\n  What the MOS believes, from the same floating bus:');
for (const address of [0x028d, 0x028e, 0x028f, 0x0355, 0x02a1 + 15]) {
  console.log(`    &${hex16(address)} = &${hex8(map.peek(address))}   ${describeMosVariable(address) ?? ''}`);
}
console.log('  CTRL "held" at reset made it a CTRL+BREAK (2). It never measured RAM (only power-on does), so');
console.log('  &028E = 0 means 16K, and the links\' mode 0 became mode 4. The ROM scan worked: BASIC (&60).');

// ── Part 5 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 5: what if the System VIA read &00 instead? (an experiment, not a real VIA) ──');
const readsZero: IoDevice = { read: () => 0, write: () => undefined, peek: () => 0 };
const zeroMap = machine({ devices: { systemVia: readsZero } });
if (zeroMap !== undefined) {
  const zero = new MosRunner(zeroMap);
  zero.reset();
  runAndExplain(zero, 0);
  console.log('\n  IER reads &00, so power-on: RAM cleared and measured (&028E = ' + `&${hex8(zeroMap.peek(0x028e))}), no key down, links give mode ${String(zeroMap.peek(0x0355))}.`);
  console.log('  Mode 7 screen memory at &7C00 (just bytes for now: Part 6 draws them):');
  printMode7(zeroMap);
  console.log('  BASIC is running and waiting for a key in OSRDCH. The keyboard puts keys in that buffer from');
  console.log('  an interrupt, and there are no interrupts yet: the next thing to build is the 6522 VIA.');
}
