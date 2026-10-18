// Stage 38 demo: the 6845 counts, and its VSYNC is the MOS's 50 Hz.
//
//   npm run demo:crtc
//
// Part 1 boots the MOS and copies the registers it left in the CRTC (MODE 7)
// into a second, bare 6845, so it can be clocked one character at a time:
// one scanline, character by character. Part 2 is a whole field, scanline by
// scanline, but only the lines where something happens: an even field and
// an odd one. Part 3 is the field rate measured from the VSYNCs for each
// MODE, typed into BASIC, beside Stage 37's formula. Part 4: the boot and
// typing still work.

import { CRTC_ADDRESS, CRTC_DATA, Crtc6845 } from '../src/devices/crtc6845';
import { ULA_CONTROL_FAST_CLOCK, characterClockHz, crtcGeometry } from '../src/devices/crtc-geometry';
import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex8 } from '../src/util/bits';
import { mode7StartAddress, mode7Text } from '../src/video/mode7-text';

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function booted(): BbcModelB {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map);
  const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
  if (!has('mos') || !has('basic')) {
    console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
    process.exit(0);
  }
  m.powerOn();
  run(m, 50);
  return m;
}

/** A bare 6845 with the machine's registers and clock, reset to the top of an even field. */
function copyOf(m: BbcModelB): { crtc: Crtc6845; perChar: number } {
  const crtc = new Crtc6845();
  m.crtc.registers().forEach((v, n) => {
    crtc.write(CRTC_ADDRESS, n);
    crtc.write(CRTC_DATA, v);
  });
  const fast = (m.videoUla.control & ULA_CONTROL_FAST_CLOCK) !== 0;
  crtc.connectClock(() => fast);
  crtc.reset();
  return { crtc, perChar: fast ? 1 : 2 };
}

const m = booted();
const regs = m.crtc.registers();
console.log(`Booted into MODE 7. The MOS left R0-R9 = ${regs.slice(0, 10).map(hex8).join(' ')}, ULA control &${hex8(m.videoUla.control)} (bit 4 = 0: 1 MHz).`);

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 1: one scanline, one character (1 µs) at a time ──');
{
  const { crtc, perChar } = copyOf(m);
  let row = '';
  let line = '';
  let sync = '';
  let n = 0;
  do {
    row += String(crtc.character % 10);
    line += crtc.displayEnable ? '█' : '·';
    sync += crtc.hsync ? 'H' : '·';
    crtc.tick(perChar);
    n++;
  } while (crtc.fieldLine === 0);
  console.log(`  character  ${row}`);
  console.log(`  DISPEN     ${line}`);
  console.log(`  HSYNC      ${sync}`);
  console.log(`  ${String(n)} characters (R0 = &3F, + 1). Display for 0-39 (R1 = &28 = 40). HSYNC from 51 (R2 = &33)`);
  console.log('  for 4 (R3 bits 0-3). At 1 MHz that\'s 64 µs: one PAL line.');
}

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: three fields, only the moments where something changes ──');
{
  const { crtc, perChar } = copyOf(m);
  let cycle = 0;
  let lastRise = -1;
  for (let field = 0; field < 3; field++) {
    console.log(`  ${crtc.oddField ? 'odd' : 'even'} field:`);
    // Display enable, as seen at character 0 of each line: only its vertical half changes there.
    let shown = crtc.displayEnable;
    let vsync = crtc.vsync;
    let adjust = crtc.inAdjust;
    let lines = 1;
    do {
      crtc.tick(perChar);
      cycle += perChar;
      const where = `line ${String(crtc.fieldLine).padStart(3)}, character ${String(crtc.character).padStart(2)}`;
      const counters = `row ${String(crtc.row).padStart(2)}, scanline ${String(crtc.scanline).padStart(2)}`;
      if (crtc.character === 0 && crtc.fieldLine !== 0) {
        lines++;
        if (shown && !crtc.displayEnable) console.log(`    ${where} (${counters}): display enable off for the rest of the field: row = R6 (&19 = 25)`);
        shown = crtc.displayEnable;
      }
      if (crtc.vsync !== vsync) {
        vsync = crtc.vsync;
        if (vsync) {
          const gap = lastRise < 0 ? '' : `, ${(cycle - lastRise).toLocaleString('en-GB')} cycles after the last`;
          lastRise = cycle;
          console.log(`    ${where} (${counters}): VSYNC rises: row = R7 (&1C = 28)${gap}`);
        } else {
          console.log(`    ${where} (${counters}): VSYNC falls, 2 lines later (R3 bits 4-7): CA1 falls, the MOS's IRQ`);
        }
      }
      if (crtc.inAdjust && !adjust) console.log(`    ${where}: row 30 (= R4) is done; vertical adjust, R5 = 2 lines${crtc.oddField ? ' + 1 (odd field)' : ''}`);
      adjust = crtc.inAdjust;
    } while (crtc.fieldLine !== 0 || crtc.character !== 0);
    console.log(`    ${String(lines)} lines.`);
  }
  console.log('  312 + 313 = 625 lines in two fields, and the VSYNCs 40,000 cycles (312.5 × 64 µs) apart either way.');
  console.log('  (Scanlines step by 2 in MODE 7: R8 = &93 is interlace sync and video, so the odd field shows 1, 3, 5 …)');
}

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: the field rate, measured from VSYNC, for each MODE ──');
console.log('  MODE             R8  cycles between VSYNCs  measured   Stage 37\'s formula');
const show = (label: string): void => {
  const period = m.crtc.vsyncPeriodCycles;
  const g = crtcGeometry(m.crtc.registers(), characterClockHz(m.videoUla.control));
  console.log(`  ${label.padEnd(15)}  ${hex8(m.crtc.register(8))}  ${period.toLocaleString('en-GB').padStart(21)}  ${(2_000_000 / period).toFixed(2)} Hz   ${g.fieldRateHz.toFixed(2)} Hz`);
};
for (const mode of [0, 1, 2, 3, 4, 5, 6, 7]) {
  typeText(m, `MODE ${String(mode)}\r`);
  run(m, 5);
  show(String(mode));
}
typeText(m, '*TV 0,1\r');
typeText(m, 'MODE 0\r');
run(m, 5);
show('*TV 0,1: MODE 0');
typeText(m, 'MODE 7\r');
run(m, 5);
show('*TV 0,1: MODE 7');
console.log('  *TV 0,1 turns interlace off by EORing R8 with &0291 (Stage 37), except in MODE 7, whose R8 has bit 7 set.');
typeText(m, '*TV 0,0\r');
typeText(m, 'MODE 7\r');
run(m, 5);

// ── Part 4 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 4: the MOS on the real VSYNC ──');
{
  const before = m.peek(0x0240);
  const count = m.crtc.vsyncCount;
  run(m, 50);
  console.log(`  One second: ${String(m.crtc.vsyncCount - count)} VSYNCs, and the MOS counted &0240 down by ${String((before - m.peek(0x0240)) & 0xff)}.`);
  typeText(m, 'PRINT 6*7\r');
  run(m, 5);
  const rows = mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13)));
  console.log('  Typed PRINT 6*7; the screen\'s last lines:');
  for (const r of rows.filter((t) => t.trim() !== '').slice(-3)) console.log(`    |${r.trimEnd()}`);
}
