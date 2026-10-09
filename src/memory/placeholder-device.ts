// A device that's there on the real board but not built yet.
//
// It keeps a SHEILA slot's place, so the decoding is right now and the I/O
// log can say which chip was touched. It ignores writes. On a read it
// drives nothing, so the CPU gets whatever the data lines still hold: the
// floating bus (see BbcMemoryMap.dataBus). When the real chip arrives (the
// System VIA in Stage 24, say) it takes over the slot.

import type { IoDevice } from './io-device';

/** Where a floating read comes from: the last byte that crossed the data bus. */
export interface DataBus {
  readonly dataBus: number;
}

export class PlaceholderDevice implements IoDevice {
  constructor(
    /** The chip it stands in for, e.g. "6522 VIA". */
    readonly name: string,
    private readonly bus: DataBus,
  ) {}

  /** Drives nothing: the read sees the floating bus. */
  read(): number {
    return this.bus.dataBus;
  }

  /** Nothing listens yet. */
  write(): void {
    // Ignored, like a write to a chip that isn't fitted.
  }

  peek(): number {
    return this.bus.dataBus;
  }
}
