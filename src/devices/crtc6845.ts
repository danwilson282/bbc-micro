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
// No counters yet: tick(), HSYNC, VSYNC and display enable are Stage 38.

import type { IoDevice } from '../memory/io-device';
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

export class Crtc6845 implements IoDevice {
  private address = 0;
  private readonly r = new Uint8Array(CRTC_REGISTER_COUNT);

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
}
