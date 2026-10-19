// Stage 35 demo: the keyboard interrupts, the MOS scans, BASIC hears you.
//
//   npm run demo:typing
//
// Part 1 types PRINT 2+2 into BASIC, headless. Part 2 is one key press as a
// timeline: CA2, the IRQ, the MOS switching the CA2 interrupt off, its
// 100 Hz scans, and CA2 back on after you let go. Part 3 is one of those
// scans, write by write: the column test on CA2, then the rows on PA7.

import { BbcModelB, CYCLES_PER_FRAME } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex8 } from '../src/util/bits';
import { formatMode7Text, mode7StartAddress, mode7Text } from '../src/video/mode7-text';

const CYCLES_PER_MS = 2000;
const BOOT_FRAMES = 50;
const SYSTEM_VIA_IFR = 0xfe4d;
const SYSTEM_VIA_IER = 0xfe4e;
const SYSTEM_VIA_ORA = 0xfe4f; // port A, no handshake
const KEY_A = 0x41;

function booted(): BbcModelB {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map, ['mos', 'basic']);
  const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
  if (!has('mos') || !has('basic')) {
    console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
    process.exit(0);
  }
  m.powerOn();
  for (let i = 0; i < BOOT_FRAMES; i++) m.runFrame();
  return m;
}

function screen(m: BbcModelB): string[] {
  return mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13)));
}

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: typing into BASIC ──');
const one = booted();
const started = one.cycles;
typeText(one, 'PRINT 2+2\r');
for (let i = 0; i < 10; i++) one.runFrame();
console.log(`  typeText(machine, "PRINT 2+2\\r"): 10 characters, each held 2 frames and let go 2 (${((one.cycles - started) / CYCLES_PER_MS).toFixed(0)} ms of BBC time).`);
console.log('  "+" is SHIFT (&00) with ; (&57), the BBC\'s own keytop. MODE 7 screen memory now reads:\n');
const rows = screen(one);
for (const line of formatMode7Text(rows.slice(0, 9))) console.log(`  ${line}`);
console.log('\n  🎉 BASIC heard every key.');

// ── Part 2 ─────────────────────────────────────────────────────────────────

// MOS 1.20 addresses, from its disassembly (see the Stage 35 doc).
const KEYV_ENTRY = 0xef02; // defaultKEY
const FULL_SCAN = 0xf0e1; // LDX #&09: the column loop starts
const COLUMN_TEST = 0xf0fd; // BIT &FE4D: did CA2 rise for this column?
const ROW_TEST = 0xf10b; // BIT &FE4F: is this one key down (PA7)?
const SCAN_DONE = [0xf126, 0xf127]; // out of the loop: nothing new / found one

