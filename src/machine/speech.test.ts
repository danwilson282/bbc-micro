// Superior Software's Speech! (1985) talks through the SN76489 with no speech
// chip: channels 0 and 1 at N = 1 (held high), and their attenuation written
// as a pair about 9,000 times a second, a 4-bit DAC. Until the N = 1 fix it
// came out at RMS 0.002: a 125 kHz square wave averages to nothing.
//
// Needs the three ROMs and the user's own discs/Speech.ssd (not in the repo:
// it's commercial software). Skips, naming what's missing, without them.

import { existsSync, readFileSync } from 'node:fs';
import { openDfsDisc } from '../disc/dfs-disc';
import { loadStandardRoms } from '../memory/rom-files';
import { BoxResampler } from '../sound/resampler';
import { SampleRecorder } from '../sound/sample-recorder';
import { BbcModelB } from './bbc-model-b';
import { shiftBreak } from './shift-break';
import { typeText } from './type-text';

const NEEDS = ['roms/os12.rom', 'roms/basic2.rom', 'roms/dfs.rom', 'discs/Speech.ssd'] as const;
const missing = NEEDS.filter((p) => !existsSync(p));
const withSpeech = missing.length === 0 ? test : test.skip;
if (missing.length > 0) console.log(`skipping Speech! test: ${missing.join(', ')} missing (you supply ROMs and discs)`);

const RATE = 44_100;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

/** The RMS of the loudest half second, after taking out a 10 ms moving mean (the offset), so only the waveform counts. */
function speechRms(s: Float32Array): number {
  const w = RATE / 100;
  const ac = new Float64Array(s.length);
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i];
    if (i >= w) sum -= s[i - w];
    ac[i] = s[i] - sum / Math.min(i + 1, w);
  }
  const half = RATE / 2;
  let best = 0;
  for (let i = 0; i + half <= ac.length; i += RATE / 20) {
    let e = 0;
    for (let j = i; j < i + half; j++) e += ac[j] * ac[j];
    best = Math.max(best, e);
  }
  return Math.sqrt(best / half);
}

withSpeech('*SAY HELLO is heard: channels 0 and 1 at N = 1, and the attenuation pairs make a waveform 30 times louder than before the fix', () => {
  const m = new BbcModelB();
  loadStandardRoms(m.map);
  m.insertDisc(0, openDfsDisc(new Uint8Array(readFileSync('discs/Speech.ssd')), 'ssd', 'Speech.ssd'));
  m.powerOn();
  run(m, 100);
  shiftBreak(m);
  run(m, 500);
  typeText(m, '1'); // the menu: *RUN SPEECH
  run(m, 300);
  typeText(m, '*SAY HELLO');
  const rec = new SampleRecorder(RATE * 4);
  m.sound.connectOutput(new BoxResampler(rec, RATE));
  typeText(m, '\r');
  run(m, 150);
  // Before the fix: 0.0022. After: 0.077.
  expect(speechRms(rec.samples)).toBeGreaterThan(0.05);
});
