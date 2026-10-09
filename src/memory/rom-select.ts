// ROMSEL, the paged ROM select latch at &FE30-&FE3F (Advanced User Guide,
// SHEILA address list: "paged ROM select register, write only").
//
// A write stores the low 4 bits of the data bus: the number, 0-15, of the
// sideways ROM the CPU sees at &8000-&BFFF. The Model B doesn't store bits
// 4-7. Nothing drives the data bus when the CPU reads it, so a read floats,
// and that's why the MOS keeps a copy of the number in RAM at &F4.
//
// The latch doesn't hold the ROMs. It tells its owner (the memory map) which
// slot was picked, and the owner swaps which image answers &8000-&BFFF.

import type { IoDevice } from './io-device';
import type { DataBus } from './placeholder-device';

/** The bits of a ROMSEL write that the Model B keeps. */
export const ROMSEL_SLOT_MASK = 0x0f;

export class RomSelect implements IoDevice {
  /** Power-on contents are unknown on the real latch; we start at 0. The MOS sets it at reset. */
  private latch = 0;

  constructor(
    private readonly bus: DataBus,
    /** Called with the new slot number on every write. */
    private readonly onSelect: (slot: number) => void,
  ) {}

  /** The latched slot, 0-15. The CPU can't read this; debuggers can. */
  get slot(): number {
    return this.latch;
  }

  /** Write only: the CPU sees the floating bus. */
  read(): number {
    return this.bus.dataBus;
  }

  /** Every register in the slot is the same latch: &FE30 and &FE3F both page. */
  write(_offset: number, value: number): void {
    this.latch = value & ROMSEL_SLOT_MASK;
    this.onSelect(this.latch);
  }

  peek(): number {
    return this.bus.dataBus;
  }
}
