// The bitmap MODEs (0-6) as pixels (Stage 42): what the Video ULA puts on
// the RGB pins, one scanline at a time, as the beam draws it.
//
// There is no frame buffer on a real BBC. On each scanline the 6845 runs MA
// from the row's start for R1 characters with RA fixed, the board makes each
// MA and RA a RAM address (screen-address.ts: MA × 8 + RA), and the ULA
// shifts the byte it gets out as pixels through the palette (pixel-decode.ts).
// So the 6845 calls drawLine() as each scanline starts (connectScanline),
// and we do the same along the line, with RAM, the control byte and the
// palette as they are at that moment. A palette change half way down the
// screen shows only below it, as on the real machine.
//
// Across, everything is in 16 MHz dots, the ULA's fastest pixel clock. Every
// MOS MODE shows 40 µs of line: 640 dots. A pixel is 16 MHz ÷ pixel clock
// dots wide (MODE 0 1, MODE 1 2, MODE 2 4), and a byte 16 MHz ÷ byte clock
// (8 at 2 MHz, 16 at 1 MHz). Down, one line of the buffer per scanline:
// 256 for 32 rows of 8. The bitmap MODEs are interlace sync only (R8 = &01),
// so both fields draw the same lines and one buffer holds them.
//
// Where the 6845's display enable is low (characters from R1 on, rows from
// R6 on) the ULA outputs black. Where its cursor output is high, the ULA
// inverts the colour for the byte-times its cursor segments say (Stage 40).
//
// In teletext (control bit 1) the SAA5050 makes the pixels, not the ULA:
// mode7-renderer.ts draws those, and this leaves its buffer alone.
//
// Not yet (Stage 43): the MA12 wrap, and the gap lines of MODE 3 and 6
// (RA 8 and 9 read RA 0 and 1's bytes here, because only RA0-RA2 reach RAM).
//
// drawLine() runs inside the CRTC's tick: no allocation, ever.

import {
  CRTC_R10_CURSOR_START,
  CRTC_R11_CURSOR_END,
  CRTC_R1_HORIZONTAL_DISPLAYED,
  CRTC_R8_INTERLACE_AND_SKEW,
  cursorBlinkOn,
  cursorOnScanline,
} from '../devices/crtc6845';
import {
  ULA_CONTROL_CURSOR_SEGMENT_1,
  ULA_CONTROL_CURSOR_SEGMENT_2,
  ULA_CONTROL_CURSOR_SEGMENTS_3_4,
  ULA_CONTROL_FAST_CLOCK,
  ULA_CONTROL_PIXEL_RATE,
  ULA_CONTROL_TELETEXT,
} from '../devices/video-ula';
import { shiftPixels } from './pixel-decode';
import { screenAddress } from './screen-address';

/** 40 µs of displayed line at 16 MHz. */
export const BITMAP_WIDTH = 640;
/** 32 rows of 8 scanlines: MODE 0-2, 4 and 5. MODE 3 and 6 use 250 of them. */
export const BITMAP_HEIGHT = 256;

/** 16 MHz dots per byte at a 2 MHz byte clock (MODE 0-3) and at 1 MHz (MODE 4-6). */
const DOTS_PER_BYTE_FAST = 8;
const DOTS_PER_BYTE_SLOW = 16;
/** Dots per pixel for control bits 3-2 = %00-%11 (2, 4, 8, 16 MHz). */
const DOTS_PER_PIXEL = [8, 4, 2, 1] as const;

/** The ULA's cursor inverts the RGB output: physical colour EOR 7. */
const CURSOR_INVERT = 7;
/** R8 bits 6-7: cursor skew, 0-2 characters, or %11 for no cursor (6845 data sheet). */
const R8_CURSOR_SKEW_SHIFT = 6;
const CURSOR_SKEW_OFF = 3;
/** MA0-MA13. */
const MA_MASK = 0x3fff;

const BLACK = 0;

/** The parts of the 6845 a scanline needs, read as it starts. */
export interface BitmapCrtc {
  /** The MA the line starts at. */
  readonly lineStartAddress: number;
  /** RA: the scanline within its character row. */
  readonly scanline: number;
  /** Is this one of the R6 displayed rows? */
  readonly rowDisplayed: boolean;
  /** For the cursor's blink. */
  readonly fieldsSinceReset: number;
  /** R14/R15. */
  readonly cursorAddress: number;
  register(n: number): number;
}

/** The parts of the Video ULA: its control byte and its palette. */
export interface BitmapUla {
  readonly control: number;
  /** Entry 0-15's physical colour (0-7) now, flash phase included. */
  physicalColour(index: number): number;
}

