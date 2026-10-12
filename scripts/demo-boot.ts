// Stage 27 demo: MOS 1.20 on the real machine, BbcModelB, with its two VIAs
// ticked and wired to /IRQ. It gets further than Stage 23, and stalls somewhere new.
//
//   npm run demo:boot
//
// Part 1 builds the machine and powers it on. Part 2 runs it a frame at a
// time: the budget, and what the MOS does to the System VIA. Part 3 runs to
// the stall and explains it. Part 4 presses BREAK. Part 5 is an experiment:
// PA7 held low, as Stage 28's keyboard will, and the IRQ storm that follows.

import { lastLap } from '../src/cpu/stall-detector';
import { TRACE_HEADER } from '../src/cpu/trace';
import { BbcModelB, CYCLES_PER_FRAME } from '../src/machine/bbc-model-b';
import { loadStandardRoms } from '../src/memory/rom-files';
import { describeIoAddress } from '../src/memory/sheila';
import { MOS_LABELS, describeMosVariable, formatMosTraceLine, mosHeading } from '../src/mos/mos-labels';
import { MosRunner } from '../src/mos/mos-runner';
import { hex16, hex8 } from '../src/util/bits';

const MAX_CYCLES = 40_000_000; // 20 emulated seconds
const CYCLES_PER_MS = 2000;
const IER = 0xfe4e;
const IFR = 0xfe4d;

function name(address: number): string {
  return MOS_LABELS.get(address) ?? `&${hex16(address)}`;
}

function bbcTime(cycles: number): string {
  return `${(cycles / CYCLES_PER_MS).toFixed(1)} ms`;
}

/** A machine with the ROMs from roms/, or undefined (and why) if the MOS is missing. */
function machine(): BbcModelB | undefined {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map);
  if (!report.loaded.some((r) => r.id === 'mos')) return undefined;
  return m;
}

function showVariables(m: BbcModelB, addresses: readonly number[]): void {
  for (const address of addresses) console.log(`    &${hex16(address)} = &${hex8(m.peek(address))}   ${describeMosVariable(address) ?? ''}`);
}

function showMode7(m: BbcModelB, rows: number): void {
  console.log(`    ┌${'─'.repeat(40)}┐`);
  for (let row = 0; row < rows; row++) {
    let text = '';
    for (let col = 0; col < 40; col++) {
      const b = m.peek(0x7c00 + row * 40 + col) & 0x7f;
      text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ';
    }
    console.log(`    │${text}│`);
  }
  console.log(`    └${'─'.repeat(40)}┘`);
}

function showLap(runner: MosRunner, max: number): void {
  const lap = lastLap(runner.tracer.recent(runner.tracer.length));
  console.log(`  One lap (${String(lap.length)} steps${lap.length > max ? `, the first ${String(max)} shown` : ''}), from the trace:`);
  console.log(`  ${TRACE_HEADER}`);
  for (const e of lap.slice(0, max)) {
    const heading = mosHeading(e.pc);
    if (heading !== undefined) console.log(`  ${heading}`);
    console.log(`  ${formatMosTraceLine(e)}`);
  }
}

/** The trace from the second-to-last IRQ sequence up to and including the last: one round of a storm. */
function showIrqToIrq(runner: MosRunner): void {
  const entries = runner.tracer.recent(runner.tracer.length);
  const irqAt: number[] = [];
  entries.forEach((e, i) => {
    if (e.kind === 'irq') irqAt.push(i);
  });
  const from = irqAt.at(-2);
  const to = irqAt.at(-1);
  if (from === undefined || to === undefined) return;
  console.log(`  From one IRQ to the next (${String(to - from)} steps), from the trace:`);
  console.log(`  ${TRACE_HEADER}`);
  for (const e of entries.slice(from, to + 1)) {
    const heading = mosHeading(e.pc);
    if (heading !== undefined && e.kind === 'instruction') console.log(`  ${heading}`);
    console.log(`  ${formatMosTraceLine(e)}`);
  }
}

