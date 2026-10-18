// Stage 39 demo: the 6845's address counter, hardware scrolling and the cursor.
//
//   npm run demo:addressing
//
// Part 1 clocks a bare 6845 with MOS 1.20's MODE 7 and MODE 4 settings and
// prints MA and RA as they come out, with the RAM address the board makes of
// them. Part 2 boots the MOS, prints past the bottom of the screen, and logs
// every R13 write (a scroll) and the moment the counter latched it: always
// the top of the next field, so two scrolls in one field are drawn as one. Part 3 is the cursor's blink, field by field,
// then with VDU 23,1,0.

import { CRTC_ADDRESS, CRTC_DATA, Crtc6845 } from '../src/devices/crtc6845';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { MOS_MODE7_CRTC } from '../src/mos/mos-crtc';
import { hex16 } from '../src/util/bits';
import { mode7ScreenFrom } from '../src/video/mode7-renderer';
import { mode7Text } from '../src/video/mode7-text';
import { SCREEN_10K, screenAddress, teletextAddress } from '../src/video/screen-address';

/** MOS 1.20's MODE 4 R0-R13 (R12/R13 = &0B00: &5800). */
const MODE4 = [0x3f, 0x28, 0x31, 0x24, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08, 0x0b, 0x00];

function bareCrtc(values: readonly number[]): Crtc6845 {
  const crtc = new Crtc6845();
  values.forEach((v, r) => {
    crtc.write(CRTC_ADDRESS, r);
    crtc.write(CRTC_DATA, v);
  });
  crtc.reset();
  return crtc;
}

/** "MA &2800 RA 0 → &7C00" for the counter now. */
function where(crtc: Crtc6845): string {
  const ma = crtc.memoryAddress;
  const ra = crtc.scanline;
  return `MA &${hex16(ma)}  RA ${String(ra).padStart(2)}  → &${hex16(screenAddress(ma, ra, SCREEN_10K))}`; // MODE 4's size; MODE 7 ignores it
}

/** Characters until (row, scanline, character). */
function runTo(crtc: Crtc6845, row: number, scanline: number, character: number): void {
  while (!(crtc.row === row && crtc.scanline === scanline && crtc.character === character)) crtc.tick(1);
}

console.log('Part 1: what the 6845 puts on its address pins, and what the board makes of it\n');
console.log('  MODE 7 (R12/R13 = &2800, MA13 = 1: one byte a character, RA unused):');
const m7 = bareCrtc(MOS_MODE7_CRTC);
for (const [row, line, ch, note] of [
  [0, 0, 0, 'top-left: the latched start'],
  [0, 0, 1, 'one character on'],
  [0, 0, 39, 'the last displayed character (R1 = 40)'],
  [0, 0, 63, 'still counting in the blanking (R0 = 63)'],
  [0, 2, 0, 'next scanline: back to the row start'],
  [1, 0, 0, 'next row: R1 = &28 further on'],
  [24, 0, 39, 'the last cell'],
] as const) {
  runTo(m7, row, line, ch);
  console.log(`    row ${String(row).padStart(2)} char ${String(ch).padStart(2)}  ${where(m7)}   ${note}`);
}
console.log('\n  MODE 4 (R12/R13 = &0B00, MA13 = 0: 8 bytes a character, RA is the bottom 3 bits):');
const m4 = bareCrtc(MODE4);
for (const [row, line, ch, note] of [
  [0, 0, 0, 'top-left: &0B00 × 8 = &5800'],
  [0, 1, 0, 'scanline 1: the next byte'],
  [0, 7, 0, 'scanline 7: the cell\'s last byte'],
  [0, 0, 1, 'the next character'],
  [0, 7, 1, ''],
  [1, 0, 0, 'row 1: 40 characters × 8 bytes = &140 on'],
] as const) {
  runTo(m4, row, line, ch);
  console.log(`    row ${String(row).padStart(2)} char ${String(ch).padStart(2)}  ${where(m4)}   ${note}`);
}
console.log(`\n  MA10 isn't wired in MODE 7, so the counter passing &2BFF wraps the screen: &2C00 → &${hex16(teletextAddress(0x2c00))}.`);

const m = new BbcModelB();
const report = loadStandardRoms(m.map);
if (!report.loaded.some((r) => r.id === 'mos') || !report.loaded.some((r) => r.id === 'basic')) {
  console.log('\nParts 2 and 3 skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
  process.exit(0);
}
m.powerOn();
for (let i = 0; i < 50; i++) m.runFrame();

console.log('\nPart 2: scrolling. FOR I=1 TO 30:PRINT I:NEXT, from the > prompt on row 5\n');
console.log('  The MOS writes R13 (and R12 when it carries) whenever it needs a new line, anywhere in the field.');
console.log('  The counter only takes the new start at the top of the next field. Fields counted from the first write:\n');
typeText(m, 'FOR I=1 TO 30:PRINT I:NEXT\r');
let r13 = m.crtc.register(13);
let start = m.crtc.displayStart;
let firstField = -1;
let events = 0;
for (let cycles = 0; cycles < 40_000 * 60 && events < 14; ) {
  cycles += m.step();
  const field = (): string => `field +${String(m.crtc.fieldsSinceReset - firstField).padEnd(2)} line ${String(m.crtc.fieldLine).padStart(3)}`;
  if (m.crtc.register(13) !== r13) {
    r13 = m.crtc.register(13);
    if (firstField < 0) firstField = m.crtc.fieldsSinceReset;
    const r1213 = (m.crtc.register(12) << 8) | r13;
    console.log(`  ${field()}:  MOS writes R12/R13 = &${hex16(r1213)}`);
    events++;
  }
  if (m.crtc.displayStart !== start) {
    start = m.crtc.displayStart;
    console.log(`  ${field()}:      6845 latches &${hex16(start)}: the screen now starts at &${hex16(teletextAddress(start))}`);
    events++;
  }
}
for (let i = 0; i < 30; i++) m.runFrame();
const rows = mode7Text((a) => m.peek(a), teletextAddress(m.crtc.displayStart));
console.log(`\n  After the loop: start &${hex16(m.crtc.displayStart)} (&${hex16(teletextAddress(m.crtc.displayStart))}), cursor MA &${hex16(m.crtc.cursorAddress)}.`);
console.log(`  The cursor's MA is past &2BFF: the 6845 compares it with the counter, which hasn't wrapped.`);
console.log(`  Bottom rows: ${JSON.stringify(rows[22]?.trimEnd())} ${JSON.stringify(rows[23]?.trimEnd())} ${JSON.stringify(rows[24]?.trimEnd())}`);

/** One character per field: # cursor drawn, . not. */
function blinkLine(fields: number): string {
  let line = '';
  for (let i = 0; i < fields; i++) {
    const field = m.crtc.fieldsSinceReset;
    while (m.crtc.fieldsSinceReset === field) m.step();
    line += mode7ScreenFrom(m.crtc).cursor >= 0 ? '#' : '.';
  }
  return line;
}

console.log('\nPart 3: the cursor blinks itself (R10 = &72: %11, every 32 fields), one mark per field:\n');
console.log(`  ${blinkLine(96)}`);
typeText(m, 'VDU 23,1,0;0;0;0;\r');
for (let i = 0; i < 5; i++) m.runFrame();
console.log(`\n  VDU 23,1,0;0;0;0; → R10 = &${hex16(m.crtc.register(10)).slice(2)} (%01: no cursor):\n`);
console.log(`  ${blinkLine(96)}`);
