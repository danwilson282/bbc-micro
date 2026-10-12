// STUB, replaced by the real Video ULA in Stage 40.
//
// Two write-only registers (Advanced User Guide, Video ULA):
//
//   &FE20  video control: character rate, characters per line, teletext, cursor, flash
//   &FE21  palette: top nibble = logical colour 0-15, bottom nibble = its physical colour
//
// The stub stores them and decodes nothing. Like the real chip, it never
// drives the data bus, so a read sees whatever the bus last carried.

import type { IoDevice } from '../../memory/io-device';
import type { DataBus } from '../../memory/placeholder-device';
import type { HardwareLog } from '../hardware-log';

/** Register select 0 (&FE20). */
export const ULA_CONTROL = 0;
/** Register select 1 (&FE21). */
export const ULA_PALETTE = 1;

export class VideoUlaStub implements IoDevice {
  private controlByte = 0;
  /** The bottom nibble last written for each logical colour. */
  private readonly paletteEntries = new Uint8Array(16);

  constructor(
    private readonly bus: DataBus,
    private readonly log?: HardwareLog,
  ) {}

  /** Write-only chip: nothing answers, so the read floats. */
  read(): number {
    return this.bus.dataBus;
  }

  write(offset: number, value: number): void {
    const v = value & 0xff;
    if ((offset & 1) === ULA_CONTROL) {
      this.controlByte = v;
      this.log?.record('ulaControl', 0, v);
    } else {
      this.paletteEntries[v >> 4] = v & 0x0f;
      this.log?.record('ulaPalette', 0, v);
    }
  }

  peek(): number {
    return this.bus.dataBus;
  }

  /** The last byte written to &FE20. */
  get control(): number {
    return this.controlByte;
  }

  /** The bottom nibble last written for logical colour 0-15. */
  palette(logical: number): number {
    return this.paletteEntries[logical & 0x0f] ?? 0;
  }
}
