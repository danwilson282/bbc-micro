// A stand-in IRQ device for the Part 2 playground, so the IRQ button has
// something real to do. The System VIA (Stages 24-26) replaces it.
//
// A device that wants attention pulls /IRQ low and KEEPS it low until the
// CPU's handler tells it the request has been seen. The doorbell does just
// that, through one register at &FC00:
//
//   read  &FC00  &80 while ringing, &00 when quiet (bit 7, like a VIA IFR)
//   write &FC00  any value: "answered", so it stops ringing and lets go of IRQ
//
// &FC00 is in FRED (&FC00-&FCFF), the page the Model B sets aside for add-on
// hardware on the 1 MHz bus (Advanced User Guide, memory map). It's a Bus
// wrapper, like WriteRecorder:
//
//   Cpu6502 ──▶ WriteRecorder ──▶ Doorbell ──▶ TestBus

import type { Bus } from '../memory/bus';

/** The doorbell's one register, in FRED. */
export const DOORBELL = 0xfc00;
/** What &FC00 reads while ringing: bit 7 set. */
export const DOORBELL_RINGING = 0x80;

export class Doorbell implements Bus {
  private isRinging = false;

  constructor(private readonly inner: Bus) {}

  /** true while the doorbell is holding the IRQ line low. */
  get ringing(): boolean {
    return this.isRinging;
  }

  /** The IRQ button: start ringing. Already ringing is still one request. */
  ring(): void {
    this.isRinging = true;
  }

  /** Power-on state: quiet. */
  reset(): void {
    this.isRinging = false;
  }

  read(address: number): number {
    if ((address & 0xffff) === DOORBELL) return this.isRinging ? DOORBELL_RINGING : 0x00;
    return this.inner.read(address);
  }

  write(address: number, value: number): void {
    if ((address & 0xffff) === DOORBELL) {
      this.isRinging = false;
      return;
    }
    this.inner.write(address, value);
  }
}
