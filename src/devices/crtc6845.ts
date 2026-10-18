// The 6845 CRTC's register file (Stage 37). Replaces the Stage 28 stub.
//
// Eighteen registers, R0-R17, behind two addresses. The chip has one
// register-select pin (RS), wired to address bit 0, so &FE00-&FE07 are four
// copies of the pair (6845 data sheet, register file; Advanced User Guide,
// 6845 CRTC):
//
//   &FE00  address register (write only): which Rn the next &FE01 access reaches
//   &FE01  Rn
//
// Each register keeps only its own width (R12 is 6 bits, R5 is 5, ...). Only
// R14-R17 can be read: R0-R13 and the address register read &00, and R16/R17
// (the light pen) can't be written by the CPU. The variants the BBC was
// fitted with (HD6845SP / MC6845P) differ in small ways; we follow the AUG.
//
// Stage 38 adds the counters. One character clock moves the horizontal
// counter on; when it has matched R0 the line ends, which moves the
// scanline counter on; when that has matched R9 the row ends, and so on:
//
//   character 0 … R0 ─▶ scanline 0 … R9 ─▶ row 0 … R4 ─▶ adjust R5 lines ─▶ new field
//
// Every comparison is "equals", as on the chip, and every counter is masked
// to its real width, so a register lowered under its counter makes it run
// on round its whole range first. The comparisons switch three outputs:
// HSYNC (from R2, for R3 bits 0-3 characters), VSYNC (from row R7, for R3
// bits 4-7 lines) and display enable (characters below R1 of rows below R6).
//
// Interlaced (R8 bit 0 = 1), the fields alternate: the odd one has one more
// adjust line, and its VSYNC starts half a line late, so VSYNCs are 312½
// lines apart. In interlace sync and video (R8 bits 0-1 = %11) the scanline
// counter steps by 2 and the field's parity is its bit 0 (Stage 38 doc).
//
// tick() is the hot path: no allocation, and the clock and VSYNC callbacks
// are made once, by whoever connects them.

import type { IoDevice } from '../memory/io-device';
import type { Clocked } from './clocked';
import type { HardwareLog } from './hardware-log';

/** Register select 0 (&FE00): the address register. */
export const CRTC_ADDRESS = 0;
/** Register select 1 (&FE01): the register the address register picks. */
export const CRTC_DATA = 1;
/** R0-R17. */
export const CRTC_REGISTER_COUNT = 18;
/** The address register is 5 bits wide, so it can name R18-R31, which don't exist. */
const ADDRESS_MASK = 0x1f;

// Register numbers (6845 data sheet, register table).
export const CRTC_R0_HORIZONTAL_TOTAL = 0;
export const CRTC_R1_HORIZONTAL_DISPLAYED = 1;
export const CRTC_R2_HSYNC_POSITION = 2;
export const CRTC_R3_SYNC_WIDTHS = 3;
export const CRTC_R4_VERTICAL_TOTAL = 4;
export const CRTC_R5_VERTICAL_TOTAL_ADJUST = 5;
export const CRTC_R6_VERTICAL_DISPLAYED = 6;
export const CRTC_R7_VSYNC_POSITION = 7;
export const CRTC_R8_INTERLACE_AND_SKEW = 8;
export const CRTC_R9_MAX_SCAN_LINE = 9;
export const CRTC_R10_CURSOR_START = 10;
export const CRTC_R11_CURSOR_END = 11;
export const CRTC_R12_START_ADDRESS_HIGH = 12;
export const CRTC_R13_START_ADDRESS_LOW = 13;
export const CRTC_R14_CURSOR_ADDRESS_HIGH = 14;
export const CRTC_R15_CURSOR_ADDRESS_LOW = 15;
export const CRTC_R16_LIGHT_PEN_HIGH = 16;
export const CRTC_R17_LIGHT_PEN_LOW = 17;

/**
 * The bits each register stores (6845 data sheet, register table). R8 keeps
 * bits 0-1 (interlace) and 4-7 (skew); bits 2-3 don't exist (our reading).
 */
