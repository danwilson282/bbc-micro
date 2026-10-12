// STUB: a 6850 ACIA that is always idle. Serial (RS423) and cassette are out
// of scope, so this stays a stub (CLAUDE.md, Scope).
//
// Two register-select positions (6850 datasheet, "Registers"):
//
//   &FE08  read: status          write: control
//   &FE09  read: receive data    write: transmit data
//
// It exists because the MOS asks it first on every interrupt (&DCA2:
// LDA &FE08 : ... : BPL &DD06). Status bit 7 is the chip's "I'm pulling
// /IRQ low". With no chip there, the read floated to &FE, bit 7 said "yes",
// and the MOS never got as far as the System VIA: Stage 27's IRQ storm.
//
// The status is fixed at &02. Bit 7 = 0 is justified: the MOS writes
// control &56, which turns both of the chip's interrupts off, so the real
// one couldn't interrupt either. Bit 1 (TDRE) = 1 and bits 2-3 (/DCD, /CTS)
// = 0 are what an idle chip with nothing plugged in probably shows; the
// Model B's wiring of /DCD and /CTS (through the Serial ULA) is unchecked.

import type { IoDevice } from '../../memory/io-device';

/** Register select 0 (&FE08): status on a read, control on a write. */
export const ACIA_STATUS = 0;
export const ACIA_CONTROL = 0;
/** Register select 1 (&FE09): receive data on a read, transmit data on a write. */
export const ACIA_DATA = 1;

/** Status bit 1, TDRE: the transmit data register is empty (6850 datasheet, status register). */
export const ACIA_STATUS_TDRE = 0x02;
/** Status bit 7, IRQ: the chip is pulling /IRQ low. */
export const ACIA_STATUS_IRQ = 0x80;

/** Idle: transmitter empty; nothing received, no errors, carrier and clear-to-send low, not interrupting. */
export const ACIA_IDLE_STATUS = ACIA_STATUS_TDRE;

export class AciaStub implements IoDevice {
  private controlByte = 0;

  read(offset: number): number {
    return (offset & 1) === ACIA_STATUS ? ACIA_IDLE_STATUS : 0x00;
  }

  /** Keeps a control write (for tools). Transmit data goes nowhere. */
  write(offset: number, value: number): void {
    if ((offset & 1) === ACIA_CONTROL) this.controlByte = value & 0xff;
  }

  /** No side effects on a read, so peek is read. */
  peek(offset: number): number {
    return this.read(offset);
  }

  /** The last byte written to &FE08. The CPU can't read it back: a read gets the status. */
  get control(): number {
    return this.controlByte;
  }
}
