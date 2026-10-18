// Stage 45 demo: the SN76489's generators, written to WAV files you can play.
//
//   npm run demo:sound
//
// Part 1 needs no ROMs: it drives the chip directly with register bytes and
// records a tour (a scale, the attenuation steps, white and periodic noise,
// and the NF = 3 bass trick) to out/sound-tour.wav.
// Part 2 boots MOS 1.20 + BASIC and records what the machine itself plays:
// the start-up bleep, then a few SOUND commands, to out/sound-basic.wav.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SN_CPU_CYCLES_PER_TICK, SN_TICK_RATE_HZ, Sn76489, describeSoundByte, toneFrequency } from '../src/devices/sn76489';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { BoxResampler, DEFAULT_SAMPLE_RATE } from '../src/sound/resampler';
import { SampleRecorder } from '../src/sound/sample-recorder';
import { encodeWav } from '../src/sound/wav';
import { hex8 } from '../src/util/bits';

const OUT_DIR = 'out';
const CPU_HZ = SN_TICK_RATE_HZ * SN_CPU_CYCLES_PER_TICK;

function save(name: string, rec: SampleRecorder): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, encodeWav(rec.samples, DEFAULT_SAMPLE_RATE));
  const seconds = rec.samples.length / DEFAULT_SAMPLE_RATE;
  console.log(`  → wrote ${path}: ${seconds.toFixed(2)} s, ${String(rec.samples.length)} samples at ${String(DEFAULT_SAMPLE_RATE)} Hz${rec.dropped > 0 ? ` (${String(rec.dropped)} dropped)` : ''}`);
}

/** Latch + data bytes for a 10-bit tone N on chip channel 0-2. */
function toneBytes(channel: number, n: number): number[] {
  return [0x80 | (channel << 5) | (n & 0x0f), (n >> 4) & 0x3f];
}

/** Latch byte for channel 0-3's attenuation. */
const att = (channel: number, a: number): number => 0x90 | (channel << 5) | (a & 0x0f);

// ── Part 1: the chip on its own ──────────────────────────────────────────

console.log('Part 1: the chip on its own (no ROMs needed).\n');
const sn = new Sn76489();
sn.powerOn();
const tour = new SampleRecorder(DEFAULT_SAMPLE_RATE * 20);
sn.connectOutput(new BoxResampler(tour));
let clock = 0;

function play(label: string, bytes: readonly number[], seconds: number): void {
  let latched = sn.latched;
  const decoded = bytes.map((b) => {
    const d = `&${hex8(b)} ${describeSoundByte(b, latched)}`;
    sn.write(b);
    latched = sn.latched;
    return d;
  });
  console.log(`  ${clock.toFixed(2).padStart(5)} s  ${label}`);
  for (const d of decoded) console.log(`             ${d}`);
  sn.tick(Math.round(seconds * CPU_HZ));
  clock += seconds;
}

// A C major scale on channel 0: N = 4,000,000 / (32 × f), rounded.
const SCALE: readonly [string, number][] = [
  ['C4', 261.63], ['D4', 293.66], ['E4', 329.63], ['F4', 349.23],
  ['G4', 392.0], ['A4', 440.0], ['B4', 493.88], ['C5', 523.25],
];
play('channel 0 to attenuation &0 (loudest)', [att(0, 0)], 0);
for (const [name, hz] of SCALE) {
  const n = Math.round(4_000_000 / (32 * hz));
  play(`${name}: N = &${n.toString(16).toUpperCase().padStart(3, '0')} (${String(n)}) → ${toneFrequency(n).toFixed(2)} Hz (wanted ${hz.toFixed(2)})`, toneBytes(0, n), 0.3);
}

console.log('\n  The attenuation steps on A4 (2 dB each, &F off):');
play('A4', toneBytes(0, 284), 0);
for (let a = 0; a <= 15; a++) {
  console.log(`  ${clock.toFixed(2).padStart(5)} s  attenuation &${a.toString(16).toUpperCase()}: ${a === 0 ? '0 dB' : a === 15 ? 'off' : `-${String(2 * a)} dB`}`);
  sn.write(att(0, a));
  sn.tick(Math.round(0.15 * CPU_HZ));
  clock += 0.15;
}

console.log('\n  Noise on channel 3:');
play('channel 3 to attenuation &0', [att(3, 0)], 0);
play('white noise, NF = 0 (shifts at 7,812.5 Hz)', [0xe4], 0.6);
play('white noise, NF = 1 (3,906.25 Hz)', [0xe5], 0.6);
play('white noise, NF = 2 (1,953.125 Hz)', [0xe6], 0.6);
play('periodic noise, NF = 0: a 1-in-15 pulse at 7,812.5 ÷ 15 = 520.8 Hz', [0xe0], 0.6);
play('periodic noise, NF = 2: 1,953.125 ÷ 15 = 130.2 Hz', [0xe2], 0.6);

console.log('\n  The bass trick: periodic noise clocked by channel 2 (silent), 15× lower than its tone:');
play('channel 2 silent but counting', [att(2, 15)], 0);
for (const n of [0x0d5, 0x0be, 0x0a9, 0x08e]) {
  const hz = toneFrequency(n) / 15;
  play(`channel 2 N = &${n.toString(16).toUpperCase().padStart(3, '0')}, noise R6 = 3 (periodic, follows channel 2) → ${hz.toFixed(1)} Hz`, [...toneBytes(2, n), 0xe3], 0.5);
}
play('everything off', [att(0, 15), att(1, 15), att(2, 15), att(3, 15)], 0.3);
save('sound-tour.wav', tour);

// ── Part 2: the machine playing itself ───────────────────────────────────

console.log('\nPart 2: MOS 1.20 and BASIC, playing through the emulated machine.\n');
const m = new BbcModelB();
const report = loadStandardRoms(m.map);
const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
if (!has('mos') || !has('basic')) {
  console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
  process.exit(0);
}
const basic = new SampleRecorder(DEFAULT_SAMPLE_RATE * 30);
m.sound.connectOutput(new BoxResampler(basic));
const seconds = (): string => `${(m.cycles / CPU_HZ).toFixed(2).padStart(5)} s`;
const runFrames = (n: number): void => {
  for (let i = 0; i < n; i++) m.runFrame();
};

m.powerOn();
console.log(`  ${seconds()}  power on: the MOS silences the chip, then bleeps (523 Hz, about 0.28 s)`);
runFrames(100);
const COMMANDS = [
  'FOR P=53 TO 117 STEP 4:SOUND 1,-15,P,3:NEXT',
  'SOUND 1,-10,89,10:SOUND 2,-10,105,10:SOUND 3,-10,117,10',
  'SOUND 0,-15,6,15',
  'SOUND 0,-15,4,15',
];
for (const c of COMMANDS) {
  console.log(`  ${seconds()}  typing ${c}`);
  typeText(m, `${c}\r`);
  runFrames(75);
}
save('sound-basic.wav', basic);
console.log('\nOpen the files in any audio player (macOS: afplay out/sound-tour.wav).');
