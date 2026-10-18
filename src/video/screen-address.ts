// What the Model B's board does with the 6845's address pins (Stage 39).
//
// The CRTC puts out a 14-bit character address (MA0-MA13) and a 5-bit
// scanline number (RA0-RA4). It doesn't know what memory looks like: the
// board's address logic makes a RAM address from them, two ways, chosen by
// MA13 (Advanced User Guide, 6845 CRTC and the R12/R13 table; BeebWiki):
//
//   MA13 = 1, teletext (MODE 7): one byte a character, RA not used.
//     A0-A9 = MA0-MA9, A10-A13 = 1, A14 = MA11
//     &2800 → &7C00 (32K MOS); &2000 → &3C00 (16K). MA10 isn't wired, so the
//     screen is a 1K ring.
//
//   MA13 = 0, bitmap (MODES 0-6): eight bytes a character, one per scanline.
//     A0-A2 = RA0-RA2, A3-A14 = MA0-MA11
//     &0B00 → &5800 (MODE 4).
//
// MA12 = 1 means the 6845 has counted past &7FFF (Stage 43). Every bitmap
// screen ends at the top of RAM, so the board wraps the address back into the
// screen by subtracting its size, which IC32's C0 and C1 select: four gates
// and the IC39 adder, in 2K units (BeebWiki "Address translation"). The
// screen is a ring, and scrolling only moves the 6845's start along it.
//
//   C1 C0  size  subtract  starts  MODEs        (measured: the MOS's latch
//    0  0   16K   &4000    &4000   3             writes after each MODE agree)
//    0  1    8K   &2000    &6000   6
//    1  0   20K   &5000    &3000   0, 1, 2
//    1  1   10K   &2800    &5800   4, 5

/** MA13: teletext addressing. */
const MA13_TELETEXT = 0x2000;
/** MA11, which becomes A14 in teletext addressing. */
const MA11 = 0x0800;
/** MA0-MA9. */
const TELETEXT_MA_MASK = 0x3ff;
/** A10-A13, forced high in teletext addressing. */
const TELETEXT_BASE = 0x3c00;
/** MA0-MA12: MA12 is A15 before the wrap, so MA × 8 can reach &8000-&FFFF. */
const BITMAP_MA_MASK = 0x1fff;
/** MA12: the count has passed the end of RAM. */
const MA12_WRAP = 0x1000;
/** A0-A14: the 32K of RAM. */
const RAM_MASK = 0x7fff;

/** IC32's C0 and C1 as one code, (C1 << 1) | C0: which screen size the board wraps by. */
export type ScreenSize = 0 | 1 | 2 | 3;
export const SCREEN_16K = 0;
export const SCREEN_8K = 1;
export const SCREEN_20K = 2;
export const SCREEN_10K = 3;

/** What the board subtracts when MA12 = 1, by screen size code (BeebWiki "Address translation"). */
export const WRAP_SUBTRACT: readonly number[] = [0x4000, 0x2000, 0x5000, 0x2800];
/** RA0-RA2. */
const BITMAP_RA_MASK = 0x07;

/** MA13 = 1: MODE 7's RAM address for character address ma. */
export function teletextAddress(ma: number): number {
  return TELETEXT_BASE | ((ma & MA11) << 3) | (ma & TELETEXT_MA_MASK);
}

/** MA13 = 0: the RAM address of scanline ra of the character at ma, wrapped by the screen size if MA12 = 1. */
export function bitmapAddress(ma: number, ra: number, size: ScreenSize): number {
  const address = ((ma & BITMAP_MA_MASK) << 3) | (ra & BITMAP_RA_MASK);
  if ((ma & MA12_WRAP) === 0) return address;
  return (address - (WRAP_SUBTRACT[size] ?? 0)) & RAM_MASK;
}

/** The RAM address the board reads for the 6845's MA and RA, with IC32's screen size for the wrap. */
export function screenAddress(ma: number, ra: number, size: ScreenSize): number {
  return (ma & MA13_TELETEXT) !== 0 ? teletextAddress(ma) : bitmapAddress(ma, ra, size);
}
