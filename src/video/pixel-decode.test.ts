import { paletteColour } from '../devices/video-ula';
import { MOS_DEFAULT_PALETTE } from '../mos/mos-video-ula';
import {
  ULA_SHIFT_FILL,
  encodePixels,
  logicalColour,
  logicalFromIndex,
  paletteIndex,
  pixelBitPositions,
  pixelsPerByteFor,
  shiftPixels,
  type BitsPerPixel,
} from './pixel-decode';

const DEPTHS: readonly BitsPerPixel[] = [1, 2, 4];
const BYTES = Array.from({ length: 256 }, (_, b) => b);

function indices(byte: number, pixelsPerByte: number): number[] {
  const out = new Uint8Array(16);
  shiftPixels(byte, pixelsPerByte, out);
  return Array.from(out.subarray(0, pixelsPerByte));
}

function logicals(byte: number, bpp: BitsPerPixel): number[] {
  return Array.from({ length: pixelsPerByteFor(bpp) }, (_, p) => logicalColour(byte, p, bpp));
}

describe('the palette index taps: shift register bits 7, 5, 3, 1', () => {
  test('bit 7 is index bit 3, bit 5 index bit 2, bit 3 index bit 1, bit 1 index bit 0', () => {
    expect(paletteIndex(0x80)).toBe(0b1000);
    expect(paletteIndex(0x20)).toBe(0b0100);
    expect(paletteIndex(0x08)).toBe(0b0010);
    expect(paletteIndex(0x02)).toBe(0b0001);
  });

  test('the even bits (6, 4, 2, 0) never reach the taps directly', () => {
    expect(paletteIndex(0x55)).toBe(0);
    expect(paletteIndex(0xaa)).toBe(0x0f);
  });

  test('only the low 8 bits of the shift register are read', () => {
    expect(paletteIndex(0x1ff)).toBe(0x0f);
    expect(paletteIndex(0x100)).toBe(0);
  });
});

describe('shiftPixels: the ULA shifts left one place a tick, shifting in 1s', () => {
  test('ULA_SHIFT_FILL is a 1 (BeebWiki: "the lowest bits are filled up with 1s")', () => {
    expect(ULA_SHIFT_FILL).toBe(1);
  });

  test('MODE 2 &12 = red (1) then blue (4)', () => {
    expect(indices(0x12, 2)).toEqual([0x1, 0x4]);
  });

  test('MODE 1 &A5 reads indices &C, &3, &9, &7: the later taps pick up the shifted-in 1s', () => {
    expect(indices(0xa5, 4)).toEqual([0xc, 0x3, 0x9, 0x7]);
  });

  test('MODE 1 &00 picks up the shifted-in 1s at tap bit 1 by tick 2: indices 0, 0, 1, 1', () => {
    // tick 1: %0000 0001 (bit 1 = 0); tick 2: %0000 0011 (bit 1 = 1); tick 3: %0000 0111 (bit 3 still 0).
    expect(indices(0x00, 4)).toEqual([0b0000, 0b0000, 0b0001, 0b0001]);
  });

  test('16 pixels a byte: after 8 shifts the register is all 1s, so pixels 8-15 read entry &F', () => {
    const out = indices(0x00, 16);
    expect(out.slice(8)).toEqual([15, 15, 15, 15, 15, 15, 15, 15]);
  });

  test('1 pixel a byte: only bits 7, 5, 3, 1 affect the display', () => {
    for (const b of BYTES) expect(indices(b, 1)).toEqual([paletteIndex(b)]);
    expect(indices(0x55, 1)).toEqual([0]);
  });

  test('writes only the first pixelsPerByte slots of out', () => {
    const out = new Uint8Array(16).fill(0xee);
    shiftPixels(0xff, 2, out);
    expect(out[2]).toBe(0xee);
  });

  test('a pixel index is always 0-15, for every byte and every pixel rate', () => {
    for (const ppb of [1, 2, 4, 8, 16]) for (const b of BYTES) for (const i of indices(b, ppb)) expect(i).toBeLessThan(16);
  });
});