export const CRTC_REGISTER_BITS: readonly number[] = [
  0xff, 0xff, 0xff, 0xff, // R0-R3
  0x7f, 0x1f, 0x7f, 0x7f, // R4-R7
  0xf3, 0x1f, 0x7f, 0x1f, // R8-R11
  0x3f, 0xff, 0x3f, 0xff, // R12-R15
  0x3f, 0xff, //             R16-R17
];

/** Who can do what to a register, as the CPU sees it. */
export type CrtcAccess = 'write' | 'read-write' | 'read';

/** R0-R13 write only, R14-R15 the cursor (both), R16-R17 the light pen (the chip writes them). */
export const CRTC_REGISTER_ACCESS: readonly CrtcAccess[] = [
  ...new Array<CrtcAccess>(14).fill('write'),
  'read-write',
  'read-write',
  'read',
  'read',
];

/** Told VSYNC's new level (pin 40): 1 high, 0 low. Only on a change. */
export type VsyncListener = (level: 0 | 1) => void;

/** Is the character clock 2 MHz now (true) or 1 MHz (false)? The Video ULA decides (control bit 4). */
export type CharacterClock = () => boolean;

/** Until something connects a clock, it's 2 MHz: one character per CPU cycle. */
const twoMhz: CharacterClock = () => true;

/** R3 bits 4-7 = 0 means a 16-line VSYNC (6845 data sheet, R3). */
const VSYNC_WIDTH_ZERO_LINES = 16;

export class Crtc6845 implements IoDevice, Clocked {
  private address = 0;
  private readonly r = new Uint8Array(CRTC_REGISTER_COUNT);

  private clock: CharacterClock = twoMhz;
  private vsyncListener: VsyncListener | undefined;
  /** A CPU cycle left over at 1 MHz: half a character. */
  private carry = 0;

  // The counters (Stage 38).
  private hc = 0;
  /** The scanline counter, without the odd field's bit 0 (see `scanline`). */
  private ra = 0;
  private vc = 0;
  /** Scanlines since the field started: not a 6845 counter, for tools and tests. */
  private line = 0;
  private adjusting = false;
  private adjustLine = 0;
  private adjustTotal = 0;
  private odd = false;

  // The outputs and the counters behind them.
  private hDisplay = true;
  private vDisplay = true;
  private hsyncOn = false;
  private hsyncLeft = 0;
  private vsyncOn = false;
  private vsyncLeft = 0;
  /** The row counter has reached R7: VSYNC starts at the next VSYNC point on the line. */
  private vsyncPending = false;
  /** Where on the line VSYNC can change: character 0, or half way along in an odd interlaced field. */
  private vsyncCharacter = 0;

  // The measurement: CPU cycles at each VSYNC rising edge.
  private elapsed = 0;
  private lastVsyncAt = -1;
  private period = 0;
  private count = 0;

  constructor(private readonly log?: HardwareLog) {}

  /** Only R14-R17 answer; everything else, the address register included, reads &00. */
  read(offset: number): number {
    if ((offset & 1) === CRTC_ADDRESS) return 0x00;
    const access = CRTC_REGISTER_ACCESS[this.address];
    if (access === 'read-write' || access === 'read') return this.r[this.address] ?? 0;
    return 0x00;
  }

  write(offset: number, value: number): void {
    const v = value & 0xff;
    if ((offset & 1) === CRTC_ADDRESS) {
      this.address = v & ADDRESS_MASK;
      return;
    }
    const access = CRTC_REGISTER_ACCESS[this.address];
    if (access === 'write' || access === 'read-write') {
      this.r[this.address] = v & (CRTC_REGISTER_BITS[this.address] ?? 0);
    }
    // As written, so the trace shows what the MOS sent even where the chip dropped bits.
    this.log?.record('crtc', this.address, v);
  }

  /** No 6845 read has a side effect, so the debugger's view is the CPU's. */
  peek(offset: number): number {
    return this.read(offset);
  }

  /** The register &FE01 reaches now. */
  get addressRegister(): number {
    return this.address;
  }

