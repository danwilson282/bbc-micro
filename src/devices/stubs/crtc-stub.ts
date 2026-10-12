// STUB, replaced by the real 6845 CRTC in Stage 37.
//
// The 6845 has 18 registers, R0-R17, behind two addresses (6845 datasheet,
// register file):
//
//   &FE00  address register: which Rn the next data access reaches
//   &FE01  Rn := value
//
// This stub stores what it's told, so the MOS's MODE settings are kept and
// logged, and does nothing else: no counters, no sync, no reads (they give
// &00). Stage 37 adds the real read/write rules and register widths.

import type { IoDevice } from '../../memory/io-device';
import type { HardwareLog } from '../hardware-log';

/** Register select 0 (&FE00): the address register. */
export const CRTC_ADDRESS = 0;
/** Register select 1 (&FE01): the register the address register picks. */
export const CRTC_DATA = 1;
/** R0-R17. */
export const CRTC_REGISTER_COUNT = 18;
/** The address register is 5 bits wide, so it can name R18-R31, which don't exist. */
const ADDRESS_MASK = 0x1f;

export class CrtcStub implements IoDevice {
  private address = 0;
  private readonly r = new Uint8Array(CRTC_REGISTER_COUNT);

  constructor(private readonly log?: HardwareLog) {}

  /** Not the real rules yet: every read gives &00. */
  read(): number {
    return 0x00;
  }

  write(offset: number, value: number): void {
    const v = value & 0xff;
    if ((offset & 1) === CRTC_ADDRESS) {
      this.address = v & ADDRESS_MASK;
      return;
    }
    if (this.address < CRTC_REGISTER_COUNT) this.r[this.address] = v;
    this.log?.record('crtc', this.address, v);
  }

  peek(): number {
    return 0x00;
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
