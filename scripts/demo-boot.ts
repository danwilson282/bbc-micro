// Stage 29 demo: the first boot. MOS 1.20 and BASIC II reach the > prompt,
// and the MODE 7 screen is printed as text.
//
//   npm run demo:boot
//
// Part 1 is the milestone. Part 2 is how the Stage 28 stall was diagnosed:
// the MOS asks the ACIA first on every IRQ. Part 3 is one interrupt now,
// traced. Part 4 is where the machine rests: waiting for a key. Part 5 is
// what vsync is for, with it and without it.

import { disassemble } from '../src/cpu/disassembler';
import { describeHardwareWrite } from '../src/devices/hardware-log';
import { ACIA_IDLE_STATUS } from '../src/devices/stubs/acia-stub';
import { BbcModelB, CYCLES_PER_FRAME } from '../src/machine/bbc-model-b';
import { loadStandardRoms } from '../src/memory/rom-files';
import { MOS_LABELS, MOS_NOTES, formatMosTraceLine, mosHeading } from '../src/mos/mos-labels';
import { MosRunner } from '../src/mos/mos-runner';
import { hex16, hex8 } from '../src/util/bits';
import { MODE7_SCREEN_START, formatMode7Text, mode7Text } from '../src/video/mode7-text';

const CYCLES_PER_MS = 2000;
const BOOT_FRAMES = 50; // 1 emulated second
const PROMPT_ROW = 5;

function bbcTime(cycles: number): string {
  return `${(cycles / CYCLES_PER_MS).toFixed(1)} ms`;
}

function bin8(value: number): string {
  return value.toString(2).padStart(8, '0');
}

/** A machine with the ROMs from roms/, or undefined if they're missing. */
function machine(): BbcModelB | undefined {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map);
  const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
  if (!has('mos') || !has('basic')) return undefined;
  return m;
}

function booted(setUp: (m: BbcModelB) => void = () => undefined): BbcModelB {
  const m = machine();
  if (m === undefined) process.exit(0);
  setUp(m);
  m.powerOn();
  for (let i = 0; i < BOOT_FRAMES; i++) m.runFrame();
  return m;
}

/** One line of disassembly from the MOS, with its label heading and note. */
function mosLine(m: BbcModelB, address: number): string {
  const d = disassemble((a) => m.peek(a), address, MOS_LABELS);
  const note = MOS_NOTES.get(address);
  return `    &${hex16(address)}  ${d.text.padEnd(18)}${note === undefined ? '' : `; ${note}`}`.trimEnd();
}

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: power on, and wait ──');
const first = machine();
if (first === undefined) {
  console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
  process.exit(0);
}
first.powerOn();
const promptAddress = MODE7_SCREEN_START + PROMPT_ROW * 40;
while (first.peek(promptAddress) !== 0x3e && first.cycles < 10 * BOOT_FRAMES * CYCLES_PER_FRAME) first.step();
console.log(`  ">" appeared at &${hex16(promptAddress)} after ${bbcTime(first.cycles)} (frame ${String(Math.ceil(first.cycles / CYCLES_PER_FRAME))}).`);
const m = booted();
console.log(`  After ${String(BOOT_FRAMES)} frames (1 second), MODE 7 screen memory reads:\n`);
const rows = mode7Text((a) => m.peek(a));
let last = rows.length - 1;
while (last > PROMPT_ROW + 1 && rows[last]?.trim() === '') last--;
for (const line of formatMode7Text(rows.slice(0, last + 1))) console.log(`  ${line}`);
console.log(`        (rows ${String(last + 1)}-24 are blank too)\n`);
console.log('  🎉 BBC Computer 32K, BASIC, and the prompt.');

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: what Stage 28 was stuck on ──');
console.log('  Stage 28 stalled in an IRQ storm. The I/O log showed the same two reads, over and over:');
console.log('    &FE08  read  &FE   ACIA reg 0 (status / control)');
console.log('    &FE09  read  &FE   ACIA reg 1 (data)');
console.log('  The MOS\'s IRQ handler asks the ACIA before anything else:');
for (const a of [0xdca1, 0xdca2, 0xdca5, 0xdca7]) console.log(mosLine(m, a));
console.log('  6850 status bit 7 = "I am pulling /IRQ low". With no chip there, the read floats:');
console.log(`    &FE = ${bin8(0xfe)}   bit 7 = 1: "yes, it's me".`);
console.log('                     It services an ACIA that isn\'t there, returns, and the System VIA\'s T1 flag');
console.log('                     (never cleared) interrupts again at once.');
console.log(`  The ACIA stub answers &${hex8(ACIA_IDLE_STATUS)}:`);
console.log(`    &${hex8(ACIA_IDLE_STATUS)} = ${bin8(ACIA_IDLE_STATUS)}   bit 7 = 0: "not me". Bit 1 (TDRE): transmitter empty.`);
console.log(`  And it's honest: the MOS has written control &${hex8(m.acia.control)} = ${bin8(m.acia.control)}:`);
console.log('    bits 0-1 = 10 divide by 64, bits 2-4 = 101 8N1, bits 5-6 = 10 RTS high + transmit IRQ off, bit 7 = 0 receive IRQ off.');
console.log('  Both interrupts off, so a real 6850 couldn\'t say "me" either.');

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: one Timer 1 interrupt now, traced ──');
const t = booted();
// Step until the CPU takes an IRQ, then until the handler's RTI.
const runner = new MosRunner(t);
runner.clear();
while (t.pendingInterrupt !== 'irq') t.step();
const ifrAtIrq = t.peek(0xfe4d);
t.trace.clear();
let steps = 0;
for (;;) {
  const pc = t.registers.pc;
  t.step();
  steps++;
  if (t.peek(pc) === 0x40 || steps > 400) break; // RTI
}
const wanted = new Set([0xdca2, 0xdca5, 0xdca7, 0xdd06, 0xdd09, 0xdd0b, 0xdd0e, 0xdd11, 0xdd12, 0xdd13, 0xdd69, 0xddca, 0xddcc, 0xddce]);
const shown = new Set<number>();
for (const e of t.trace.recent(t.trace.length)) {
  if (e.kind === 'irq') console.log(`  ${String(e.cycles)}  IRQ: System VIA IFR = &${hex8(ifrAtIrq)} (${bin8(ifrAtIrq)}), so /IRQ is low; the CPU goes through &FFFE`);
  else if (wanted.has(e.pc) && !shown.has(e.pc)) {
    shown.add(e.pc);
    const heading = mosHeading(e.pc);
    if (heading !== undefined) console.log(`  ${heading}`);
    console.log(`  ${formatMosTraceLine(e)}`);
  }
}
console.log(`  ... ${String(steps)} instructions in all, ending in RTI. Only the interesting lines are shown:`);
console.log('  the ACIA says no (&02), the System VIA\'s IFR says T1 (&C0), and &40 to the IFR clears it. /IRQ is let go.');