  /** What Rn holds, 0-17. For tools: the CPU can't read most of them. */
  register(n: number): number {
    return this.r[n] ?? 0;
  }

  /** R0-R17, a copy. */
  registers(): number[] {
    return Array.from(this.r);
  }

  // ── The counters (Stage 38) ────────────────────────────────────────────

  /** Where the character clock comes from: the Video ULA's control bit 4. Called every tick. */
  connectClock(clock: CharacterClock): void {
    this.clock = clock;
  }

  /** Wires VSYNC (pin 40) to something, and drives the level it has now at once. */
  connectVsync(listener: VsyncListener | undefined): void {
    this.vsyncListener = listener;
    listener?.(this.vsyncOn ? 1 : 0);
  }

  /** CPU cycles (2 MHz) → character clocks: one each at 2 MHz, one per two at 1 MHz. */
  tick(cpuCycles: number): void {
    if (this.clock()) {
      this.carry = 0;
      for (let i = 0; i < cpuCycles; i++) {
        this.elapsed += 1;
        this.clockCharacter();
      }
      return;
    }
    const halves = this.carry + cpuCycles;
    this.carry = halves & 1;
    const characters = halves >> 1;
    for (let i = 0; i < characters; i++) {
      this.elapsed += 2;
      this.clockCharacter();
    }
  }

  /**
   * /RESET: the counters to the top left of an even field, VSYNC and HSYNC
   * low (6845 data sheet: /RESET clears the counters, not the registers).
   * The measurement starts again too.
   */
  reset(): void {
    this.carry = 0;
    this.hc = 0;
    this.ra = 0;
    this.vc = 0;
    this.line = 0;
    this.adjusting = false;
    this.adjustLine = 0;
    this.adjustTotal = 0;
    this.odd = false;
    this.hDisplay = true;
    this.vDisplay = true;
    this.hsyncOn = false;
    this.hsyncLeft = 0;
    this.vsyncPending = false;
    this.vsyncLeft = 0;
    this.vsyncCharacter = 0;
    this.elapsed = 0;
    this.lastVsyncAt = -1;
    this.period = 0;
    this.count = 0;
    if (this.vsyncOn) {
      this.vsyncOn = false;
      this.vsyncListener?.(0);
    }
  }

  /** One character clock. */
  private clockCharacter(): void {
    const r = this.r;
    if (this.hc === r[CRTC_R0_HORIZONTAL_TOTAL]) {
      this.hc = 0;
      this.endOfLine();
    } else {
      this.hc = (this.hc + 1) & 0xff;
    }
    const hc = this.hc;
    if (hc === 0) this.hDisplay = true;
    if (hc === r[CRTC_R1_HORIZONTAL_DISPLAYED]) this.hDisplay = false;

    if (this.hsyncOn && --this.hsyncLeft === 0) this.hsyncOn = false;
    if (hc === r[CRTC_R2_HSYNC_POSITION]) {
      // Width 0: no pulse (the MC6845 reading; Stage 38 doc).
      const width = r[CRTC_R3_SYNC_WIDTHS] & 0x0f;
      if (width > 0) {
        this.hsyncOn = true;
        this.hsyncLeft = width;
      }
    }

    if (hc === this.vsyncCharacter) this.vsyncPoint();
  }

  /** The horizontal counter has wrapped: the next scanline, row or field. */
  private endOfLine(): void {
    const r = this.r;
    const r8 = r[CRTC_R8_INTERLACE_AND_SKEW];
    this.line++;

    if (this.adjusting) {
      this.adjustLine++;
      if (this.adjustLine === this.adjustTotal) this.newField();
      else this.lineStart();
      return;
    }

    // Interlace sync and video: the counter steps by 2, and R9's bit 0 is ignored.
    const video = (r8 & 0x03) === 0x03;
    const r9 = r[CRTC_R9_MAX_SCAN_LINE];
    const rowEnds = video ? this.ra >> 1 === r9 >> 1 : this.ra === r9;
    if (!rowEnds) {
      this.ra = (this.ra + (video ? 2 : 1)) & 0x1f;
      this.lineStart();
      return;
    }

    if (this.vc === r[CRTC_R4_VERTICAL_TOTAL]) {
      // The last row is done. An interlaced odd field gets one more line: the half line, twice.
      this.adjustTotal = r[CRTC_R5_VERTICAL_TOTAL_ADJUST] + ((r8 & 0x01) === 1 && this.odd ? 1 : 0);
      if (this.adjustTotal === 0) {
        this.newField();
        return;
      }
      this.adjusting = true;
      this.adjustLine = 0;
      this.lineStart();
      return;
    }

    this.vc = (this.vc + 1) & 0x7f;
    this.ra = 0;
    this.rowStart();
    this.lineStart();
  }

