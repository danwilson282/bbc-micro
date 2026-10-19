// Stage 42 demo: the bitmap MODEs drawn by the machine's own renderer.
//
//   npm run demo:bitmap
//
// Part 1: what the MOS sets up for each bitmap MODE (6845 and ULA), measured.
// Part 2: the character-cell layout. After MODE 0, the 8 bytes at &3000 are
// the > prompt's 8 scanlines, the MOS font's glyph byte for byte.
// Part 3: MODE 0, 1, 2, 4 and 5 with PRINT "BBC MICRO" typed, drawn from
// machine.bitmap.pixels as text art: one character per pixel (not per dot),
// the colour's initial letter, so wider pixels stay one character.

import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex16, hex8 } from '../src/util/bits';
import { BITMAP_WIDTH } from '../src/video/bitmap-renderer';

/** One character per physical colour: black, red, green, yellow, blue, magenta, cyan, white. */
const COLOUR_CHARS = ' RGYBMC█';

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function booted(): BbcModelB {
  const m = new BbcModelB();
  const report = loadStandardRoms(m.map, ['mos', 'basic']);
  const has = (id: string): boolean => report.loaded.some((r) => r.id === id);
  if (!has('mos') || !has('basic')) {
    console.log('  skipped: roms/os12.rom and roms/basic2.rom are needed (Acorn copyright, so you supply them).');
    process.exit(0);
  }
  m.powerOn();
  run(m, 50);
  return m;
}

function mode(m: BbcModelB, n: number): void {
  typeText(m, `MODE ${String(n)}\r`);
  run(m, 5);
}

/** 16 MHz dots per pixel: from the ULA's pixel clock (control bits 3-2: 2, 4, 8, 16 MHz). */
function dotsPerPixel(m: BbcModelB): number {
  return [8, 4, 2, 1][(m.videoUla.control >> 2) & 3] ?? 1;
}

const m = booted();

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: what the MOS sets up for each bitmap MODE ──');
console.log('MODE  R1  R6  R9  start MA  RAM    ULA  dots/pixel  bytes/line × dots/byte');
for (const n of [0, 1, 2, 3, 4, 5, 6]) {
  mode(m, n);
  const r = (k: number): number => m.crtc.register(k);
  const start = (r(12) << 8) | r(13);
  const dotsPerByte = (m.videoUla.control & 0x10) !== 0 ? 8 : 16;
  console.log(
    `  ${String(n)}   &${hex8(r(1))} &${hex8(r(6))} &${hex8(r(9))}  &${hex16(start)}     &${hex16(start * 8)}  &${hex8(m.videoUla.control & 0xfe)}  ${String(dotsPerPixel(m)).padStart(5)}       ${String(r(1))} × ${String(dotsPerByte)} = ${String(r(1) * dotsPerByte)}`,
  );
}

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: MODE 0\'s top-left cell is &3000-&3007, one byte per scanline ──');
mode(m, 0);
const fontBase = 0xc000 + (0x3e - 0x20) * 8;
console.log(` addr   byte  pixels    font &${hex16(fontBase)}+`);
for (let line = 0; line < 8; line++) {
  const byte = m.peek(0x3000 + line);
  const drawn = Array.from({ length: 8 }, (_, x) => COLOUR_CHARS[m.bitmap.pixels[line * BITMAP_WIDTH + x] ?? 0]).join('');
  console.log(` &${hex16(0x3000 + line)}  &${hex8(byte)}   ${drawn}  &${hex8(m.peek(fontBase + line))}`);
}
console.log(' The next cell along starts at &3008, and row 1 at &3000 + 80 × 8 = &3280.');

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: PRINT "BBC MICRO" in each MODE, drawn from machine.bitmap.pixels ──');
for (const n of [0, 1, 2, 4, 5]) {
  mode(m, n);
  typeText(m, n === 1 || n === 2 ? 'COLOUR 1:PRINT "BBC MICRO"\r' : 'PRINT "BBC MICRO"\r');
  run(m, 5);
  const width = dotsPerPixel(m);
  const pixelsAcross = Math.min(BITMAP_WIDTH / width, 120);
  console.log(`\nMODE ${String(n)}: ULA &${hex8(m.videoUla.control & 0xfe)}, ${String(BITMAP_WIDTH / width)} pixels across, each ${String(width)} dot(s). Rows 0-2, ${String(pixelsAcross)} pixels:`);
  for (let line = 0; line < 24; line++) {
    let text = '';
    for (let px = 0; px < pixelsAcross; px++) text += COLOUR_CHARS[m.bitmap.pixels[line * BITMAP_WIDTH + px * width] ?? 0] ?? '?';
    console.log(`  │${text.trimEnd()}`);
  }
}
console.log('\n(R = red, █ = white. MODE 1 and 2 used COLOUR 1. The cursor is the underline after the last >.)');