// ── Part 4 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 4: where it rests now ──');
const s = booted();
const rest = new MosRunner(s);
rest.clear();
const result = rest.runUntilStall(200 * CYCLES_PER_FRAME);
const named = [...new Set(result.loop.map((a) => MOS_LABELS.get(a)).filter((n): n is string => n !== undefined))];
console.log(`  ${result.kind === 'stall' ? 'The stall detector fires' : 'No stall'} after ${bbcTime(result.cycles)} more (it waits for 1 s in which no new code runs).`);
console.log(`  Named addresses in the loop: ${named.join(', ')}.`);
console.log('  rdchWait and defaultREM: "is the keyboard buffer empty?" BASIC is waiting for you to type.');
console.log(`  At the moment it stopped, /IRQ was held by: ${s.irqHolders.length === 0 ? 'nobody' : s.irqHolders.join(', ')}. Interrupts come and go, 150 a second`);
console.log('  (Timer 1 at 100 Hz, vsync at 50 Hz); each is cleared by the handler, so the CPU always gets back to BASIC.');
console.log('  That\'s the stall we want. Part 7 (the keyboard) is what ends it.');

// ── Part 5 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 5: what vsync is for ──');
console.log('  The CRTC\'s VSYNC (Stage 38) on System VIA CA1: high for 2 lines every 312.5, so it falls every 40,000 cycles.');
console.log(`  PCR = &${hex8(m.peek(0xfe4c))}: bit 0 = 0, CA1 interrupts on a falling edge. IER = &${hex8(m.peek(0xfe4e))} = ${bin8(m.peek(0xfe4e))}: bit 1 (CA1) enabled.`);
console.log('  The handler\'s vsync branch:');
for (const a of [0xdd11, 0xdd12, 0xdd13, 0xdd15, 0xdd42]) console.log(mosLine(m, a));

/** *FX19 from &0900, then INC &70. Returns &70 after `frames`. */
function fx19(x: BbcModelB, frames: number): number {
  [0xa9, 0x13, 0x20, 0xf4, 0xff, 0xe6, 0x70, 0x4c, 0x07, 0x09].forEach((b, i) => {
    x.poke(0x0900 + i, b);
  });
  x.poke(0x70, 0);
  x.cpu.regs.pc = 0x0900;
  for (let i = 0; i < frames; i++) x.runFrame();
  return x.peek(0x70);
}

console.log('\n  The same machine, one more second, with the VSYNC-to-CA1 wire joined and cut:');
console.log('         CRTC VSYNCs  &0240 moved  ULA flash writes   *FX19 returned?  prompt at boot?');
for (const on of [true, false]) {
  const x = booted((machine) => {
    machine.vsyncWired = on;
  });
  const prompt = mode7Text((a) => x.peek(a))[PROMPT_ROW]?.startsWith('>') ?? false;
  const pulses = x.crtc.vsyncCount;
  const before = x.peek(0x0240);
  x.hardwareLog.clear();
  for (let i = 0; i < BOOT_FRAMES; i++) x.runFrame();
  const vsyncs = x.crtc.vsyncCount - pulses;
  const moved = (before - x.peek(0x0240)) & 0xff;
  const flashes = x.hardwareLog.recent().filter((w) => w.device === 'ulaControl');
  const returned = fx19(x, 10) === 1;
  console.log(
    `    ${on ? 'joined' : 'cut   '}  ${String(vsyncs).padStart(9)}  ${String(moved).padStart(11)}  ${`${String(flashes.length)} ${flashes.map((w) => describeHardwareWrite(w).replace('ULA ctrl=', '')).join(' ')}`.padEnd(17)}  ${(returned ? 'yes' : 'no: hangs').padEnd(15)}  ${prompt ? 'yes' : 'no'}`,
  );
}
console.log('  The boot doesn\'t need vsync: the clock and the keyboard run from Timer 1. But &0240 stands still,');
console.log('  colours never flash, and *FX19 ("wait for the next frame") loops at waitVsync for ever:');
for (const a of [0xe9b6, 0xe9b9, 0xe9ba, 0xe9bb, 0xe9be]) console.log(mosLine(m, a));
console.log('  The CRTC counts its fields either way: cut, the MOS just never hears about them.');
