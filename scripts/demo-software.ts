// Stage 51 demo: software from disc.
//
//   npm run demo:software
//
// 1. Tokenises a line of BASIC the way BASIC II does, and shows the bytes.
// 2. Writes the demo disc to out/demo51.ssd (drop it on the browser too).
// 3. Boots MOS 1.20 + BASIC II + DFS 0.98 with it, and runs *RUN HELLO and
//    CHAIN "GREET".
// 4. SHIFT-BREAKs it: !BOOT → CHAIN "DEMO" → MODE 2.
// 5. SAVEs a program to a blank disc, and shows what the DFS asked the 8271
//    to write.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tokeniseLine } from '../src/basic/tokenise';
import { describeFdcEntry } from '../src/devices/fdc-log';
import { buildBlankDisc, buildDemoDisc } from '../src/disc/demo-disc';
import { readCatalogue } from '../src/disc/dfs-disc';
import { catLines, infoLine } from '../src/disc/dfs-text';
import { DiscImage } from '../src/disc/disc-image';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { shiftBreak } from '../src/machine/shift-break';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { mode7StartAddress, mode7Text } from '../src/video/mode7-text';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const run = (m: BbcModelB, frames: number): void => {
  for (let i = 0; i < frames; i++) m.runFrame();
};

console.log('1. A line of BASIC, tokenised as BASIC II keeps it at PAGE:\n');
for (const line of ['10 PRINT "HI"', '20 GOTO 10', '30 X=TOP:TIME=0:A=TIME']) {
  console.log(`   ${line.padEnd(24)} ${hex(tokeniseLine(line))}`);
}
console.log('   (&0D, line number high then low, length, then the text: PRINT &F1, GOTO &E5 + line 10 as 8D 54 4A 40,');
console.log('    TO &B8 + "P" for TOP, TIME &D1 when assigned to and &91 when read)\n');

const demoBytes = buildDemoDisc();
mkdirSync('out', { recursive: true });
writeFileSync('out/demo51.ssd', demoBytes);
const demo = DiscImage.fromBytes(demoBytes, 'ssd', 'demo51.ssd');
console.log('2. The demo disc, written to out/demo51.ssd:\n');
const cat = readCatalogue(demo, 0);
for (const l of catLines(cat, 0)) console.log(`   ${l}`);
console.log('');
for (const f of cat.files) console.log(`   ${infoLine(f)}`);

const m = new BbcModelB();
const report = loadStandardRoms(m.map);
const missing = report.missing.map((r) => r.file);
if (missing.length > 0) {
  console.log(`\nMissing ${missing.join(', ')} in roms/ (Acorn copyright, so you supply them). Steps 3-5 need them.`);
  process.exit(0);
}

const screen = (machine: BbcModelB = m): string[] =>
  mode7Text((a) => machine.peek(a), mode7StartAddress(machine.crtc.register(12), machine.crtc.register(13))).map((r) => r.trimEnd());
const lastRows = (n: number): string[] => {
  const rows = screen();
  const end = rows.reduce((at, r, i) => (r === '' ? at : i), 0);
  return rows.slice(Math.max(0, end - n + 1), end + 1);
};

m.insertDisc(0, demo);
m.powerOn();
run(m, 100);
console.log('\n3. Booted with the disc in drive 0. Typing *RUN HELLO and CHAIN "GREET":\n');
typeText(m, '*RUN HELLO\r');
run(m, 30);
typeText(m, 'CHAIN "GREET"\r');
run(m, 50);
for (const r of lastRows(9)) console.log(`   │${r.padEnd(40)}│`);

console.log('\n4. SHIFT-BREAK. The DFS reads the catalogue, sees boot option 3 and *EXECs !BOOT:');
const from = m.fdcLog.count;
shiftBreak(m);
run(m, 150);
for (const e of m.fdcLog.recent().slice(-(m.fdcLog.count - from))) {
  const d = describeFdcEntry(e);
  if (d.bytes.startsWith('53')) console.log(`   ${d.bytes.padEnd(13)} ${d.text}`);
}
const control = m.videoUla.control & 0xfe;
console.log(`   Video ULA control now &${control.toString(16).toUpperCase()}: ${control === 0xf4 ? 'MODE 2. DEMO is running' : 'not MODE 2?'}`);
const p1 = m.videoUla.paletteEntry(1);
run(m, 25);
console.log(`   logical colour 1's palette entry: &${p1.toString(16).toUpperCase()}, half a second later &${m.videoUla.paletteEntry(1).toString(16).toUpperCase()} (the colours turn)`);

console.log('\n5. SAVE to a blank disc:\n');
const blank = DiscImage.fromBytes(buildBlankDisc(), 'ssd', 'blank.ssd');
const s = new BbcModelB();
loadStandardRoms(s.map);
s.insertDisc(0, blank);
s.powerOn();
run(s, 100);
typeText(s, '10 PRINT "SAVED AND LOADED"\r');
const saveFrom = s.fdcLog.count;
typeText(s, 'SAVE "PROG"\r');
run(s, 100);
for (const e of s.fdcLog.recent().slice(-(s.fdcLog.count - saveFrom))) {
  const d = describeFdcEntry(e);
  if (!d.bytes.startsWith('6C') && !d.bytes.startsWith('3A')) console.log(`   ${d.bytes.padEnd(13)} ${d.text}`);
}
console.log(`   ${String(blank.changes)} bytes written, by ${String(s.fdc.bytesTransferred)} NMIs in all (reads too), ${String(s.fdc.lateBytes)} late.\n`);
const after = readCatalogue(blank, 0);
for (const l of catLines(after, 0)) console.log(`   ${l}`);
for (const f of after.files) console.log(`   ${infoLine(f)}`);
typeText(s, 'NEW\rCHAIN "PROG"\r');
run(s, 50);
console.log('\n   NEW, then CHAIN "PROG":');
for (const r of screen(s).filter((r) => r !== '').slice(-3)) console.log(`   │${r.padEnd(40)}│`);