function showIo(m: BbcModelB, count: number): void {
  for (const access of m.map.ioLog.recent(count)) {
    const what = access.write ? `write &${hex8(access.value)}` : `read  &${hex8(access.value)}`;
    console.log(`    &${hex16(access.address)}  ${what}   ${describeIoAddress(access.address).text}`);
  }
}

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: build the machine, and switch it on ──');
const first = machine();
if (first === undefined) {
  console.log('  skipped: roms/os12.rom is missing (Acorn copyright, so you supply it).');
  process.exit(0);
}
console.log(`  ${first.name}: a 6502, the memory map with MOS 1.20 and BASIC II, a System VIA at &FE40`);
console.log('  and a User VIA at &FE60. Both VIAs are ticked after every step and wired to /IRQ.');
console.log(`  powerOn(): both VIAs reset (IER reads &${hex8(first.peek(IER))}), then the CPU's ${String(first.powerOn())}-cycle reset: PC = &${hex16(first.registers.pc)}.`);

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: frame by frame (runFrame = 40,000 cycles, 1/50 s) ──');
console.log('  "ran" is what each frame really ran: whole instructions, so a few cycles over or under.');
console.log('  "drift" is the running total minus frames × 40,000: the overshoot carried, never growing.');
console.log('  Rows shown: the first five, and any frame where the System VIA or the IRQ line changed.');
console.log('  frame     ran   drift   IER  IFR  /IRQ held by   I   PC     ');
let total = 0;
let lastState = '';
for (let frame = 1; frame <= 60; frame++) {
  const ran = first.runFrame();
  total += ran;
  const state = `${hex8(first.peek(IER))} ${hex8(first.peek(IFR))} ${first.irqHolders.join(', ') || '-'}`;
  if (frame <= 5 || state !== lastState) {
    const holders = (first.irqHolders.join(', ') || 'nobody').padEnd(13);
    const i = first.registers.i ? '1' : '0';
    console.log(`  ${String(frame).padStart(5)}  ${String(ran).padStart(6)}  ${String(total - frame * CYCLES_PER_FRAME).padStart(5)}   &${hex8(first.peek(IER))}  &${hex8(first.peek(IFR))} ${holders}  ${i}   &${hex16(first.registers.pc)}  ${name(first.registers.pc) === `&${hex16(first.registers.pc)}` ? '' : name(first.registers.pc)}`);
  }
  lastState = state;
}
console.log(`  60 frames: ${String(total)} cycles = 60 × 40,000 + ${String(total - 60 * CYCLES_PER_FRAME)}. That's 1.2 s of BBC time, to the cycle.`);
console.log('  IER &F2 = 1111 0010: T1, T2, CB1 and CA1 enabled (the MOS at &DA80). ACR &' + hex8(first.peek(0xfe4b)) + ', PCR &' + hex8(first.peek(0xfe4c)) + '.');
console.log('  IFR &C0: T1 ran out (bit 6), so bit 7 is set and the System VIA holds /IRQ low. T1 is the 100 Hz');
console.log(`  tick: its latch is &${hex16(first.systemVia.timers().t1.latch)} = ${String(first.systemVia.timers().t1.latch)}, + 2 = 10,000 µs at 1 MHz. But I = 1: the CPU isn't listening.`);

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: run until nothing new runs for one emulated second ──');
const m = machine();
if (m === undefined) process.exit(0);
const runner = new MosRunner(m);
m.powerOn();
runner.clear();
const result = runner.runUntilStall(MAX_CYCLES);
console.log(`  ${result.kind === 'stall' ? 'Stalled' : 'No stall'}: ${String(result.instructions)} instructions, ${String(result.cycles)} cycles (${bbcTime(result.cycles)}). Last new code at ${bbcTime(runner.stall.lastNewCycle)}.`);
console.log('\n  How it got here: the shadow call stack, outermost first');
for (const f of runner.calls.frames()) {
  const how = f.kind === 'jsr' ? `JSR ${name(f.to)}` : `${f.kind.toUpperCase()} → ${name(f.to)}`;
  console.log(`    &${hex16(f.from)}  ${how.padEnd(26)} (S = &${hex8(f.s)})`);
}
console.log('  The same CTRL+SHIFT "halt scrolling" wait as Stage 23, inside the start-up message.');
console.log('\n  The last 6 I/O accesses: a keyTest for SHIFT, then CTRL. This time it\'s a real VIA answering.');
showIo(m, 6);
console.log('  DDRA = &7F: PA0-6 are outputs (the key number) and PA7 is an INPUT. The keyboard should drive PA7');
console.log('  low for "not pressed", but there is no keyboard yet (Stage 28). An input with nothing on it reads 1');
console.log('  in our VIA (Stage 24), so IRA = &80 + key: every key is "down". CTRL and SHIFT are held, so it waits.');
console.log('\n  What the MOS believes now. Compare Stage 23: BREAK type 2, 16K, mode 4.');
showVariables(m, [0x028d, 0x028e, 0x028f, 0x0355]);
console.log('  IER read &80 at &D9D7, so it was a power-on: RAM cleared and measured, 32K. The links are read');
console.log('  through the keyboard too: all 8 "down" means all fitted, which reads as &00: mode 0.');
console.log(`\n  And /IRQ: held by the ${m.irqHolders.join(', ')} (IFR &${hex8(m.peek(IFR))}), with I = ${m.registers.i ? '1' : '0'}. The 100 Hz tick waits, unanswered.`);
showLap(runner, 24);