export class BitmapRenderer {
  /** One physical colour (0-7: bit 0 red, bit 1 green, bit 2 blue) per 16 MHz dot, line by line. */
  readonly pixels = new Uint8Array(BITMAP_WIDTH * BITMAP_HEIGHT);
  /** Made once: shiftPixels' output (up to 16 pixels a byte) and the palette as this line reads it. */
  private readonly shifted = new Uint8Array(16);
  private readonly colours = new Uint8Array(16);

  constructor(
    private readonly peek: (address: number) => number,
    private readonly crtc: BitmapCrtc,
    private readonly ula: BitmapUla,
  ) {}

  /** Scanline `line` of the field is starting: draw it from what the 6845 and ULA say now. */
  drawLine(line: number): void {
    const control = this.ula.control;
    if ((control & ULA_CONTROL_TELETEXT) !== 0 || line >= BITMAP_HEIGHT) return;
    const pixels = this.pixels;
    const lineStart = line * BITMAP_WIDTH;
    const lineEnd = lineStart + BITMAP_WIDTH;
    const crtc = this.crtc;
    if (!crtc.rowDisplayed) {
      pixels.fill(BLACK, lineStart, lineEnd);
      return;
    }

    // The two clocks, as the ULA has them: how wide a byte and a pixel are.
    const dotsPerByte = (control & ULA_CONTROL_FAST_CLOCK) !== 0 ? DOTS_PER_BYTE_FAST : DOTS_PER_BYTE_SLOW;
    const dotsPerPixel = DOTS_PER_PIXEL[(control & ULA_CONTROL_PIXEL_RATE) >> 2];
    const pixelsPerByte = dotsPerByte / dotsPerPixel;
    // The palette won't change during the line (we draw it all at once), so look it up once.
    const colours = this.colours;
    for (let index = 0; index < 16; index++) colours[index] = this.ula.physicalColour(index);

    const r1 = crtc.register(CRTC_R1_HORIZONTAL_DISPLAYED);
    const columns = Math.min(r1, BITMAP_WIDTH / dotsPerByte);
    const ma = crtc.lineStartAddress;
    const ra = crtc.scanline;
    const shifted = this.shifted;
    let x = lineStart;
    for (let column = 0; column < columns; column++) {
      shiftPixels(this.peek(screenAddress((ma + column) & MA_MASK, ra)), pixelsPerByte, shifted);
      for (let p = 0; p < pixelsPerByte; p++) {
        const colour = colours[shifted[p] ?? 0] ?? BLACK;
        for (let d = 0; d < dotsPerPixel; d++) pixels[x++] = colour;
      }
    }
    // Display enable is low from character R1: the border.
    pixels.fill(BLACK, x, lineEnd);

    this.drawCursor(control, lineStart, ma, ra, r1, dotsPerByte);
  }

  /**
   * CUDISP is high for the character at MA = R14/R15 on R10-R11's lines, in
   * the blink's on phase, R8's skew characters late. The ULA stretches it
   * over segments 1-4 (control bits 7, 6, 5 and 5), one byte-time each.
   */
  private drawCursor(control: number, lineStart: number, ma: number, ra: number, r1: number, dotsPerByte: number): void {
    const crtc = this.crtc;
    const skew = crtc.register(CRTC_R8_INTERLACE_AND_SKEW) >> R8_CURSOR_SKEW_SHIFT;
    if (skew === CURSOR_SKEW_OFF) return;
    const r10 = crtc.register(CRTC_R10_CURSOR_START);
    if (!cursorOnScanline(r10, crtc.register(CRTC_R11_CURSOR_END), ra) || !cursorBlinkOn(r10, crtc.fieldsSinceReset)) return;
    // The cursor's character along this line, as the counter counts (no wrap: Stage 43).
    const column = (crtc.cursorAddress - ma) & MA_MASK;
    if (column >= r1) return;
    const first = column + skew;
    if ((control & ULA_CONTROL_CURSOR_SEGMENT_1) !== 0) this.invertByte(lineStart, first, dotsPerByte);
    if ((control & ULA_CONTROL_CURSOR_SEGMENT_2) !== 0) this.invertByte(lineStart, first + 1, dotsPerByte);
    if ((control & ULA_CONTROL_CURSOR_SEGMENTS_3_4) !== 0) {
      this.invertByte(lineStart, first + 2, dotsPerByte);
      this.invertByte(lineStart, first + 3, dotsPerByte);
    }
  }

  /** EOR 7 over one byte-time of the line, clipped to the buffer. */
  private invertByte(lineStart: number, column: number, dotsPerByte: number): void {
    const from = column * dotsPerByte;
    if (from >= BITMAP_WIDTH) return;
    const pixels = this.pixels;
    for (let x = lineStart + from; x < lineStart + from + dotsPerByte; x++) pixels[x] = (pixels[x] ?? 0) ^ CURSOR_INVERT;
  }
}
