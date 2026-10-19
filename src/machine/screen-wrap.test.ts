// Stage 43 with the real ROMs: the MOS sets IC32's screen size for each
// MODE, scrolls by moving the 6845's start, and relies on the board to wrap
// the screen. Text is read back off machine.bitmap.pixels and compared with
// the MOS's font at &C000, as in bitmap-modes.test.ts, after the screen has
// scrolled far enough that the 6845 counts past MA &0FFF every field.

import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { BITMAP_WIDTH } from '../video/bitmap-renderer';
import { SCREEN_10K, SCREEN_16K, SCREEN_20K, SCREEN_8K } from '../video/screen-address';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

const BOTH_ROMS = ['roms/os12.rom', 'roms/basic2.rom'] as const;
const MOS_FONT = 0xc000;
const BLACK = 0;
const RED = 1;

/** Per MODE: text letters across, scanlines a text row, rows on the screen, and where the MOS starts the screen. */
const MODES = {
  0: { letters: 80, lines: 8, rows: 32, start: 0x3000 },
  1: { letters: 40, lines: 8, rows: 32, start: 0x3000 },
  2: { letters: 20, lines: 8, rows: 32, start: 0x3000 },
  3: { letters: 80, lines: 10, rows: 25, start: 0x4000 },
  4: { letters: 40, lines: 8, rows: 32, start: 0x5800 },
  5: { letters: 20, lines: 8, rows: 32, start: 0x5800 },
  6: { letters: 40, lines: 10, rows: 25, start: 0x6000 },
} as const;
type Mode = keyof typeof MODES;
const ALL_MODES = [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly Mode[];

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function booted(): BbcModelB {
  const m = new BbcModelB();
  loadStandardRoms(m.map, ['mos', 'basic']);
  m.powerOn();
  run(m, 50);
  return m;
}

function mode(m: BbcModelB, n: Mode): void {
  typeText(m, `MODE ${String(n)}\r`);
  run(m, 5);
}

function glyph(m: BbcModelB, char: string): number[] {
  const base = MOS_FONT + (char.charCodeAt(0) - 0x20) * 8;
  return Array.from({ length: 8 }, (_, line) => m.peek(base + line));
}

/** The colour at pixel px of scanline `line` of the text row `row`, letter `column`. */
function colourAt(m: BbcModelB, n: Mode, column: number, row: number, px: number, line: number): number {
  const { letters, lines } = MODES[n];
  const dotsPerPixel = BITMAP_WIDTH / letters / 8;
  return m.bitmap.pixels[(row * lines + line) * BITMAP_WIDTH + (column * 8 + px) * dotsPerPixel] ?? -1;
}

/** A letter's 8 scanlines read off the pixels as bytes, bit 7 = leftmost, set where not black. */
function letterAt(m: BbcModelB, n: Mode, column: number, row: number): number[] {
  return Array.from({ length: 8 }, (_, line) => {
    let byte = 0;
    for (let px = 0; px < 8; px++) byte = (byte << 1) | (colourAt(m, n, column, row, px, line) !== BLACK ? 1 : 0);
    return byte;
  });
}

/** Does text row `row` show `text` from column 0? */
function rowShows(m: BbcModelB, n: Mode, row: number, text: string): boolean {
  return Array.from(text).every((c, column) => letterAt(m, n, column, row).join() === glyph(m, c).join());
}

describe('MOS 1.20 sets IC32\'s C0/C1 to its MODE\'s screen size', () => {
  const expected = { 0: SCREEN_20K, 1: SCREEN_20K, 2: SCREEN_20K, 3: SCREEN_16K, 4: SCREEN_10K, 5: SCREEN_10K, 6: SCREEN_8K } as const;
  withRoms(...BOTH_ROMS)('MODE 0-2 → 20K, 3 → 16K, 4-5 → 10K, 6 → 8K (BeebWiki\'s table)', () => {
    const m = booted();
    const seen = ALL_MODES.map((n) => {
      mode(m, n);
      return m.latch.screenSize;
    });
    expect(seen).toEqual(ALL_MODES.map((n) => expected[n]));
  });
});

describe('scrolling text in the bitmap MODEs wraps cleanly', () => {
  for (const n of ALL_MODES) {
    withRoms(...BOTH_ROMS)(`MODE ${String(n)}: after 40 lines the start has moved, the 6845 counts past MA &0FFF, and the bottom rows read LINE39, LINE40, >`, () => {
      const m = booted();
      mode(m, n);
      typeText(m, 'FOR I=1 TO 40:PRINT "LINE"+STR$(I):NEXT\r');
      run(m, 100); // 2 s: BASIC and the MOS's scrolls take most of a second
      const { rows, start } = MODES[n];
      const startMa = (m.crtc.register(12) << 8) | m.crtc.register(13);
      // R1 is one 6845 character per byte column: 1, 2 or 4 a letter.
      const lastMa = startMa + rows * m.crtc.register(1) - 1;
      expect(startMa * 8).not.toBe(start);
      expect(lastMa).toBeGreaterThanOrEqual(0x1000);
      const bottom = rows - 1;
      expect([rowShows(m, n, bottom - 2, 'LINE39'), rowShows(m, n, bottom - 1, 'LINE40'), rowShows(m, n, bottom, '>')]).toEqual([true, true, true]);
    });
  }
});

describe('MODE 3 and 6: 10-line rows with a black gap', () => {
  for (const n of [3, 6] as const) {
    withRoms(...BOTH_ROMS)(`MODE ${String(n)}: HELLO on row 1 is lines 10-17; lines 18-19 are black all the way across`, () => {
      const m = booted();
      mode(m, n);
      typeText(m, 'PRINT "HELLO"\r');
      run(m, 5);
      expect(rowShows(m, n, 1, 'HELLO')).toBe(true);
      for (const line of [18, 19]) {
        expect(m.bitmap.pixels.subarray(line * BITMAP_WIDTH, (line + 1) * BITMAP_WIDTH).every((c) => c === BLACK)).toBe(true);
      }
    });
  }
});

describe('graphics: the MOS plots, the renderer shows the bytes', () => {
  withRoms(...BOTH_ROMS)('MODE 1: GCOL 0,1 then MOVE 0,500 : DRAW 1279,500 is a red line across scanline 130 (1023 - 500 = 523, ÷ 4)', () => {
    const m = booted();
    mode(m, 1);
    typeText(m, 'GCOL 0,1:MOVE 0,500:DRAW 1279,500\r');
    run(m, 5);
    const line = (y: number): number[] => Array.from(m.bitmap.pixels.subarray(y * BITMAP_WIDTH, (y + 1) * BITMAP_WIDTH));
    expect(line(130).every((c) => c === RED)).toBe(true);
    expect(line(129).some((c) => c === RED) || line(131).some((c) => c === RED)).toBe(false);
  });
});
