// Stage 36 demo: modifiers, BREAK and the lock LEDs, headless.
//
//   npm run demo:break
//
// Part 1 is the LEDs at power-on, from the hardware log's IC32 writes.
// Part 2 is the lock keys: &025A and the LEDs after each press. Part 3 is
// what SHIFT, CTRL and CAPS LOCK do to the code a key makes (PRINT GET).
// Part 4 is BREAK, CTRL+BREAK and power-on side by side. Part 5 is the
// order you let go of CTRL and BREAK in.

import { BbcModelB } from '../src/machine/bbc-model-b';
import { tapKeys, typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex8 } from '../src/util/bits';
import { mode7StartAddress, mode7Text } from '../src/video/mode7-text';

const SHIFT = 0x00;
const CTRL = 0x01;
const CAPS_LOCK = 0x40;
const SHIFT_LOCK = 0x50;
const KEY_A = 0x41;
const KEYBOARD_STATUS = 0x025a;
const LAST_BREAK_TYPE = 0x028d;
const CYCLES_PER_MS = 2000;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function fresh(): BbcModelB {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map);
  const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
  if (!has('mos') || !has('basic')) {
    console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
    process.exit(0);
  }
  return m;
}

function booted(): BbcModelB {
  const m = fresh();
  m.powerOn();
  run(m, 50);
  return m;
}

function rows(m: BbcModelB): string[] {
  return mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13)))
    .map((row) => row.trimEnd())
    .filter((row) => row !== '');
}

/** The row before the last > : what BASIC printed last. */
function lastPrinted(m: BbcModelB): string {
  const r = rows(m);
  return (r[r.length - 2] ?? '').trim();
}

const led = (lit: boolean): string => (lit ? '●' : '○');
const leds = (m: BbcModelB): string => `CAPS ${led(m.capsLockLed)}  SHIFT ${led(m.shiftLockLed)}`;

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: the lock LEDs at power-on (IC32 bits 6 and 7, 0 = lit) ──');
const one = fresh();
one.hardwareLog.clear();
one.powerOn();
run(one, 50);
const ledWrites = one.hardwareLog.recent().filter((w) => w.device === 'latch' && w.register >= 6);
for (const w of ledWrites.slice(0, 6)) {
  const name = w.register === 6 ? 'CAPS LOCK ' : 'SHIFT LOCK';
  console.log(`  ${(w.cycles / CYCLES_PER_MS).toFixed(3).padStart(8)} ms  bit ${String(w.register)} := ${String(w.value)}  ${name} LED ${w.value === 0 ? 'on' : 'off'}`);
}
console.log(`  ... ${String(ledWrites.length - 6)} more (keyLeds at &EEEB is called again and again while starting up).`);
console.log('  The ~250 ms gap is the MOS clearing RAM. Then both LEDs are lit for ~12 ms: keyLeds ran while &025A was still &00.');

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: the lock keys are plain switches; the lock is a bit in &025A ──');
const two = booted();
console.log(`  ${'after'.padEnd(20)} &025A   LEDs`);
const show = (label: string): void => {
  console.log(`  ${label.padEnd(20)} &${hex8(two.peek(KEYBOARD_STATUS))}    ${leds(two)}`);
};
show('boot');
tapKeys(two, [CAPS_LOCK]);
show('CAPS LOCK');
tapKeys(two, [CAPS_LOCK]);
show('CAPS LOCK again');
tapKeys(two, [SHIFT_LOCK]);
show('SHIFT LOCK');
tapKeys(two, [SHIFT, CAPS_LOCK]);
show('SHIFT + CAPS LOCK');

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: what the modifiers do to the A key (BASIC: PRINT GET) ──');
const three = booted();
const code = (label: string, keys: readonly number[], capsOff = false): void => {
  typeText(three, 'PRINT GET\r');
  if (capsOff) tapKeys(three, [CAPS_LOCK]);
  tapKeys(three, keys);
  if (capsOff) tapKeys(three, [CAPS_LOCK]);
  run(three, 5);
  const n = Number(lastPrinted(three));
  const shown = n >= 32 ? `"${String.fromCharCode(n)}"` : 'control';
  console.log(`  ${label.padEnd(36)} ${String(n).padStart(3)}  ${shown}`);
};
code('A                 (CAPS LOCK on)', [KEY_A]);
code('SHIFT + A         (CAPS LOCK on)', [SHIFT, KEY_A]);
code('CTRL + A', [CTRL, KEY_A]);
code('A                 (CAPS LOCK off)', [KEY_A], true);
code('SHIFT + A         (CAPS LOCK off)', [SHIFT, KEY_A], true);
tapKeys(three, [SHIFT, CAPS_LOCK]);
code('SHIFT + A    (SHIFT+CAPS LOCK mode)', [SHIFT, KEY_A]);

// ── Part 4 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 4: three kinds of reset, one /RES pin ──');
console.log(`  ${'reset'.padEnd(12)} ${'banner'.padEnd(18)} &028D  TIME after  OLD + LIST`);
for (const kind of ['BREAK', 'CTRL+BREAK', 'power-on'] as const) {
  const m = booted();
  typeText(m, '10PRINT "HI"\r');
  run(m, 100);
  if (kind === 'power-on') {
    m.powerOn();
    run(m, 50);
  } else {
    if (kind === 'CTRL+BREAK') m.keyboard.press(CTRL);
    m.setBreak(true);
    run(m, 2);
    m.setBreak(false);
    run(m, 50);
    m.keyboard.release(CTRL);
  }
  const banner = rows(m)[0] ?? '';
  const breakType = m.peek(LAST_BREAK_TYPE);
  typeText(m, 'PRINT TIME\r');
  run(m, 3);
  const time = lastPrinted(m);
  typeText(m, 'OLD\rLIST\r');
  run(m, 5);
  const listed = rows(m).some((row) => row.includes('10PRINT "HI"')) ? 'program back' : lastPrinted(m);
  console.log(`  ${kind.padEnd(12)} ${banner.padEnd(18)} ${String(breakType).padStart(5)}  ${time.padStart(10)}  ${listed}`);
}
console.log('  TIME had reached ~400 before each reset. Only power-on clears RAM (&D9DC); only a soft BREAK keeps TIME.');

// ── Part 5 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 5: the MOS reads CTRL after BREAK comes up ──');
for (const ctrlFirst of [false, true]) {
  const m = booted();
  m.keyboard.press(CTRL);
  m.setBreak(true);
  run(m, 2);
  if (ctrlFirst) m.keyboard.release(CTRL);
  run(m, 2);
  m.setBreak(false);
  run(m, 50);
  m.keyboard.release(CTRL);
  const order = ctrlFirst ? 'CTRL up, then BREAK up' : 'BREAK up, then CTRL up';
  const breakType = m.peek(LAST_BREAK_TYPE);
  console.log(`  ${order}:  &028D = ${String(breakType)} (${breakType === 2 ? 'hard' : 'soft'})`);
}
