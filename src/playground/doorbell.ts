// A stand-in IRQ device for the playground, so the IRQ button has something
// real to do. Since Stage 27 it's a card on the 1 MHz bus, the socket under
// the Model B for add-on hardware. The bus gives a card the FRED page
// (&FC00-&FCFF) for its registers, and its own pin on the shared /IRQ line
// (Advanced User Guide, memory map; BeebWiki "1MHz bus").
//
// A device that wants attention pulls /IRQ low and KEEPS it low until the
// CPU's handler tells it the request has been seen. The doorbell does just
// that, through one register, at the start of FRED:
//
//   read  &FC00  &80 while ringing, &00 when quiet (bit 7, like a VIA IFR)
//   write &FC00  any value: "answered", so it stops ringing and lets go of IRQ
//
// It decodes only that one address. The rest of FRED it leaves alone, so a
// read there floats, as if no card were fitted.
//
//   Cpu6502 ──▶ BbcMemoryMap ──FRED──▶ Doorbell ──irq──▶ the machine's wire-OR

import type { IrqSource } from '../devices/irq-source';
import type { IoDevice } from '../memory/io-device';
import type { DataBus } from '../memory/placeholder-device';

/** The doorbell's one register, in FRED. */
export const DOORBELL = 0xfc00;
/** Its offset within FRED: the map passes address & &FF. */
export const DOORBELL_REGISTER = DOORBELL & 0xff;
/** What &FC00 reads while ringing: bit 7 set. */
export const DOORBELL_RINGING = 0x80;
/** How the workbench names it when it holds /IRQ. */
export const DOORBELL_NAME = 'the doorbell';

export class Doorbell implements IoDevice, IrqSource {
  readonly name = DOORBELL_NAME;
  private isRinging = false;

  /** bus: where a read of an address it doesn't decode gets its byte (the floating bus). */
  constructor(private readonly bus: DataBus) {}

  /** true while the doorbell is holding the IRQ line low. */
  get ringing(): boolean {
    return this.isRinging;
  }

  /** IrqSource: the same thing, as the machine's wire-OR asks it. */
  get irq(): boolean {
    return this.isRinging;
  }

  /** The IRQ button: start ringing. Already ringing is still one request. */
  ring(): void {
    this.isRinging = true;
  }

  /** /RST on the 1 MHz bus: quiet. */
  reset(): void {
    this.isRinging = false;
  }

  read(offset: number): number {
    return this.peek(offset);
  }

  /** Reading has no side effects (it doesn't answer the bell), so peek is read. */
  peek(offset: number): number {
    if ((offset & 0xff) !== DOORBELL_REGISTER) return this.bus.dataBus;
    return this.isRinging ? DOORBELL_RINGING : 0x00;
  }

  write(offset: number): void {
    if ((offset & 0xff) === DOORBELL_REGISTER) this.isRinging = false;
  }
}