describe('pixel bit layout: pixel p\'s bits are spaced by the pixels-per-byte count', () => {
  test('MODE 2 (4 bpp): pixel 0 is bits 7 5 3 1, pixel 1 is 6 4 2 0', () => {
    expect(pixelBitPositions(0, 4)).toEqual([7, 5, 3, 1]);
    expect(pixelBitPositions(1, 4)).toEqual([6, 4, 2, 0]);
  });

  test('MODE 1 (2 bpp): pixels are 7 3, 6 2, 5 1, 4 0', () => {
    expect([0, 1, 2, 3].map((p) => pixelBitPositions(p, 2))).toEqual([[7, 3], [6, 2], [5, 1], [4, 0]]);
  });

  test('MODE 0 (1 bpp): pixel p is bit 7 - p', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((p) => pixelBitPositions(p, 1))).toEqual([[7], [6], [5], [4], [3], [2], [1], [0]]);
  });

  test('at every depth each of the 8 bits belongs to exactly one pixel', () => {
    for (const bpp of DEPTHS) {
      const all = Array.from({ length: pixelsPerByteFor(bpp) }, (_, p) => pixelBitPositions(p, bpp)).flat();
      expect([...all].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });
});

describe('logical colours: the AUG\'s view, exhaustive over all 256 bytes', () => {
  test.each(DEPTHS)('%i bpp: encodePixels(decode(byte)) gives the byte back, for all 256', (bpp) => {
    for (const b of BYTES) expect(encodePixels(logicals(b, bpp), bpp)).toBe(b);
  });

  test.each(DEPTHS)('%i bpp: every logical colour sequence is drawn by exactly one byte', (bpp) => {
    const seen = new Set(BYTES.map((b) => logicals(b, bpp).join(',')));
    expect(seen.size).toBe(256);
  });

  test.each(DEPTHS)('%i bpp: the hardware\'s palette index, cut down to the pixel\'s own index bits, is the logical colour', (bpp) => {
    const ppb = pixelsPerByteFor(bpp);
    for (const b of BYTES) expect(indices(b, ppb).map((i) => logicalFromIndex(i, bpp))).toEqual(logicals(b, bpp));
  });

  test('logicalFromIndex: 1 bpp keeps index bit 3; 2 bpp bits 3 and 1; 4 bpp all four', () => {
    expect(logicalFromIndex(0b1000, 1)).toBe(1);
    expect(logicalFromIndex(0b0111, 1)).toBe(0);
    expect(logicalFromIndex(0b1000, 2)).toBe(2);
    expect(logicalFromIndex(0b0010, 2)).toBe(1);
    expect(logicalFromIndex(0b0101, 2)).toBe(0);
    expect(logicalFromIndex(0b1011, 4)).toBe(11);
  });

  test('worked bytes from the stage doc', () => {
    expect(logicals(0x0f, 2)).toEqual([1, 1, 1, 1]);
    expect(logicals(0xf0, 2)).toEqual([2, 2, 2, 2]);
    expect(logicals(0xa5, 2)).toEqual([2, 1, 2, 1]);
    expect(logicals(0x12, 2)).toEqual([0, 0, 1, 2]);
    expect(logicals(0x3f, 2)).toEqual([1, 1, 3, 3]);
    expect(logicals(0x0f, 4)).toEqual([3, 3]);
    expect(logicals(0xf0, 4)).toEqual([12, 12]);
    expect(logicals(0xa5, 4)).toEqual([12, 3]);
    expect(logicals(0x12, 4)).toEqual([1, 4]);
    expect(logicals(0x3f, 4)).toEqual([7, 7]);
    expect(logicals(0xff, 4)).toEqual([15, 15]);
    expect(logicals(0xa5, 1)).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
  });

  test('encodePixels masks each colour to the depth and rejects a wrong pixel count', () => {
    expect(encodePixels([0x13, 0], 4)).toBe(encodePixels([3, 0], 4));
    expect(() => encodePixels([1, 2, 3], 2)).toThrow(RangeError);
  });
});

describe('with the MOS\'s default palettes, the hardware draws each pixel in its logical colour', () => {
  // Stage 40's measured defaults: MODE 0 black/white, MODE 1 black red yellow white, MODE 2 colour n = n.
  const EXPECTED: Record<0 | 1 | 2, readonly number[]> = {
    0: [0, 7],
    1: [0, 1, 3, 7],
    2: [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7],
  };
  const DEPTH_OF: Record<0 | 1 | 2, BitsPerPixel> = { 0: 1, 1: 2, 2: 4 };

  test.each([0, 1, 2] as const)('MODE %i: all 256 bytes, every pixel', (mode) => {
    const bpp = DEPTH_OF[mode];
    const palette = MOS_DEFAULT_PALETTE[mode];
    for (const b of BYTES) {
      const viaHardware = indices(b, pixelsPerByteFor(bpp)).map((i) => paletteColour(palette[i] ?? 0, false));
      const viaLogical = logicals(b, bpp).map((l) => EXPECTED[mode][l]);
      expect(viaHardware).toEqual(viaLogical);
    }
  });
});