console.log('\n── Part 2: one key press, as the hardware and the MOS see it ──');
const two = booted();
const pressedAt = two.cycles;
const ms = (cycles: number): string => `${((cycles - pressedAt) / CYCLES_PER_MS).toFixed(3).padStart(7)} ms`;
const echoAt = mode7StartAddress(two.crtc.register(12), two.crtc.register(13)) + 5 * 40 + 1; // after the > prompt
console.log(`  ${ms(pressedAt)}  A (&${hex8(KEY_A)}) goes down. IER = &${hex8(two.peek(SYSTEM_VIA_IER))}: bit 0 set, so a CA2 rising edge will interrupt.`);
two.keyboard.press(KEY_A);
const releaseAt = pressedAt + 3 * CYCLES_PER_FRAME;
const endAt = releaseAt + 3 * CYCLES_PER_FRAME;
let released = false;
let firstRise = true;
let echoed = false;
let fromCa2 = false;
let keyvAt = 0;
let columnsTested = 0;
let found = '';
let ierOff = false;
while (two.cycles < endAt) {
  if (!released && two.cycles >= releaseAt) {
    two.keyboard.release(KEY_A);
    released = true;
    console.log(`  ${ms(two.cycles)}  A is let go.`);
  }
  const ifr = two.peek(SYSTEM_VIA_IFR);
  const ier = two.peek(SYSTEM_VIA_IER);
  if (two.pendingInterrupt === 'irq' && (ifr & ier & 0x01) === 1) {
    fromCa2 = true;
    console.log(`  ${ms(two.cycles)}  /IRQ: IFR bit 0 AND IER bit 0. The CPU takes the interrupt.`);
  }
  const pc = two.registers.pc;
  if (pc === KEYV_ENTRY) {
    keyvAt = two.cycles;
    columnsTested = 0;
    found = '';
    ierOff = false;
  }
  if (pc === COLUMN_TEST && (ifr & 0x01) === 1) found = `CA2 says column ${String(two.peek(SYSTEM_VIA_ORA) & 0x0f)}`;
  if (pc === COLUMN_TEST) columnsTested++;
  if (pc === ROW_TEST && (two.peek(SYSTEM_VIA_ORA) & 0x80) !== 0) found += `, PA7 says key &${hex8(two.peek(SYSTEM_VIA_ORA) & 0x7f)}`;
  if (SCAN_DONE.includes(pc) && keyvAt !== 0) {
    const why = fromCa2 ? 'KEYV, from the CA2 interrupt' : 'KEYV, from the 100 Hz timer ';
    const off = ierOff ? 'IER := &01 (CA2 interrupt off), ' : '';
    console.log(`  ${ms(keyvAt)}  ${why}: ${off}${String(columnsTested)} columns tested${found === '' ? ', no key' : `: ${found}`}`);
    keyvAt = 0;
    fromCa2 = false;
  }
  const rises = two.keyboard.ca2Rises;
  two.writes.clear();
  two.step();
  if (firstRise && two.keyboard.ca2Rises > rises) {
    firstRise = false;
    console.log(`  ${ms(two.cycles)}  CA2 rises: the counter reached column 1, where row 4 is down. IFR bit 0 is set.`);
  }
  for (const w of two.writes.recorded()) {
    if (w.address === SYSTEM_VIA_IER && w.value === 0x01 && keyvAt !== 0) ierOff = true;
    if (w.address === SYSTEM_VIA_IER && w.value === 0x81) console.log(`  ${ms(two.cycles)}  IER := &81: CA2 interrupt ON again. Nothing is down: back to waiting.`);
  }
  if (!echoed && two.peek(echoAt) === KEY_A) {
    echoed = true;
    console.log(`  ${ms(two.cycles)}  "A" appears after the > on the screen: BASIC read it from the buffer and echoed it.`);
  }
}
console.log(`  CA2 rose ${two.keyboard.ca2Rises.toLocaleString('en-GB')} times while A was down (once every 16 µs), but interrupted once:`);
console.log('  the MOS switched the CA2 interrupt off at once, scanned every 10 ms, and switched it on when it found nothing.');

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: the full scan, test by test (A held) ──');
const three = booted();
three.keyboard.press(KEY_A);
const lines: string[] = [];
let inScan = false;
for (;;) {
  const pc = three.registers.pc;
  if (pc === FULL_SCAN) inScan = true;
  if (inScan && SCAN_DONE.includes(pc)) break;
  if (inScan && pc === COLUMN_TEST) {
    const column = three.peek(SYSTEM_VIA_ORA) & 0x0f;
    const yes = (three.peek(SYSTEM_VIA_IFR) & 0x01) === 1;
    lines.push(`    &${hex8(column)} → &FE4F, BIT &FE4D   column ${String(column)}: IFR bit 0 = ${yes ? '1  ← CA2 rose: a key in rows 1-7' : '0'}`);
  }
  if (inScan && pc === ROW_TEST) {
    const port = three.peek(SYSTEM_VIA_ORA);
    lines.push(`      &${hex8(port & 0x7f)} → &FE4F, BIT &FE4F       key &${hex8(port & 0x7f)}: PA7 = ${(port & 0x80) !== 0 ? '1  ← this key' : '0'}`);
  }
  three.step();
}
for (const line of lines) console.log(line);
console.log('  Before each column test the MOS selects column 15 (&0F: no keys, CA2 low) and writes &01 to &FE4D to clear');
console.log('  IFR bit 0, so a column with a key down makes a fresh rising edge. Only that column has its keys tried on PA7.');
