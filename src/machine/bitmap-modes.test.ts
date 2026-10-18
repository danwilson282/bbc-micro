// Stage 42 with the real ROMs: the MOS prints into screen memory, and the
// machine's bitmap renderer turns it into pixels. Each letter is read back
// from the pixels and compared with the MOS's own font at &C000 (characters
// &20-&7F, 8 bytes each), so the test knows nothing about what a letter looks like.

import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { BITMAP_WIDTH } from '../video/bitmap-renderer';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

const BOTH_ROMS = ['roms/os12.rom', 'roms/basic2.rom'] as const;
/** The MOS font: character &20's 8 bytes first (Advanced User Guide, VDU 23). */
const MOS_FONT = 0xc000;

const BLACK = 0;
const RED = 1;
const WHITE = 7;

/** Text letters across each MODE: a letter is 8 pixels, so 640 dots ÷ letters ÷ 8 dots a pixel. */
const LETTERS = { 0: 80, 1: 40, 2: 20, 4: 40, 5: 20 } as const;
type Mode = keyof typeof LETTERS;
const MODES = [0, 1, 2, 4, 5] as const satisfies readonly Mode[];

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function booted(): BbcModelB {
  const m = new BbcModelB();
  loadStandardRoms(m.map);
  m.powerOn();
  run(m, 50);
  return m;
}

function glyph(m: BbcModelB, char: string): number[] {
  const base = MOS_FONT + (char.charCodeAt(0) - 0x20) * 8;
  return Array.from({ length: 8 }, (_, line) => m.peek(base + line));
}

/** The colour of pixel (px, line) of the letter at text column, row: sampled at the pixel's first dot. */
function colourAt(m: BbcModelB, mode: Mode, column: number, row: number, px: number, line: number): number {
  const dotsPerPixel = BITMAP_WIDTH / LETTERS[mode] / 8;
  return m.bitmap.pixels[(row * 8 + line) * BITMAP_WIDTH + (column * 8 + px) * dotsPerPixel] ?? -1;
}

/** A letter read back from the pixels as 8 bytes, bit 7 = leftmost pixel, set where it isn't black. */
function letterAt(m: BbcModelB, mode: Mode, column: number, row: number): number[] {
  return Array.from({ length: 8 }, (_, line) => {
    let byte = 0;
    for (let px = 0; px < 8; px++) byte = (byte << 1) | (colourAt(m, mode, column, row, px, line) !== BLACK ? 1 : 0);
    return byte;
  });
}

function mode(m: BbcModelB, n: number): void {
  typeText(m, `MODE ${String(n)}\r`);
  run(m, 5);
}

describe('MOS 1.20 text in the bitmap MODEs', () => {
  for (const n of MODES) {
    withRoms(...BOTH_ROMS)(`MODE ${String(n)}: the > prompt at the top left is the MOS font's glyph, white on black`, () => {
      const m = booted();
      mode(m, n);
      expect(letterAt(m, n, 0, 0)).toEqual(glyph(m, '>'));
      // Its lit pixels are white: logical colour 1, 3 or 7, the MOS's default foreground.
      expect(colourAt(m, n, 0, 0, 2, 0)).toBe(WHITE);
    });

    withRoms(...BOTH_ROMS)(`MODE ${String(n)}: PRINT "HELLO" puts HELLO on row 1, letter for letter`, () => {
      const m = booted();
      mode(m, n);
      typeText(m, 'PRINT "HELLO"\r');
      run(m, 5);
      const read = Array.from('HELLO', (_, column) => letterAt(m, n, column, 1));
      expect(read).toEqual(Array.from('HELLO', (c) => glyph(m, c)));
    });
  }

  withRoms(...BOTH_ROMS)('MODE 1: COLOUR 1 then PRINT draws the letters in red (logical 1 through the palette)', () => {
    const m = booted();
    mode(m, 1);
    typeText(m, 'COLOUR 1\rPRINT "A"\r');
    run(m, 5);
    // Row 0: >COLOUR 1, row 1: >PRINT "A", row 2: A. Pixel 2 of A's top line (&3C) is lit.
    expect(letterAt(m, 1, 0, 2)).toEqual(glyph(m, 'A'));
    expect(colourAt(m, 1, 0, 2, 2, 0)).toBe(RED);
  });

  for (const n of MODES) {
    withRoms(...BOTH_ROMS)(`MODE ${String(n)}: the cursor is an underline one letter wide after the prompt, blinking`, () => {
      const m = booted();
      mode(m, n);
      // The blink is 16 fields on, 16 off: in 32 consecutive fields, the cursor's line shows both.
      const seen = new Set<string>();
      for (let f = 0; f < 32; f++) {
        run(m, 1);
        const line7 = Array.from({ length: 8 }, (_, px) => colourAt(m, n, 1, 0, px, 7)).join('');
        seen.add(line7);
        // Line 6 of the same letter never has it.
        expect(Array.from({ length: 8 }, (_, px) => colourAt(m, n, 1, 0, px, 6)).every((c) => c === BLACK)).toBe(true);
      }
      expect([...seen].sort()).toEqual(['00000000', '77777777']);
    });
  }
});
