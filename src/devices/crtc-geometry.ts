// What a set of 6845 register values means (Stage 37): the shape and timing
// of the picture, worked out the way the chip's counters will count it in
// Stage 38.
//
// The 6845 counts characters, scanlines and rows; it never knows how long
// any of them takes. That comes from its clock, which the Video ULA picks
// (control register bit 4: 2 MHz or 1 MHz), so the clock is passed in.
//
//   scanline = (R0 + 1) characters ÷ clock          MODE 0: 128 ÷ 2 MHz = 64 µs
//   field    = (R4 + 1) × (R9 + 1) + R5 lines       MODE 0: 39 × 8 + 0  = 312
//              + ½ line when interlaced                                = 312½
//   rate     = 1 ÷ (field × scanline)               312½ × 64 µs = 20 ms → 50 Hz
//
// Pure: plain numbers in, plain numbers out. No DOM, nothing kept.

import {
  CRTC_R0_HORIZONTAL_TOTAL,
  CRTC_R10_CURSOR_START,
  CRTC_R11_CURSOR_END,
  CRTC_R12_START_ADDRESS_HIGH,
  CRTC_R13_START_ADDRESS_LOW,
  CRTC_R14_CURSOR_ADDRESS_HIGH,
  CRTC_R15_CURSOR_ADDRESS_LOW,
  CRTC_R1_HORIZONTAL_DISPLAYED,
  CRTC_R2_HSYNC_POSITION,
  CRTC_R3_SYNC_WIDTHS,
  CRTC_R4_VERTICAL_TOTAL,
  CRTC_R5_VERTICAL_TOTAL_ADJUST,
  CRTC_R6_VERTICAL_DISPLAYED,
  CRTC_R7_VSYNC_POSITION,
  CRTC_R8_INTERLACE_AND_SKEW,
  CRTC_R9_MAX_SCAN_LINE,
} from './crtc6845';

/** Video ULA control register bit 4: 1 = 2 MHz CRTC clock, 0 = 1 MHz (Advanced User Guide, Video ULA). */
export const ULA_CONTROL_FAST_CLOCK = 0x10;

/**
 * R8 bits 0-1 (6845 data sheet): %00 and %10 off, %01 interlace sync (VSYNC
 * moves half a line on alternate fields), %11 sync and video (alternate
 * fields also show alternate scanlines).
 */
export type InterlaceMode = 'off' | 'sync' | 'sync-and-video';

/** R10 bits 5-6: %00 steady, %01 no cursor, %10 blink every 16 fields, %11 every 32. */
export type CursorBlink = 'steady' | 'off' | 'fast' | 'slow';

const BLINK: readonly CursorBlink[] = ['steady', 'off', 'fast', 'slow'];

export interface CrtcGeometry {
  readonly characterClockHz: number;
  /** R0 + 1. */
  readonly charactersPerLine: number;
  /** R1. */
  readonly displayedCharacters: number;
  /** R2: the character HSYNC starts on. */
  readonly hsyncStart: number;
  /** R3 bits 0-3, in characters. */
  readonly hsyncWidth: number;
  readonly lineMicroseconds: number;
  readonly lineRateHz: number;
  /** R4 + 1. */
  readonly rowsPerField: number;
  /** R6. */
  readonly displayedRows: number;
  /** Scanlines one character row takes in one field: R9 + 1, or ⌊R9 ÷ 2⌋ + 1 in interlace sync and video. */
  readonly scanlinesPerRow: number;
  /** The character's height across both fields: twice the above in interlace sync and video, else the same. */
  readonly scanlinesPerRowPerFrame: number;
  /** R5. */
  readonly adjustLines: number;
  /** R7: the row VSYNC starts on. */
  readonly vsyncRow: number;
  /** The scanline of the field VSYNC starts on. */
  readonly vsyncLine: number;
  /** R3 bits 4-7, in scanlines; 0 means 16. */
  readonly vsyncLines: number;
  /** Scanlines with display enable on, per field: R6 rows. */
  readonly displayedLines: number;
  /** Whole lines, plus ½ when interlaced (the average of the two fields). */
  readonly linesPerField: number;
  readonly fieldMicroseconds: number;
  readonly fieldRateHz: number;
  /** A whole picture: two fields when interlaced, one when not. */
  readonly frameRateHz: number;
  readonly interlace: InterlaceMode;
  /** R8 bits 4-5: characters display enable is delayed by (3 = no display). */
  readonly displaySkew: number;
  /** R8 bits 6-7: characters the cursor output is delayed by (3 = no cursor). */
  readonly cursorSkew: number;
  /** R12/R13: the 14-bit character address (MA) of the top-left character. */
  readonly startAddress: number;
  /** R14/R15: the MA the cursor is drawn at. */
  readonly cursorAddress: number;
  /** R10 bits 0-4. */
  readonly cursorStartLine: number;
  /** R11. */
  readonly cursorEndLine: number;
  readonly cursorBlink: CursorBlink;
}

