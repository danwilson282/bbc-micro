// Pixel decoding (Stage 41): which bits of a screen byte make which pixel.
//
// The Video ULA latches each screen byte into an 8-bit shift register. Every
// pixel clock tick it reads bits 7, 5, 3 and 1 as a 4-bit palette index
// (bit 7 = index bit 3 ... bit 1 = index bit 0), then shifts left one place,
// filling bit 0 with a 1 (BeebWiki, "Video ULA"). That is the same in every
// MODE: only the number of ticks per byte changes (Stage 40's pixel clock ÷
// byte clock). So a pixel's bits are spaced by the pixels-per-byte count:
//
//   4 bpp (MODE 2)       pixel 0 = 7 5 3 1, pixel 1 = 6 4 2 0
//   2 bpp (MODE 1, 5)    7 3, 6 2, 5 1, 4 0
//   1 bpp (MODE 0 ...)   7, 6, 5, 4, 3, 2, 1, 0
//
// Two views of a byte live here. shiftPixels is the hardware's: palette
// indices, right for any palette, and allocation-free for Stage 42's
// renderer. logicalColour / encodePixels are the programmer's (the AUG's
// layouts, VDU 19 and GCOL). logicalFromIndex links them; the tests prove
// they agree for all 256 bytes.

/** Bits per pixel in the MOS's bitmap MODEs (Stage 40's UlaControl.bitsPerPixel). */
export type BitsPerPixel = 1 | 2 | 4;

/** What enters bit 0 of the shift register each tick: 1s (BeebWiki notes "random values on some machines"). */
export const ULA_SHIFT_FILL = 1;

/** Shift register bits 7, 5, 3, 1 → palette index bits 3, 2, 1, 0. */
export function paletteIndex(shiftRegister: number): number {
  const s = shiftRegister & 0xff;
  return ((s >> 4) & 0x08) | ((s >> 3) & 0x04) | ((s >> 2) & 0x02) | ((s >> 1) & 0x01);
}

/**
 * The hardware's view: latch the byte, then per pixel read the taps and shift
 * left, a 1 coming in. Fills out[0..pixelsPerByte-1] (1-16) with palette
 * indices 0-15. No allocation: Stage 42 calls this for every screen byte.
 */
export function shiftPixels(byte: number, pixelsPerByte: number, out: Uint8Array): void {
  let s = byte & 0xff;
  for (let p = 0; p < pixelsPerByte; p++) {
    out[p] = paletteIndex(s);
    s = ((s << 1) | ULA_SHIFT_FILL) & 0xff;
  }
}

/** 8 ÷ bits per pixel: 8, 4 or 2. */
export function pixelsPerByteFor(bitsPerPixel: BitsPerPixel): number {
  return 8 / bitsPerPixel;
}

/** The byte positions of pixel p's bits, most significant first: 7 - p, then every pixels-per-byte places lower. */
export function pixelBitPositions(pixel: number, bitsPerPixel: BitsPerPixel): readonly number[] {
  const step = pixelsPerByteFor(bitsPerPixel);
  return Array.from({ length: bitsPerPixel }, (_, k) => 7 - pixel - k * step);
}

/** The programmer's view: pixel p's logical colour (0-1, 0-3 or 0-15), from the AUG's layout. */
export function logicalColour(byte: number, pixel: number, bitsPerPixel: BitsPerPixel): number {
  const step = pixelsPerByteFor(bitsPerPixel);
  let colour = 0;
  for (let k = 0; k < bitsPerPixel; k++) colour = (colour << 1) | ((byte >> (7 - pixel - k * step)) & 1);
  return colour;
}

/**
 * The index bits that are the pixel itself: 1 bpp → bit 3; 2 bpp → bits 3
 * (high) and 1 (low); 4 bpp → all four. The others come from later pixels or
 * the shifted-in 1s, which is why the MOS writes each colour to 8, 4 or 1 entries.
 */
export function logicalFromIndex(index: number, bitsPerPixel: BitsPerPixel): number {
  switch (bitsPerPixel) {
    case 1:
      return (index >> 3) & 1;
    case 2:
      return ((index >> 2) & 0x02) | ((index >> 1) & 0x01);
    case 4:
      return index & 0x0f;
  }
}

/** The inverse of logicalColour: the byte whose pixels are these logical colours (each masked to the depth). */
export function encodePixels(colours: readonly number[], bitsPerPixel: BitsPerPixel): number {
  const step = pixelsPerByteFor(bitsPerPixel);
  if (colours.length !== step) {
    throw new RangeError(`${String(bitsPerPixel)} bits per pixel needs ${String(step)} pixels, not ${String(colours.length)}`);
  }
  let byte = 0;
  colours.forEach((c, p) => {
    for (let k = 0; k < bitsPerPixel; k++) {
      // Bit k of the colour, counted from the top, goes to position 7 - p - k * step.
      const bit = (c >> (bitsPerPixel - 1 - k)) & 1;
      byte |= bit << (7 - p - k * step);
    }
  });
  return byte & 0xff;
}
