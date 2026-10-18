import {
  CRTC_ADDRESS,
  CRTC_DATA,
  CRTC_R10_CURSOR_START,
  CRTC_R12_START_ADDRESS_HIGH,
  CRTC_R13_START_ADDRESS_LOW,
  CRTC_R14_CURSOR_ADDRESS_HIGH,
  CRTC_R15_CURSOR_ADDRESS_LOW,
  CRTC_R1_HORIZONTAL_DISPLAYED,
  CRTC_R6_VERTICAL_DISPLAYED,
  CRTC_R8_INTERLACE_AND_SKEW,
  Crtc6845,
} from '../devices/crtc6845';
import { ULA_CONTROL, ULA_CONTROL_FAST_CLOCK, ULA_CONTROL_FLASH, ULA_CONTROL_TELETEXT, ULA_PALETTE, VideoUla } from '../devices/video-ula';
import { MOS_DEFAULT_PALETTE, MOS_ULA_CONTROL } from '../mos/mos-video-ula';
import { BITMAP_HEIGHT, BITMAP_WIDTH, BitmapRenderer } from './bitmap-renderer';
import { SCREEN_10K, SCREEN_16K, SCREEN_20K, SCREEN_8K, type ScreenSize } from './screen-address';

// Stage 42: the renderer, driven by a real 6845 and Video ULA programmed as
// MOS 1.20 programs them, drawing from 32K of RAM we fill with patterns.
// Stage 43 adds MODE 3 and 6, the IC32 screen size and the MA12 wrap.

