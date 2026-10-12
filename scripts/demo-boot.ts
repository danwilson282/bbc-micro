// Stage 28 demo: MOS 1.20 on the machine, now with the IC32 latch, a keyboard
// stub, and storage stubs for the CRTC and Video ULA. The boot gets past the
// keyboard, and the hardware log says, by name, what it did to the chips.
//
//   npm run demo:boot
//
// Part 1 powers on. Part 2 compares the raw I/O log with the named hardware
// log. Part 3 is the boot's hardware writes, from power-on. Part 4 is what
// the MOS left in the stubs. Part 5 changes the keyboard links. Part 6 is
// where it stalls now, and BREAK.

import { CRTC_REGISTER_NAMES, describeHardwareWrite, type HardwareWrite } from '../src/devices/hardware-log';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { loadStandardRoms } from '../src/memory/rom-files';
import { describeIoAddress } from '../src/memory/sheila';
import { MosRunner } from '../src/mos/mos-runner';
import { hex16, hex8 } from '../src/util/bits';

const MAX_CYCLES = 40_000_000; // 20 emulated seconds
const CYCLES_PER_MS = 2000;
const BOOT_FRAMES = 40; // 0.8 s: past the MODE setup and the banner

function bbcTime(cycles: number): string {
  return `${(cycles / CYCLES_PER_MS).toFixed(1)} ms`;
}

/** A machine with the ROMs from roms/, or undefined if the MOS is missing. */
function machine(): BbcModelB | undefined {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map);
  if (!report.loaded.some((r) => r.id === 'mos')) return undefined;
  return m;
}

function showIo(m: BbcModelB, count: number): void {
  for (const access of m.map.ioLog.recent(count)) {
    const what = access.write ? `write &${hex8(access.value)}` : `read  &${hex8(access.value)}`;
    console.log(`    &${hex16(access.address)}  ${what}   ${describeIoAddress(access.address).text}`);
  }
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

function isLatch(w: HardwareWrite | undefined, bit: number, value: number): boolean {
  return w !== undefined && w.device === 'latch' && w.register === bit && w.value === value;
}

/**
 * The log as lines, with each sound write (bit 0 low, then high) as one line,
 * and runs of identical lines folded into "× n".
 */
function foldedLines(writes: readonly HardwareWrite[]): { cycles: number; text: string }[] {
  const lines: { cycles: number; text: string; times: number }[] = [];
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    let text = describeHardwareWrite(w);
    if (isLatch(w, 0, 0) && isLatch(writes[i + 1], 0, 1)) {
      text = 'latch: sound WE on, then off: one byte into the sound chip';
      i++;
    }
    const last = lines.at(-1);
    if (last !== undefined && last.text === text) last.times++;
    else lines.push({ cycles: w.cycles, text, times: 1 });
  }
  return lines.map((l) => ({ cycles: l.cycles, text: l.times > 1 ? `${l.text}   × ${String(l.times)}` : l.text }));
}

