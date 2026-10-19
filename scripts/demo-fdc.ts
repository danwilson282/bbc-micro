// Stage 49 demo: the commands DFS 0.98 sends the 8271.
//
//   npm run demo:fdc
//
// Part 1: our own handshake, byte by byte, with the status register after
// each write (no ROMs needed).
// Part 2: power-on with the DFS fitted: the four commands that set the chip up.
// Part 3: *CAT. With no disc in drive 0, RDY0 never comes up, and the DFS polls.
// Part 4: Escape. The DFS resets the 8271 through &FE82 and sets it up again.

import { describeFdcEntry, type FdcLogEntry } from '../src/devices/fdc-log';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { tapKeys, typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex8 } from '../src/util/bits';
import { mode7StartAddress, mode7Text } from '../src/video/mode7-text';
import { formatSeconds } from '../src/web/workbench/fdc-view-model';

const ESCAPE = 0x70;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function printEntries(entries: readonly FdcLogEntry[]): void {
  for (const e of entries) {
    const d = describeFdcEntry(e);
    const times = e.repeats > 1 ? `  ×${e.repeats.toLocaleString('en-GB')}` : '';
    console.log(`  ${formatSeconds(e.cycles).padStart(9)}  ${d.bytes.padEnd(15)} ${d.drive.padEnd(5)} ${d.text}${times}`);
  }
}

function printScreen(m: BbcModelB): void {
  const rows = mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13)));
  const last = rows.reduce((at, r, i) => (r.trim() === '' ? at : i), 0);
  console.log('  ┌' + '─'.repeat(40) + '┐');
  for (const r of rows.slice(0, last + 1)) console.log(`  │${r.padEnd(40)}│`);
  console.log('  └' + '─'.repeat(40) + '┘');
}

// ── Part 1 ────────────────────────────────────────────────────────────────

console.log('Part 1: the handshake by hand (no ROMs). Status after each step:');
const bare = new BbcModelB();
bare.powerOn();
const step = (what: string, act: () => number | undefined): void => {
  const got = act();
  const value = got === undefined ? '' : ` → &${hex8(got)}`;
  console.log(`  ${what.padEnd(46)}${value.padEnd(7)} status &${hex8(bare.fdc.status)}`);
};
step('write &FE80 ← &7A  (Write Special Register)', () => (bare.map.write(0xfe80, 0x7a), undefined));
step('write &FE81 ← &17  (register: mode)', () => (bare.map.write(0xfe81, 0x17), undefined));
step('write &FE81 ← &C1  (value: non-DMA)', () => (bare.map.write(0xfe81, 0xc1), undefined));
step('write &FE80 ← &6C  (Read Drive Status)', () => (bare.map.write(0xfe80, 0x6c), undefined));
step('read  &FE81        (the result)', () => bare.map.read(0xfe81));
step('write &FE80 ← &69  (Seek, drive 0)', () => (bare.map.write(0xfe80, 0x69), undefined));
step('write &FE81 ← &05  (track 5)', () => (bare.map.write(0xfe81, 0x05), undefined));
step('read  &FE81        (the result)', () => bare.map.read(0xfe81));
console.log('  &80 = busy; &10 = result waiting; &18 = result waiting + interrupt; &10 from Seek = drive not ready.');

// ── Parts 2-4 ─────────────────────────────────────────────────────────────

const m = new BbcModelB();
const report = loadStandardRoms(m.map);
const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
if (!has('mos') || !has('basic') || !has('dfs')) {
  console.log('\n  Parts 2-4 skipped: roms/os12.rom, roms/basic2.rom and roms/dfs.rom (an 8271 DFS) are needed.');
  process.exit(0);
}

console.log('\nPart 2: power-on with the DFS in slot 14. What it told the 8271:');
m.powerOn();
run(m, 100);
printEntries(m.fdcLog.recent());
printScreen(m);

console.log('\nPart 3: *CAT, then 2 seconds. No disc in drive 0, so RDY0 (bit 2 of Read Drive Status) never comes up:');
const before = m.fdcLog.count;
typeText(m, '*CAT\r');
run(m, 100);
printEntries(m.fdcLog.recent().filter((e) => e.index > before));
printScreen(m);

console.log('\nPart 4: Escape. The DFS gives up: resets the 8271 through &FE82, sets it up again, and says so:');
const beforeEscape = m.fdcLog.count;
tapKeys(m, [ESCAPE]);
run(m, 20);
printEntries(m.fdcLog.recent().filter((e) => e.index >= beforeEscape));
printScreen(m);