/** MOS 1.20's CRTC values R0-R11 (Stage 37), and its start addresses (measured: MODE 0-2 &3000, 3 &4000, 4-5 &5800, 6 &6000). */
const CRTC: Readonly<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, readonly number[]>> = {
  0: [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  1: [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  2: [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  3: [0x7f, 0x50, 0x62, 0x28, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  4: [0x3f, 0x28, 0x31, 0x24, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  5: [0x3f, 0x28, 0x31, 0x24, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  6: [0x3f, 0x28, 0x31, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
};
const START_MA = { 0: 0x0600, 1: 0x0600, 2: 0x0600, 3: 0x0800, 4: 0x0b00, 5: 0x0b00, 6: 0x0c00 } as const;
type Mode = keyof typeof START_MA;
/** IC32's C0/C1 after the MOS's MODE n (measured in Stage 43). */
const SCREEN_SIZE: Readonly<Record<Mode, ScreenSize>> = {
  0: SCREEN_20K,
  1: SCREEN_20K,
  2: SCREEN_20K,
  3: SCREEN_16K,
  4: SCREEN_10K,
  5: SCREEN_10K,
  6: SCREEN_8K,
};

const BLACK = 0;
const RED = 1;
const YELLOW = 3;
const WHITE = 7;

interface Screen {
  readonly crtc: Crtc6845;
  readonly ula: VideoUla;
  readonly ram: Uint8Array;
  readonly renderer: BitmapRenderer;
  /** IC32's C0/C1 as the renderer sees them: set screenSize to change them. */
  readonly board: { screenSize: ScreenSize };
  /** Writes Rn through &FE00/&FE01. */
  set(n: number, value: number): void;
}

/**
 * MODE n as the MOS leaves it: CRTC table, start address, ULA control byte
 * and default palette. The cursor is off (R10 = &20) unless a test turns it
 * on. Nothing has been drawn yet: call field().
 */
function screenFor(mode: Mode, changes: Readonly<Record<number, number>> = {}): Screen {
  const crtc = new Crtc6845();
  const ula = new VideoUla({ dataBus: 0xff });
  const ram = new Uint8Array(0x8000);
  const set = (n: number, value: number): void => {
    crtc.write(CRTC_ADDRESS, n);
    crtc.write(CRTC_DATA, value);
  };
  CRTC[mode].forEach((v, r) => {
    set(r, v);
  });
  set(CRTC_R10_CURSOR_START, 0x20);
  set(CRTC_R12_START_ADDRESS_HIGH, START_MA[mode] >> 8);
  set(CRTC_R13_START_ADDRESS_LOW, START_MA[mode] & 0xff);
  for (const [r, v] of Object.entries(changes)) set(Number(r), v);
  ula.write(ULA_CONTROL, MOS_ULA_CONTROL[mode] ?? 0);
  MOS_DEFAULT_PALETTE[mode].forEach((nibble, entry) => {
    ula.write(ULA_PALETTE, (entry << 4) | nibble);
  });
  crtc.connectClock(() => (ula.control & ULA_CONTROL_FAST_CLOCK) !== 0);
  const board = { screenSize: SCREEN_SIZE[mode] };
  const renderer = new BitmapRenderer((address) => ram[address & 0x7fff] ?? 0, crtc, ula, board);
  crtc.connectScanline((line) => {
    renderer.drawLine(line);
  });
  crtc.reset();
  return { crtc, ula, ram, renderer, board, set };
}

/** Runs the 6845 (CPU cycles at 2 MHz) until the next field begins: every line of this one drawn. */
function field(s: Screen): void {
  const fields = s.crtc.fieldsSinceReset;
  while (s.crtc.fieldsSinceReset === fields) s.crtc.tick(1);
}

/** Physical colours of dots x .. x + n - 1 of a line. */
function dots(s: Screen, line: number, x: number, n: number): number[] {
  return Array.from(s.renderer.pixels.subarray(line * BITMAP_WIDTH + x, line * BITMAP_WIDTH + x + n));
}

/** A line as a string, one character per dot: '.' black, '#' white, else the colour number. */
function picture(s: Screen, line: number, x: number, n: number): string {
  return dots(s, line, x, n)
    .map((c) => (c === BLACK ? '.' : c === WHITE ? '#' : String(c)))
    .join('');
}

describe('BitmapRenderer: the frame buffer', () => {
  test('is 640 dots (40 µs at 16 MHz) by 256 lines (32 rows of 8), one physical colour each', () => {
    const s = screenFor(0);
    expect([BITMAP_WIDTH, BITMAP_HEIGHT, s.renderer.pixels.length]).toEqual([640, 256, 640 * 256]);
  });
});

describe('BitmapRenderer: character-cell layout (MODE 0, screen at &3000)', () => {
  test('&3000 is the top scanline of the top-left cell: &81 lights dots 0 and 7 of line 0 and nothing else', () => {
    const s = screenFor(0);
    s.ram[0x3000] = 0x81;
    field(s);
    expect(picture(s, 0, 0, 16)).toBe('#......#........');
    expect(s.renderer.pixels.reduce((n, c) => n + (c === WHITE ? 1 : 0), 0)).toBe(2);
  });

  test('&3001-&3007 are the same cell\'s scanlines 1-7, and &3008 is the cell to its right', () => {
    const s = screenFor(0);
    for (let ra = 0; ra < 8; ra++) s.ram[0x3000 + ra] = 0x80 >> ra;
    s.ram[0x3008] = 0xff;
    field(s);
    expect(Array.from({ length: 8 }, (_, line) => picture(s, line, 0, 16))).toEqual([
      '#.......########',
      '.#..............',
      '..#.............',
      '...#............',
      '....#...........',
      '.....#..........',
      '......#.........',
      '.......#........',
    ]);
  });

  test('a row is 80 cells × 8 bytes = &280: &3280 is the first cell of row 1 (line 8), &3278 the last cell of row 0', () => {
    const s = screenFor(0);
    s.ram[0x3280] = 0xf0;
    s.ram[0x3278] = 0x0f;
    field(s);
    expect(picture(s, 8, 0, 8)).toBe('####....');
    expect(picture(s, 0, 632, 8)).toBe('....####');
    expect(picture(s, 7, 632, 8)).toBe('........');
  });

  test('MODE 4 (40 cells, screen at &5800): a row is &140 bytes, and each pixel is 2 dots wide', () => {
    const s = screenFor(4);
    s.ram[0x5800] = 0x80;
    s.ram[0x5940] = 0x01;
    field(s);
    expect(picture(s, 0, 0, 16)).toBe('##..............');
    expect(picture(s, 8, 0, 16)).toBe('..............##');
  });
});

describe('BitmapRenderer: pixels through the palette', () => {
  test('MODE 1: &A5 is logical 2, 1, 2, 1, which the MOS palette makes yellow, red, yellow, red, 2 dots each', () => {
    const s = screenFor(1);
    s.ram[0x3000] = 0xa5;
    field(s);
    expect(dots(s, 0, 0, 8)).toEqual([YELLOW, YELLOW, RED, RED, YELLOW, YELLOW, RED, RED]);
  });

  test('MODE 2: &3F is two white pixels, each 4 dots; &FF is logical 15, flashing: white, then black when control bit 0 is set', () => {
    const s = screenFor(2);
    s.ram[0x3000] = 0x3f;
    s.ram[0x3008] = 0xff;
    field(s);
    expect(picture(s, 0, 0, 16)).toBe('################');
    s.ula.write(ULA_CONTROL, (MOS_ULA_CONTROL[2] ?? 0) | ULA_CONTROL_FLASH);
    field(s);
    expect(picture(s, 0, 0, 16)).toBe('########........');
  });

  test('MODE 5: 4 pixels a byte at 1 MHz, so each pixel is 4 dots and a byte 16', () => {
    const s = screenFor(5);
    s.ram[0x5800] = 0x88; // pixel 0 logical 3 (white), pixels 1-3 logical 0
    field(s);
    expect(picture(s, 0, 0, 20)).toBe('####................');
  });

  test('the palette is read as each line starts: a write after line 128 began changes lines 129 onwards', () => {
    const s = screenFor(0);
    s.ram.fill(0xff, 0x3000, 0x8000);
    while (s.crtc.fieldLine !== 128) s.crtc.tick(1);
    // Entries 8-F (index bit 3 = 1: logical 1) from white to red: colour 1 EOR 7 = 6.
    for (let entry = 8; entry < 16; entry++) s.ula.write(ULA_PALETTE, (entry << 4) | 0x06);
    field(s);
    expect([dots(s, 127, 0, 1), dots(s, 128, 0, 1), dots(s, 129, 0, 1), dots(s, 255, 639, 1)]).toEqual([[WHITE], [WHITE], [RED], [RED]]);
  });
});

describe('BitmapRenderer: what the 6845 says to show', () => {
  test('the start address scrolls the picture: R12/R13 = &0601 puts &3008\'s cell at the top left', () => {
    const s = screenFor(0, { [CRTC_R12_START_ADDRESS_HIGH]: 0x06, [CRTC_R13_START_ADDRESS_LOW]: 0x01 });
    s.ram[0x3008] = 0xff;
    field(s);
    expect(picture(s, 0, 0, 16)).toBe('########........');
  });

  test('characters from R1 on are black (display enable low): R1 = 64 blanks dots 512-639', () => {
    const s = screenFor(0, { [CRTC_R1_HORIZONTAL_DISPLAYED]: 64 });
    s.ram.fill(0xff, 0x3000, 0x8000);
    field(s);
    expect(picture(s, 10, 504, 16)).toBe('########........');
    expect(dots(s, 10, 512, 128).every((c) => c === BLACK)).toBe(true);
  });

  test('rows from R6 on are black: R6 = 2 shows lines 0-15 only', () => {
    const s = screenFor(0, { [CRTC_R6_VERTICAL_DISPLAYED]: 2 });
    s.ram.fill(0xff, 0x3000, 0x8000);
    field(s);
    expect([dots(s, 15, 0, 1), dots(s, 16, 0, 1), dots(s, 255, 0, 1)]).toEqual([[WHITE], [BLACK], [BLACK]]);
  });

  test('in teletext (control bit 1) the ULA doesn\'t draw: the buffer keeps what it had', () => {
    const s = screenFor(0);
    s.ram[0x3000] = 0xff;
    field(s);
    s.ram[0x3000] = 0x00;
    s.ula.write(ULA_CONTROL, ULA_CONTROL_TELETEXT);
    field(s);
    expect(picture(s, 0, 0, 8)).toBe('########');
  });
});

describe('BitmapRenderer: the cursor', () => {
  /** MODE n with the MOS's cursor (R10 = &67: line 7, 32-field blink) one letter right of the start. */
  function withCursor(mode: Mode, letterBytes: number, r8 = 0x01): Screen {
    const cursor = START_MA[mode] + letterBytes;
    return screenFor(mode, {
      [CRTC_R8_INTERLACE_AND_SKEW]: r8,
      [CRTC_R10_CURSOR_START]: 0x67,
      [CRTC_R14_CURSOR_ADDRESS_HIGH]: cursor >> 8,
      [CRTC_R15_CURSOR_ADDRESS_LOW]: cursor & 0xff,
    });
  }

  /** Which dots of a line are lit, as [first, last], or undefined if none. */
  function litRange(s: Screen, line: number): [number, number] | undefined {
    const lit = dots(s, line, 0, BITMAP_WIDTH).flatMap((c, x) => (c !== BLACK ? [x] : []));
    const first = lit.at(0);
    const last = lit.at(-1);
    return first === undefined || last === undefined ? undefined : [first, last];
  }

  // One letter is 1, 2 or 4 bytes; the ULA's segments (control bits 7-5) make the cursor that many bytes wide.
  test.each([
    [0, 1, [8, 15]],
    [1, 2, [16, 31]],
    [2, 4, [32, 63]],
    [4, 1, [16, 31]],
    [5, 2, [32, 63]],
  ] as const)('MODE %i: the cursor is one letter (%i byte(s)) wide, on line 7 only, inverting black to white', (mode, bytes, range) => {
    const s = withCursor(mode, bytes);
    field(s);
    expect([litRange(s, 6), litRange(s, 7), litRange(s, 8)]).toEqual([undefined, range, undefined]);
    expect(dots(s, 7, range[0], 1)).toEqual([WHITE]);
  });

  test('the cursor inverts what is there: white pixels under it turn black', () => {
    const s = withCursor(0, 1);
    s.ram[0x3008 + 7] = 0xf0;
    field(s);
    expect(picture(s, 7, 8, 8)).toBe('....####');
  });

  test('R10 = &67 blinks every 16 fields: on in fields 0-15, off in 16-31', () => {
    const s = withCursor(0, 1);
    const on: boolean[] = [];
    for (let f = 0; f < 32; f++) {
      field(s);
      on.push(litRange(s, 7) !== undefined);
    }
    expect(on).toEqual([...new Array<boolean>(16).fill(true), ...new Array<boolean>(16).fill(false)]);
  });

  test('R8 cursor skew: %01 (R8 = &41) moves it one byte right; %11 (&C1) hides it', () => {
    const skewed = withCursor(0, 1, 0x41);
    field(skewed);
    const off = withCursor(0, 1, 0xc1);
    field(off);
    expect([litRange(skewed, 7), litRange(off, 7)]).toEqual([[16, 23], undefined]);
  });
});

describe('BitmapRenderer: hardware wrap-around (MA12 and IC32\'s screen size)', () => {
  /** R12/R13 set to a start address in RAM terms. */
  function scrolledTo(mode: Mode, start: number): Screen {
    const ma = start >> 3;
    return screenFor(mode, { [CRTC_R12_START_ADDRESS_HIGH]: ma >> 8, [CRTC_R13_START_ADDRESS_LOW]: ma & 0xff });
  }

  test('MODE 4 scrolled one row (&5940): row 31 counts MA &1000 on and shows &5800, the row the scroll freed', () => {
    const s = scrolledTo(4, 0x5940);
    s.ram[0x5800] = 0xff;
    s.ram[0x0000] = 0x0f; // where MA &1000 would land with no wrap: A15 isn't wired
    field(s);
    expect(picture(s, 248, 0, 32)).toBe('################................');
    expect(picture(s, 0, 0, 16)).toBe('................');
  });

  test('MODE 0 scrolled one row (&3280): row 31 is &3000-&327F, all 80 cells of it', () => {
    const s = scrolledTo(0, 0x3280);
    s.ram[0x3000] = 0x80; // cell 0
    s.ram[0x3278] = 0x01; // cell 79
    field(s);
    expect([picture(s, 248, 0, 8), picture(s, 248, 632, 8)]).toEqual(['#.......', '.......#']);
  });

  test('a start near the top of RAM wraps mid-screen: MODE 1 at &7D80 shows &7D80 on row 0 and &3000 on row 1', () => {
    const s = scrolledTo(1, 0x7d80);
    s.ram.fill(0xff, 0x7d80, 0x8000);
    s.ram[0x3000] = 0x88; // MODE 1: pixel 0 logical 3, which the MOS palette makes white
    field(s);
    expect([picture(s, 0, 0, 4), picture(s, 8, 0, 4)]).toEqual(['####', '##..']);
  });

  test('the size is IC32\'s, read per line, not the MODE\'s: the same MA &1000 reads &5800 at 10K and &3000 at 20K', () => {
    const s = scrolledTo(4, 0x5940);
    s.ram[0x5800] = 0xff;
    s.ram[0x3000] = 0x0f;
    field(s);
    const at10k = picture(s, 248, 0, 16);
    s.board.screenSize = SCREEN_20K;
    field(s);
    expect([at10k, picture(s, 248, 0, 16)]).toEqual(['################', '........########']);
  });
});

describe('BitmapRenderer: MODE 3 and 6\'s gap lines (RA3 forces display enable low)', () => {
  test.each([
    [3, 0x4000, 0x4280],
    [6, 0x6000, 0x6140],
  ] as const)('MODE %i: 25 rows of 10 lines: 8 of pixels, then RA 8 and 9 black; row 1 (one row of bytes on) at line 10', (mode, start, row1) => {
    const s = screenFor(mode);
    s.ram.fill(0xff, start, 0x8000);
    field(s);
    const lit = (line: number): boolean => dots(s, line, 0, 1)[0] === WHITE;
    const rows = Array.from({ length: 26 }, (_, row) => Array.from({ length: 10 }, (_, ra) => (lit(row * 10 + ra) ? '#' : '.')).join(''));
    expect(rows.slice(0, 25).every((r) => r === '########..')).toBe(true);
    expect(rows[25]).toBe('..........'); // lines 250-255: past R6
    s.ram.fill(0, start, 0x8000);
    s.ram[row1] = 0xff;
    field(s);
    expect([lit(0), lit(10)]).toEqual([false, true]); // row 1 is 10 lines down, but only one row of bytes on
  });

  test('without the blank, lines 8 and 9 would repeat lines 0 and 1 (RA3 isn\'t an address bit): they are black even when lines 0-1 are lit', () => {
    const s = screenFor(3);
    s.ram[0x4000] = 0xff;
    s.ram[0x4001] = 0xff;
    field(s);
    expect([picture(s, 0, 0, 8), picture(s, 1, 0, 8), picture(s, 8, 0, 8), picture(s, 9, 0, 8), picture(s, 10, 0, 8)]).toEqual([
      '########',
      '########',
      '........',
      '........',
      '........',
    ]);
  });

  test('it\'s RA3, not the MODE: MODE 0 with R9 = 15 (16-line rows) shows lines 0-7, blanks 8-15, and reads RA 0-7 again for 16-23 (row 1)', () => {
    const s = screenFor(0, { 9: 15 });
    s.ram.fill(0xff, 0x3000, 0x8000);
    field(s);
    const lit = (line: number): boolean => dots(s, line, 0, 1)[0] === WHITE;
    expect(Array.from({ length: 24 }, (_, line) => (lit(line) ? '#' : '.')).join('')).toBe('########........########');
  });

  test('the cursor still shows on the gap lines: MODE 3\'s R10 = &67, R11 = &09 is lines 7-9, under the letter (our reading: CUDISP isn\'t gated by RA3)', () => {
    const cursor = START_MA[3] + 1;
    const s = screenFor(3, {
      [CRTC_R10_CURSOR_START]: 0x67,
      [CRTC_R14_CURSOR_ADDRESS_HIGH]: cursor >> 8,
      [CRTC_R15_CURSOR_ADDRESS_LOW]: cursor & 0xff,
    });
    field(s);
    expect([6, 7, 8, 9, 10].map((line) => picture(s, line, 8, 8))).toEqual(['........', '########', '########', '########', '........']);
  });
});