/** What a run of the log is about, for the summary: "CRTC R14", "latch bit 3". */
function topic(w: HardwareWrite): string {
  if (w.device === 'crtc') return `CRTC R${String(w.register)} (${CRTC_REGISTER_NAMES[w.register] ?? '?'})`;
  if (w.device === 'latch') return describeHardwareWrite(w).replace(/ \(bit.*$/, ''); // "latch: Caps Lock LED on"
  return w.device === 'ulaControl' ? 'ULA ctrl' : 'ULA palette';
}

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: the machine, with the new parts, switched on ──');
const first = machine();
if (first === undefined) {
  console.log('  skipped: roms/os12.rom is missing (Acorn copyright, so you supply it).');
  process.exit(0);
}
console.log('  New since Stage 27:');
console.log('    IC32 latch         on the System VIA\'s PB0-PB3 (address PB0-PB2, data PB3)');
console.log(`    keyboard stub      on the System VIA's port A: no key down, links &${hex8(first.keyboard.links)} (all open)`);
console.log('    CRTC stub          at &FE00-&FE01: stores R0-R17, nothing else (Stage 37 builds the 6845)');
console.log('    Video ULA stub     at &FE20-&FE21: stores control and palette (Stage 40 builds the ULA)');
console.log('    hardware log       what they are told, by name');
first.hardwareLog.clear();
first.powerOn();
console.log(`  powerOn(): the latch reads &${hex8(first.latch.value)}. The VIA's reset makes PB0-PB3 inputs, floating high: &F,`);
console.log('  address 7, data 1. So IC32 bit 7 is set before the CPU has run an instruction:');
for (const w of first.hardwareLog.recent()) console.log(`    ${String(w.cycles).padStart(8)}  ${describeHardwareWrite(w)}`);

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: the same moment, raw and named ──');
const two = machine();
if (two === undefined) process.exit(0);
two.powerOn();
two.hardwareLog.clear();
const isR0 = (w: HardwareWrite | undefined): boolean => w !== undefined && w.device === 'crtc' && w.register === 0;
while (!isR0(two.hardwareLog.recent(1)[0]) && two.cycles < MAX_CYCLES) two.step();
console.log('  Stepped until the MOS set CRTC R0. The I/O log (Stage 21) has the bus accesses:');
showIo(two, 4);
console.log('  The hardware log has what the CRTC made of them:');
for (const w of two.hardwareLog.recent(2)) console.log(`    ${describeHardwareWrite(w)}`);
console.log('  "&FE01 write &3F" needs the previous "&FE00 write &00" to mean anything. Only the CRTC knows.');

two.hardwareLog.clear();
const isAutoscanOn = (w: HardwareWrite | undefined): boolean => isLatch(w, 3, 1);
while (!isAutoscanOn(two.hardwareLog.recent(1)[0]) && two.cycles < MAX_CYCLES) two.step();
console.log('\n  And the latch. It isn\'t on the bus at all; the bus only sees a System VIA write:');
showIo(two, 1);
for (const w of two.hardwareLog.recent(1)) console.log(`    ${describeHardwareWrite(w)}`);
console.log('  &0B = 0000 1011: PB0-PB2 = 011 = bit 3, PB3 = 1. Bit 3 is the keyboard enable: autoscan on.');

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: every hardware write from power-on, until MODE 7 is set up ──');
const m = machine();
if (m === undefined) process.exit(0);
m.hardwareLog.clear();
m.powerOn();
for (let i = 0; i < BOOT_FRAMES; i++) m.runFrame();
const writes = m.hardwareLog.recent();
const endOfSetup = writes.findIndex((w) => w.device === 'crtc' && w.register === 13) + 1;
console.log('   cycles   what');
for (const line of foldedLines(writes.slice(0, endOfSetup))) console.log(`  ${String(line.cycles).padStart(7)}  ${line.text}`);
console.log('  Reading it:');
console.log('    0        PB0-PB3 floating high at power-on: bit 7.');
console.log('    ~507,000 (the MOS has cleared 32K of RAM first) DDRB = &0F at &DA05. PB0-PB3 stop floating and drive ORB,');
console.log('             which is &00 after reset: address 0, data 0. A sound write enable nobody asked for: the wires did it.');
console.log('             Then the walk at &DA08: &0E, &0D ... &08 sets bits 6 down to 0. Everything off.');
console.log('    autoscan off ... on: the links and CTRL being read as keys (&DA11). Then the LEDs (&EEEB).');
console.log('    the sound writes: bytes into the SN76489 (Part 10 decodes them). The latch makes each one a pulse.');
console.log('    C0 = 0, ULA &4B, CRTC R11 down to R0, then R14-R15 and R12-R13: MODE 7, the cursor, the screen start.');

const rest = writes.slice(endOfSetup);
const counts = new Map<string, number>();
for (const w of rest) counts.set(topic(w), (counts.get(topic(w)) ?? 0) + 1);
console.log(`\n  The next ${String(rest.length)} writes, counted by what they set:`);
for (const [what, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${what}`);
console.log('  The cursor following the banner as it\'s printed (R14-R15), and the keyboard being scanned (bit 3 off, LEDs, on).');

// ── Part 4 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 4: what the MOS left in the stubs ──');
console.log(`  &028F = &${hex8(m.peek(0x028f))}: the links, all open. Bits 0-2 = 7: MODE ${String(m.peek(0x028f) & 7)}. (&0355, the current MODE, = ${String(m.peek(0x0355))}.)`);
console.log('  CRTC:');
m.crtc.registers().forEach((value, r) => {
  if (r < 16) console.log(`    R${String(r).padEnd(2)} = &${hex8(value)}   ${CRTC_REGISTER_NAMES[r] ?? ''}`);
});
console.log('  R7 is &1C, but the MOS\'s MODE 7 table at &C4A5 says &1B. At &C95E it adds the *TV offset (0) with');
console.log('  ADC straight after CPY #&07, which leaves carry set: &1B + 0 + 1. The stub stores what was written.');
console.log(`  Video ULA control = &${hex8(m.videoUla.control)}. No palette writes at all: teletext colours don't use it (Part 5's MODE 4 does).`);
console.log(`  Latch = &${hex8(m.latch.value)} = ${m.latch.value.toString(2).padStart(8, '0')}: Shift Lock off, Caps Lock ON, C1 C0 = 10, autoscan on, speech idle, sound off.`);
console.log('  Caps Lock on is right: a BBC Micro starts in capitals. And screen memory:');
showMode7(m, 5);

// ── Part 5 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 5: change the links, and the MOS starts in another MODE ──');
console.log('  links  &028F  MODE  ULA ctrl  CRTC R0  R1   palette writes');
for (const links of [0xff, 0xfc, 0xfb, 0xf9, 0xf8]) {
  const x = machine();
  if (x === undefined) process.exit(0);
  x.keyboard.links = links;
  x.powerOn();
  for (let i = 0; i < BOOT_FRAMES; i++) x.runFrame();
  const palette = x.hardwareLog.recent().filter((w) => w.device === 'ulaPalette').length;
  console.log(`   &${hex8(links)}   &${hex8(x.peek(0x028f))}     ${String(x.peek(0x0355))}     &${hex8(x.videoUla.control)}      &${hex8(x.crtc.register(0))}    &${hex8(x.crtc.register(1))}   ${String(palette)}`);
}
console.log('  A closed link reads as a pressed key (PA7 = 1); the MOS inverts it, so it\'s a 0 in &028F.');
console.log('  Bits 0-2 are the links on columns 9, 8 and 7. R1 (characters shown) is &28 = 40 or &50 = 80.');

// ── Part 6 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 6: where it stalls now ──');
const s = machine();
if (s === undefined) process.exit(0);
const runner = new MosRunner(s);
s.powerOn();
runner.clear();
const result = runner.runUntilStall(MAX_CYCLES);
console.log(`  ${result.kind === 'stall' ? 'Stalled' : 'No stall'} after ${bbcTime(result.cycles)}. Last new code at ${bbcTime(runner.stall.lastNewCycle)}.`);
console.log(`  No CTRL+SHIFT wait this time: the keyboard says nothing is down. The banner is printed, and then`);
console.log(`  /IRQ is held by the ${s.irqHolders.join(', ')} while the MOS keeps asking the ACIA. The last 4 I/O accesses:`);
showIo(s, 4);
console.log('  The same storm as Stage 27\'s experiment: there is no ACIA, so its status read floats to &FE, bit 7 says');
console.log('  "it\'s me", and the System VIA is never asked. Stage 29\'s first job.');

s.reset();
for (let i = 0; i < 25; i++) s.runFrame();
console.log(`\n  Press BREAK: &028D = ${String(s.peek(0x028d))}, a soft BREAK. Stage 27 got 2 (CTRL+BREAK) because PA7 floated and CTRL read "down".`);
