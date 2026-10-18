// Stage 44 demo: the SN76489's register protocol, as the MOS uses it.
//
//   npm run demo:sound-regs
//
// Part 1: the bytes the MOS sends at power-on (silence, known tones, the
// start-up bleep), caught as IC32 bit 0 falls, each decoded.
// Part 2: SOUND 1,-15,53,20 and SOUND 0,-15,6,5 typed into BASIC: their
// bytes, and the register file afterwards.

import { chipChannelForSound, describeAttenuation, describeNoise, describeSoundByte, toneFrequency } from '../src/devices/sn76489';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex8 } from '../src/util/bits';

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

/** The sound bytes in the hardware log since it was last cleared, decoded. */
function printBytes(m: BbcModelB): void {
  for (const w of m.hardwareLog.recent().filter((e) => e.device === 'sound')) {
    console.log(`  cycle ${String(w.cycles).padStart(9)}  &${hex8(w.value)}  ${describeSoundByte(w.value, w.register)}`);
  }
}

function printRegisters(m: BbcModelB): void {
  for (let c = 0; c < 3; c++) {
    const n = m.sound.tone(c);
    const basic = [0, 1, 2, 3].find((b) => chipChannelForSound(b) === c) ?? 0;
    console.log(
      `  chip channel ${String(c)} (SOUND ${String(basic)}): tone &${n.toString(16).toUpperCase().padStart(3, '0')} = ${(n === 0 ? 0 : toneFrequency(n)).toFixed(1)} Hz, attenuation ${describeAttenuation(m.sound.attenuation(c))}`,
    );
  }
  console.log(`  chip channel 3 (SOUND 0): noise ${describeNoise(m.sound.noise)}, attenuation ${describeAttenuation(m.sound.attenuation(3))}`);
}

const m = new BbcModelB();
const report = loadStandardRoms(m.map);
const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
if (!has('mos') || !has('basic')) {
  console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
  process.exit(0);
}

console.log('Part 1: power-on. The chip has no reset pin, so the MOS silences it itself (via &EB21):');
m.powerOn();
run(m, 100);
printBytes(m);

console.log('\nPart 2: SOUND 1,-15,53,20 (BASIC channel 1 is chip channel 2):');
m.hardwareLog.clear();
typeText(m, 'SOUND 1,-15,53,20\r');
run(m, 5);
printBytes(m);
console.log('  N = (&1D << 4) | &5 = &1D5 = 469;  4,000,000 / (32 × 469) = 266.5 Hz');

console.log('\nSOUND 0,-15,6,5 (noise is chip channel 3):');
m.hardwareLog.clear();
typeText(m, 'SOUND 0,-15,6,5\r');
run(m, 2);
printBytes(m);

console.log('\nThe register file now:');
printRegisters(m);
