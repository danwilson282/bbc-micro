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
// MA12 asks the board to wrap a bitmap screen that has scrolled past &7FFF,
// by the screen size IC32's C0/C1 select. That's Stage 43; here it does nothing.

/** MA13: teletext addressing. */
const MA13_TELETEXT = 0x2000;
/** MA11, which becomes A14 in teletext addressing. */
const MA11 = 0x0800;
/** MA0-MA9. */
const TELETEXT_MA_MASK = 0x3ff;
/** A10-A13, forced high in teletext addressing. */
const TELETEXT_BASE = 0x3c00;
/** MA0-MA11, which become A3-A14 in bitmap addressing. */
const BITMAP_MA_MASK = 0x0fff;
/** RA0-RA2. */
const BITMAP_RA_MASK = 0x07;

/** MA13 = 1: MODE 7's RAM address for character address ma. */
export function teletextAddress(ma: number): number {
  return TELETEXT_BASE | ((ma & MA11) << 3) | (ma & TELETEXT_MA_MASK);
}

/** MA13 = 0: the RAM address of scanline ra of the character at ma. No MA12 wrap yet (Stage 43). */
export function bitmapAddress(ma: number, ra: number): number {
  return ((ma & BITMAP_MA_MASK) << 3) | (ra & BITMAP_RA_MASK);
}

/** The RAM address the board reads for the 6845's MA and RA. */
export function screenAddress(ma: number, ra: number): number {
  return (ma & MA13_TELETEXT) !== 0 ? teletextAddress(ma) : bitmapAddress(ma, ra);
}
