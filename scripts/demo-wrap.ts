// Stage 43 demo: hardware wrap-around, MODE 3/6's gap lines, and graphics.
//
//   npm run demo:wrap
//
// Part 1: what the MOS writes to IC32's C0/C1 for each MODE, measured, and
// the screen size the board reads from them.
// Part 2: MODE 4 scrolled: the 6845's start moves, the last rows count past
// MA &0FFF, and the board folds them back into the screen.
// Part 3: MODE 3's 10-line rows: 8 lines of letters, 2 black (RA3).
// Part 4: MOVE/DRAW/GCOL in MODE 1, drawn by the MOS and shown by the
// renderer, then scrolled half way off the screen without corruption.
// Pictures are machine.bitmap.pixels as text art, one character per pixel.

import { BbcModelB } from '../src/machine/bbc-model-b';
import { typeText } from '../src/machine/type-text';
import { loadStandardRoms } from '../src/memory/rom-files';
import { hex16, hex8 } from '../src/util/bits';
import { BITMAP_WIDTH } from '../src/video/bitmap-renderer';
import { WRAP_SUBTRACT, bitmapAddress } from '../src/video/screen-address';

/** One character per physical colour: black, red, green, yellow, blue, magenta, cyan, white. */
const COLOUR_CHARS = ' RGYBMC█';

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

function mode(m: BbcModelB, n: number): void {
  typeText(m, `MODE ${String(n)}\r`);
  run(m, 5);
}

function startMa(m: BbcModelB): number {
  return (m.crtc.register(12) << 8) | m.crtc.register(13);
}

/** Lines from..to-1 of the picture, every `step` dots across, `width` characters wide. */
function art(m: BbcModelB, from: number, to: number, step: number, width: number, label?: (line: number) => string): void {
  for (let line = from; line < to; line++) {
    let text = '';
    for (let i = 0; i < width; i++) text += COLOUR_CHARS[m.bitmap.pixels[line * BITMAP_WIDTH + i * step] ?? 0] ?? '?';
    console.log(`  ${label?.(line) ?? ''}│${text.trimEnd()}`);
  }
}

const m = booted();

// ── Part 1 ─────────────────────────────────────────────────────────────────

console.log('── Part 1: the screen size the MOS gives IC32 (bits 4 and 5) ──');
console.log('MODE  latch  C1 C0  size  subtract  R12/R13  screen');
for (const n of [0, 1, 2, 3, 4, 5, 6]) {
  mode(m, n);
  const size = m.latch.screenSize;
  const subtract = WRAP_SUBTRACT[size] ?? 0;
  console.log(
    `  ${String(n)}    &${hex8(m.latch.value)}   ${String(m.latch.bit(5))}  ${String(m.latch.bit(4))}   ${String(subtract / 1024).padStart(2)}K   &${hex16(subtract)}    &${hex16(startMa(m))}    &${hex16(startMa(m) * 8)}-&7FFF`,
  );
}

// ── Part 2 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 2: MODE 4 after a scroll ──');
mode(m, 4);
console.log(`Before: R12/R13 = &${hex16(startMa(m))} (&${hex16(startMa(m) * 8)}). 32 rows × 40 = &500 characters: MA &${hex16(startMa(m))}-&${hex16(startMa(m) + 0x4ff)}.`);
typeText(m, 'FOR I=1 TO 40:PRINT "LINE"+STR$(I):NEXT\r');
run(m, 100);
const start = startMa(m);
const last = start + 0x4ff;
console.log(`After 40 lines: R12/R13 = &${hex16(start)} (&${hex16(start * 8)}). The 6845 counts MA &${hex16(start)}-&${hex16(last)}: past &0FFF, so MA12 = 1.`);
const firstWrapped = 0x1000;
const row = Math.floor((firstWrapped - start) / 40);
console.log(`MA &1000 is row ${String(row)}, character ${String((firstWrapped - start) % 40)}:`);
console.log(`  MA × 8 = &${hex16(firstWrapped * 8)}; only A0-A14 reach RAM, so with no wrap it would read &${hex16((firstWrapped * 8) & 0x7fff)} (zero page).`);
console.log(`  The board: &${hex16(firstWrapped * 8)} − &${hex16(WRAP_SUBTRACT[m.latch.screenSize] ?? 0)} = &${hex16(bitmapAddress(firstWrapped, 0, m.latch.screenSize))}, the bottom of the screen.`);
console.log('The last three rows, from machine.bitmap.pixels (every 2nd dot):');
art(m, 29 * 8, 32 * 8, 2, 100, (line) => (line % 8 === 0 ? `row ${String(line / 8)} ` : '       '));

// ── Part 3 ─────────────────────────────────────────────────────────────────

console.log('\n── Part 3: MODE 3, rows of 10 lines (R9 = &09) ──');
mode(m, 3);
typeText(m, 'PRINT "MODE 3"\r');
run(m, 5);
console.log('Lines 0-29, every dot. RA 8 and 9 are black: RA3 forces display enable low.');
art(m, 0, 30, 1, 100, (line) => `RA ${String(line % 10)} `);

// ── Part 4 ─────────────────────────────────────────────────────────────────

/** The whole picture in blocks of 8 dots × 4 lines: a block shows the first colour that isn't black in it. */
function blocks(): void {
  for (let top = 0; top < 256; top += 4) {
    let text = '';
    for (let left = 0; left < BITMAP_WIDTH; left += 8) {
      let colour = 0;
      for (let line = top; line < top + 4 && colour === 0; line++) {
        for (let x = left; x < left + 8 && colour === 0; x++) colour = m.bitmap.pixels[line * BITMAP_WIDTH + x] ?? 0;
      }
      text += COLOUR_CHARS[colour] ?? '?';
    }
    console.log(`  │${text.trimEnd()}`);
  }
}

console.log('\n── Part 4: graphics in MODE 1 ──');
mode(m, 1);
const drawing = 'CLS:GCOL 0,1:MOVE 100,100:DRAW 1180,100:DRAW 640,900:DRAW 100,100:GCOL 0,3:MOVE 340,300:DRAW 940,300\r';
console.log(`Typed: ${drawing.trim()}`);
typeText(m, drawing);
run(m, 5);
console.log('The screen in blocks of 8 dots × 4 lines. MODE 1\'s default palette: GCOL 1 red (R), 2 yellow (Y), 3 white (█, and the text):');
blocks();
const scroll = 'VDU 31,0,31:FOR I=1 TO 12:PRINT:NEXT:GCOL 0,2:MOVE 0,40:DRAW 1279,40\r';
console.log(`\nTyped: ${scroll.trim()}`);
typeText(m, scroll);
run(m, 20);
const scrolled = startMa(m);
console.log(
  `12 scrolls: R12/R13 = &${hex16(scrolled)} (&${hex16(scrolled * 8)}). MA &1000 is row ${String(Math.floor((0x1000 - scrolled) / 80))}: below it the rows come from &3000 on, and the yellow line (Y) at y = 40 was plotted there.`,
);
blocks();
