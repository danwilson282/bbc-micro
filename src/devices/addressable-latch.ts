// IC32: the Model B's 8-bit addressable latch, a 74LS259 (Stage 28).
//
// Eight output bits from four wires. Its inputs are the System VIA's
// PB0-PB3 pins:
//
//   PB0-PB2  A0-A2  which bit (0-7)
//   PB3      D      the value for it
//
// With its enable held low, the bit picked by A0-A2 copies D, and the other
// seven keep what they had (74LS259 datasheet, function table, "addressable
// latch"). So writing &0B to &FE40 (address 3, data 1) sets bit 3 and
// nothing else, and &03 clears it again.
//
// It has no idea it's on a VIA: it sees pin levels. The machine calls drive()
// whenever the port B pins change, from an ORB write, a DDRB write or a reset.

import type { ScreenSize } from '../video/screen-address';
import type { HardwareLog } from './hardware-log';

// The eight outputs (Advanced User Guide, System VIA, addressable latch).
// Most are active low: 0 is the "doing it" state.
/** 0 = write the byte on port A into the SN76489 (Part 10). */
export const LATCH_SOUND_WRITE_ENABLE = 0;
/** Speech chip read select (no speech chip fitted). */
export const LATCH_SPEECH_READ = 1;
/** Speech chip write select (no speech chip fitted). */
export const LATCH_SPEECH_WRITE = 2;
/** 0 = autoscan off, the CPU picks the key on PA0-PA6; 1 = the keyboard scans itself (Part 7). */
export const LATCH_KEYBOARD_ENABLE = 3;
/** C0 and C1: the screen size for hardware wrap-around (Stage 43). */
export const LATCH_SCREEN_C0 = 4;
export const LATCH_SCREEN_C1 = 5;
/** 0 = LED on (Stage 36). */
export const LATCH_CAPS_LOCK_LED = 6;
export const LATCH_SHIFT_LOCK_LED = 7;

/** A0-A2: the bit number. */
const ADDRESS_MASK = 0x07;
/** D, on PB3. */
const DATA_BIT = 0x08;

export class AddressableLatch {
  private q = 0;

  constructor(private readonly log?: HardwareLog) {}

  /** Q7-Q0 as a byte. */
  get value(): number {
    return this.q;
  }

  /** One output, 0 or 1. */
  bit(n: number): 0 | 1 {
    return (this.q >> (n & ADDRESS_MASK)) & 1 ? 1 : 0;
  }

  /** The input pins (PB0-PB3; higher bits are ignored) are now these levels: the addressed bit takes D. */
  drive(pins: number): void {
    const n = pins & ADDRESS_MASK;
    const d = (pins & DATA_BIT) !== 0 ? 1 : 0;
    this.q = d === 1 ? this.q | (1 << n) : this.q & ~(1 << n) & 0xff;
    this.log?.record('latch', n, d);
  }

  /** C0 and C1 as the board's screen size code, (C1 << 1) | C0 (Stage 43). */
  get screenSize(): ScreenSize {
    const c0 = this.bit(LATCH_SCREEN_C0);
    if (this.bit(LATCH_SCREEN_C1) === 1) return c0 === 1 ? 3 : 2;
    return c0 === 1 ? 1 : 0;
  }

  /** All eight bits to 0. See the Stage 28 doc: whether the board clears IC32 at power-on is unconfirmed. */
  reset(): void {
    this.q = 0;
  }
}
