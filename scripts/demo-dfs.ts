// Stage 50 demo: DFS 0.98 reads a disc, one NMI per byte.
//
//   npm run demo:dfs                     the Stage 48 test disc
//   npm run demo:dfs -- discs/game.ssd   your own (.ssd or .dsd, drive 0)
//
// Boots MOS 1.20 + BASIC II + DFS 0.98 with the disc in drive 0, types *CAT,
// and shows: the screen, what the DFS asked the 8271 for, and a timeline of
// the read, measured from the machine: the seek, the wait for the sector to
// come round, the bytes, and how much of the CPU's time the NMI handler at
// &0D00 took while they came.

import { readFileSync } from 'node:fs';
import { CYCLES_PER_BYTE } from '../src/devices/disc-drive';
import { describeFdcEntry } from '../src/devices/fdc-log';
import { FDC_STATUS_COMMAND_BUSY } from '../src/devices/fdc8271';
import { openDfsDisc } from '../src/disc/dfs-disc';
import { formatFromName } from '../src/disc/disc-image';
import { buildTestDisc } from '../src/disc/test-disc';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { mode7StartAddress, mode7Text } from '../src/video/mode7-text';

/** DFS 0.98 copies its NMI handler here (the MOS's NMI vector points at &0D00). */
const NMI_AREA_START = 0x0d00;
const NMI_AREA_END = 0x0d4f;
const CPU_HZ = 2_000_000;

const ms = (cycles: number): string => `${(cycles / (CPU_HZ / 1000)).toFixed(1)} ms`;

const m = new BbcModelB();
const report = loadStandardRoms(m.map);
const missing = report.missing.map((r) => r.file);
if (missing.length > 0) {
  console.log(`Missing ${missing.join(', ')} in roms/ (Acorn copyright, so you supply them). Nothing to show without them.`);
  process.exit(0);
}

const path: string | undefined = process.argv.length > 2 ? process.argv[2] : undefined;
const name = path ?? 'stage48.ssd (built by our own writer)';
const format = path === undefined ? 'ssd' : formatFromName(path);
if (format === undefined) {
  console.log(`${String(path)}: the name must end .ssd or .dsd`);
  process.exit(1);
}
const bytes = path === undefined ? buildTestDisc() : new Uint8Array(readFileSync(path));
m.insertDisc(0, openDfsDisc(bytes, format, name));
m.powerOn();
for (let i = 0; i < 100; i++) m.runFrame();

console.log(`Drive 0: ${name}. Typing *CAT...\n`);
const logFrom = m.fdcLog.count;
typeText(m, '*CAT\r');

// Step by hand from here, to time the read and count the handler's cycles.
const start = m.cycles;
let readStarted: number | undefined;
let firstByte: number | undefined;
let lastByte = 0;
let readEnded: number | undefined;
let nmis = 0;
let handlerCycles = 0;
let bytesBefore = m.fdc.bytesTransferred;
while (m.cycles - start < 3 * CPU_HZ) {
  const pc = m.registers.pc;
  const nmi = m.pendingInterrupt === 'nmi';
  const wasBusy = (m.fdc.status & FDC_STATUS_COMMAND_BUSY) !== 0;
  const cycles = m.step();
  if (nmi) {
    nmis++;
    handlerCycles += cycles;
  } else if (pc >= NMI_AREA_START && pc <= NMI_AREA_END) {
    handlerCycles += cycles;
  }
  // Read Data's command byte (&53) going into &FE80 starts the clock.
  if (readStarted === undefined && m.fdc.command === 0x53 && (m.fdc.status & FDC_STATUS_COMMAND_BUSY) !== 0) readStarted = m.cycles;
  if (m.fdc.bytesTransferred !== bytesBefore) {
    bytesBefore = m.fdc.bytesTransferred;
    firstByte ??= m.cycles;
    lastByte = m.cycles;
  }
  if (readStarted !== undefined && readEnded === undefined && wasBusy && (m.fdc.status & FDC_STATUS_COMMAND_BUSY) === 0) readEnded = m.cycles;
}

const rows = mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13)));
const last = rows.reduce((at, r, i) => (r.trim() === '' ? at : i), 0);
console.log('  ┌' + '─'.repeat(40) + '┐');
for (const r of rows.slice(0, last + 1)) console.log(`  │${r.padEnd(40)}│`);
console.log('  └' + '─'.repeat(40) + '┘\n');

console.log('What the DFS asked the 8271 for:');
for (const e of m.fdcLog.recent().slice(-(m.fdcLog.count - logFrom))) {
  const d = describeFdcEntry(e);
  console.log(`  ${d.bytes.padEnd(15)} ${d.text}${e.repeats > 1 ? `  ×${String(e.repeats)}` : ''}`);
}

const transferred = m.fdc.bytesTransferred;
console.log(`\nThe read, measured (one byte every ${String(CYCLES_PER_BYTE)} cycles = 64 µs):`);
if (readStarted !== undefined && firstByte !== undefined) {
  const window = lastByte - firstByte;
  console.log(`  Read Data sent → first byte:   ${ms(firstByte - readStarted)}  (waiting for sector 0 to come round)`);
  console.log(`  first byte → last byte:        ${ms(window)}  (${String(transferred)} bytes)`);
  if (readEnded !== undefined) console.log(`  last byte → result &00 + INT:  ${ms(readEnded - lastByte)}  (the CRC)`);
  console.log(`  NMIs taken:                    ${String(nmis)}  (one per byte, and one more at the end)`);
  console.log(`  cycles in the NMI handler:     ${handlerCycles.toLocaleString('en-GB')}, about ${String(Math.round(handlerCycles / nmis))} per NMI`);
  console.log(`  so while the bytes came, the CPU spent ${String(Math.round((100 * handlerCycles) / window))}% of its time in &0D00.`);
  console.log(`  late bytes: ${String(m.fdc.lateBytes)}`);
} else {
  console.log('  No Read Data seen: is the disc an Acorn DFS disc?');
}