/** The CRTC's character clock from the Video ULA's control byte (&FE20). Only bit 4 matters here; the rest is Stage 40. */
export function characterClockHz(ulaControl: number): number {
  return (ulaControl & ULA_CONTROL_FAST_CLOCK) !== 0 ? 2_000_000 : 1_000_000;
}

function interlaceMode(r8: number): InterlaceMode {
  if ((r8 & 0x01) === 0) return 'off';
  return (r8 & 0x02) === 0 ? 'sync' : 'sync-and-video';
}

/** R0-R17 (as Crtc6845.registers() gives them) and the character clock → the picture's geometry. */
export function crtcGeometry(r: ArrayLike<number>, clockHz: number): CrtcGeometry {
  const at = (n: number): number => r[n] ?? 0;
  const r3 = at(CRTC_R3_SYNC_WIDTHS);
  const r8 = at(CRTC_R8_INTERLACE_AND_SKEW);
  const r9 = at(CRTC_R9_MAX_SCAN_LINE);
  const r10 = at(CRTC_R10_CURSOR_START);
  const interlace = interlaceMode(r8);

  const charactersPerLine = at(CRTC_R0_HORIZONTAL_TOTAL) + 1;
  // Multiply first, so 128 × 1,000,000 ÷ 2,000,000 is exactly 64, with no rounding error.
  const lineMicroseconds = (charactersPerLine * 1_000_000) / clockHz;

  // Interlace sync and video: the scanline counter steps by 2 and ignores R9 bit 0 (built in Stage 38).
  const scanlinesPerRow = interlace === 'sync-and-video' ? (r9 >> 1) + 1 : r9 + 1;
  const rowsPerField = at(CRTC_R4_VERTICAL_TOTAL) + 1;
  const adjustLines = at(CRTC_R5_VERTICAL_TOTAL_ADJUST);
  const linesPerField = rowsPerField * scanlinesPerRow + adjustLines + (interlace === 'off' ? 0 : 0.5);
  const fieldMicroseconds = linesPerField * lineMicroseconds;
  const fieldRateHz = 1_000_000 / fieldMicroseconds;
  const vsyncRow = at(CRTC_R7_VSYNC_POSITION);

  return {
    characterClockHz: clockHz,
    charactersPerLine,
    displayedCharacters: at(CRTC_R1_HORIZONTAL_DISPLAYED),
    hsyncStart: at(CRTC_R2_HSYNC_POSITION),
    hsyncWidth: r3 & 0x0f,
    lineMicroseconds,
    lineRateHz: clockHz / charactersPerLine,
    rowsPerField,
    displayedRows: at(CRTC_R6_VERTICAL_DISPLAYED),
    scanlinesPerRow,
    scanlinesPerRowPerFrame: interlace === 'sync-and-video' ? scanlinesPerRow * 2 : scanlinesPerRow,
    adjustLines,
    vsyncRow,
    vsyncLine: vsyncRow * scanlinesPerRow,
    vsyncLines: r3 >> 4 || 16,
    displayedLines: at(CRTC_R6_VERTICAL_DISPLAYED) * scanlinesPerRow,
    linesPerField,
    fieldMicroseconds,
    fieldRateHz,
    frameRateHz: interlace === 'off' ? fieldRateHz : fieldRateHz / 2,
    interlace,
    displaySkew: (r8 >> 4) & 0x03,
    cursorSkew: (r8 >> 6) & 0x03,
    startAddress: ((at(CRTC_R12_START_ADDRESS_HIGH) & 0x3f) << 8) | (at(CRTC_R13_START_ADDRESS_LOW) & 0xff),
    cursorAddress: ((at(CRTC_R14_CURSOR_ADDRESS_HIGH) & 0x3f) << 8) | (at(CRTC_R15_CURSOR_ADDRESS_LOW) & 0xff),
    cursorStartLine: r10 & 0x1f,
    cursorEndLine: at(CRTC_R11_CURSOR_END) & 0x1f,
    cursorBlink: BLINK[(r10 >> 5) & 0x03] ?? 'steady',
  };
}

const INTERLACE_TEXT: Readonly<Record<InterlaceMode, string>> = {
  off: 'non-interlaced',
  sync: 'interlaced',
  'sync-and-video': 'interlaced (sync and video)',
};

/** e.g. "80×32 characters, 50.00 Hz, interlaced". The rate is per field: what the TV sees. */
export function describeCrtcGeometry(g: CrtcGeometry): string {
  return `${String(g.displayedCharacters)}×${String(g.displayedRows)} characters, ${g.fieldRateHz.toFixed(2)} Hz, ${INTERLACE_TEXT[g.interlace]}`;
}