// ── Part 4 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 4: press BREAK (reset(): the CPU only) ──');
m.reset();
for (let i = 0; i < 25; i++) m.runFrame();
console.log(`  IER still read &F2 (the VIAs weren't reset), so it's not a power-on: &028D = ${String(m.peek(0x028d))}.`);
console.log('  2 is CTRL+BREAK: PA7 floating says CTRL is held, here as everywhere.');

// ── Part 5 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 5: what if PA7 read 0, as a keyboard with no key down would? (an experiment: Stage 28 does it properly) ──');
const exp = machine();
if (exp === undefined) process.exit(0);
exp.systemVia.setOutside('a', 0x7f); // the outside pulls PA7 low
const expRunner = new MosRunner(exp);
exp.powerOn();
expRunner.clear();
const expResult = expRunner.runUntilStall(MAX_CYCLES);
console.log(`  ${expResult.kind === 'stall' ? 'Stalled' : 'No stall'} after ${bbcTime(expResult.cycles)}. Last new code at ${bbcTime(expRunner.stall.lastNewCycle)}. Mode 7 screen memory:`);
showMode7(exp, 5);
showVariables(exp, [0x028d, 0x028f, 0x0355]);
const irqs = expRunner.tracer.recent(expRunner.tracer.length).filter((e) => e.kind === 'irq').length;
console.log(`\n  The banner is in screen memory. But the last ${String(expRunner.tracer.length)} steps held ${String(irqs)} IRQ sequences, one every lap of the`);
console.log('  handler, and nothing else: an IRQ storm.');
console.log(`  /IRQ is held by the ${exp.irqHolders.join(', ')} (IFR &${hex8(exp.peek(IFR))}), and nothing ever clears it.`);
console.log('  The last 6 I/O accesses: never &FE4D, only the ACIA.');
showIo(exp, 6);
showIrqToIrq(expRunner);
console.log('  The MOS asks the ACIA first (&DCA2 LDA &FE08). There\'s no ACIA, so the read floats to &FE, the high');
console.log('  byte of the address just fetched. Bit 7 set: "it\'s me". So the MOS services the ACIA, reads a');
console.log('  "byte" from &FE09, raises event 7 (RS423 error) and returns. The System VIA was never asked, still');
console.log('  holds /IRQ, and the moment RTI clears I the CPU goes straight back in. BASIC, interrupted at the same');
console.log('  address every time, never runs another instruction. On a shared line, one chip that answers');
console.log('  "it\'s me" when it isn\'t hides the real one. Stage 28/29 must stub the keyboard AND an ACIA that says "not me".');