  private newField(): void {
    this.line = 0;
    this.vc = 0;
    this.ra = 0;
    this.adjusting = false;
    this.odd = !this.odd;
    this.vDisplay = true;
    this.rowStart();
    this.lineStart();
  }

  /** The row counter has a new value: the vertical comparisons. */
  private rowStart(): void {
    if (this.vc === this.r[CRTC_R6_VERTICAL_DISPLAYED]) this.vDisplay = false;
    if (this.vc === this.r[CRTC_R7_VSYNC_POSITION]) this.vsyncPending = true;
  }

  /** Where on this line VSYNC may change: half way along in an odd interlaced field. */
  private lineStart(): void {
    const interlaced = (this.r[CRTC_R8_INTERLACE_AND_SKEW] & 0x01) === 1;
    this.vsyncCharacter = interlaced && this.odd ? (this.r[CRTC_R0_HORIZONTAL_TOTAL] + 1) >> 1 : 0;
  }

  /** Once a line, at vsyncCharacter: VSYNC starts, or counts down a line. */
  private vsyncPoint(): void {
    if (this.vsyncPending) {
      this.vsyncPending = false;
      this.vsyncLeft = this.r[CRTC_R3_SYNC_WIDTHS] >> 4 || VSYNC_WIDTH_ZERO_LINES;
      if (this.vsyncOn) return;
      this.vsyncOn = true;
      this.count++;
      if (this.lastVsyncAt >= 0) this.period = this.elapsed - this.lastVsyncAt;
      this.lastVsyncAt = this.elapsed;
      this.vsyncListener?.(1);
      return;
    }
    if (this.vsyncOn && --this.vsyncLeft === 0) {
      this.vsyncOn = false;
      this.vsyncListener?.(0);
    }
  }

  // ── What the counters say, for tools and tests ─────────────────────────

  /** The horizontal counter: the character along the line. */
  get character(): number {
    return this.hc;
  }

  /** The row address (RA) the chip outputs: the scanline counter, with the odd field's 1 in bit 0 in interlace sync and video. */
  get scanline(): number {
    const video = (this.r[CRTC_R8_INTERLACE_AND_SKEW] & 0x03) === 0x03;
    return video && this.odd ? this.ra | 1 : this.ra;
  }

  /** The row counter. */
  get row(): number {
    return this.vc;
  }

  /** Scanlines since this field began (0-311, or 0-312 in an odd interlaced field). */
  get fieldLine(): number {
    return this.line;
  }

  /** In the R5 extra lines after the last row? */
  get inAdjust(): boolean {
    return this.adjusting;
  }

  /** The field's parity: it flips every field. Only interlace cares. */
  get oddField(): boolean {
    return this.odd;
  }

  get hsync(): boolean {
    return this.hsyncOn;
  }

  get vsync(): boolean {
    return this.vsyncOn;
  }

  /** DISPEN, before any R8 skew (Stages 39/42): a displayed character of a displayed row. */
  get displayEnable(): boolean {
    return this.hDisplay && this.vDisplay;
  }

  /** VSYNC rising edges since reset(). */
  get vsyncCount(): number {
    return this.count;
  }

  /** CPU cycles between the last two VSYNC rising edges: 40,000 is 50 Hz. 0 until there have been two. */
  get vsyncPeriodCycles(): number {
    return this.period;
  }
}
