// The hardware log: what the MOS did to the chips, by name (Stage 28).
//
// The I/O log (Stage 21) records bus accesses: "&FE01 write &3F". It can't
// say more, because the meaning lives inside the chip: which CRTC register
// &FE01 reaches depends on the last write to &FE00, and the IC32 latch isn't
// on the bus at all (it hangs off the System VIA's port B pins). So each
// device records here when something changes inside it: "CRTC register 0 set
// to &3F", "latch bit 0 set to 1".
//
// Like the trace and the I/O log, record() copies numbers into typed arrays
// arranged as a ring buffer. No words are stored: describeHardwareWrite()
// works them out when someone looks.

import { hex8 } from '../util/bits';
import { PHYSICAL_COLOUR_NAMES, ULA_PALETTE_FLASH, paletteColour } from './video-ula';

/** Who reports here. The ULA's two registers are separate, as they're unrelated. */
export type HardwareDevice = 'crtc' | 'ulaControl' | 'ulaPalette' | 'latch';

/** The order the devices are stored in, as numbers. */
const DEVICES: readonly HardwareDevice[] = ['crtc', 'ulaControl', 'ulaPalette', 'latch'];
const DEVICE_CODE: Readonly<Record<HardwareDevice, number>> = { crtc: 0, ulaControl: 1, ulaPalette: 2, latch: 3 };

/** Whatever counts the CPU's cycles: the machine. */
export interface CycleClock {
  readonly cycles: number;
}

export interface HardwareWrite {
  /** 1 for the first write since clear(), counting up. */
  readonly index: number;
  /** CPU cycles when it happened: the start of the instruction that did it. */
  readonly cycles: number;
  readonly device: HardwareDevice;
  /** CRTC register number, latch bit number, or 0 for the ULA. */
  readonly register: number;
  readonly value: number;
}

export const DEFAULT_HARDWARE_LOG_CAPACITY = 1024;

export class HardwareLog {
  private readonly mask: number;
  private readonly cycleAt: Float64Array;
  private readonly device: Uint8Array;
  private readonly register: Uint8Array;
  private readonly value: Uint8Array;
  private total = 0;

  /** capacity must be a power of two, so a mask can wrap the index. */
  constructor(
    private readonly clock: CycleClock,
    readonly capacity = DEFAULT_HARDWARE_LOG_CAPACITY,
  ) {
    if (capacity < 1 || (capacity & (capacity - 1)) !== 0) {
      throw new RangeError(`hardware log capacity must be a power of two, not ${String(capacity)}`);
    }
    this.mask = capacity - 1;
    this.cycleAt = new Float64Array(capacity);
    this.device = new Uint8Array(capacity);
    this.register = new Uint8Array(capacity);
    this.value = new Uint8Array(capacity);
  }

  /** Writes since clear(), including any that have been overwritten. */
  get count(): number {
    return this.total;
  }

  /** Called by a device when something changes inside it. Numbers only: it's inside the CPU's step. */
  record(device: HardwareDevice, register: number, value: number): void {
    const slot = this.total & this.mask;
    this.cycleAt[slot] = this.clock.cycles;
    this.device[slot] = DEVICE_CODE[device];
    this.register[slot] = register & 0xff;
    this.value[slot] = value & 0xff;
    this.total++;
  }

  /** The last `count` writes still held (at most capacity), oldest first. For display. */
  recent(count = this.capacity): HardwareWrite[] {
    const held = Math.min(count, this.capacity, this.total);
    const entries: HardwareWrite[] = [];
    for (let n = this.total - held; n < this.total; n++) {
      const slot = n & this.mask;
      entries.push({
        index: n + 1,
        cycles: this.cycleAt[slot] ?? 0,
        device: DEVICES[this.device[slot] ?? 0] ?? 'crtc',
        register: this.register[slot] ?? 0,
        value: this.value[slot] ?? 0,
      });
    }
    return entries;
  }

  clear(): void {
    this.total = 0;
  }
}

/** R0-R17 (6845 datasheet, register file). The 5-bit address register can pick R18-R31 too: nothing answers. */
export const CRTC_REGISTER_NAMES: readonly string[] = [
  'horizontal total',
  'horizontal displayed',
  'horizontal sync position',
  'sync widths',
  'vertical total',
  'vertical total adjust',
  'vertical displayed',
  'vertical sync position',
  'interlace and skew',
  'scan lines per character row',
  'cursor start',
  'cursor end',
  'start address high',
  'start address low',
  'cursor address high',
  'cursor address low',
  'light pen high',
  'light pen low',
];

/**
 * What each IC32 latch bit switches, as [when 0, when 1] (Advanced User
 * Guide, System VIA, addressable latch). Most are active low: 0 is "doing it".
 */
const LATCH_BIT_TEXT: readonly (readonly [string, string])[] = [
  ['sound WE on', 'sound WE off'],
  ['speech read select 0', 'speech read select 1'],
  ['speech write select 0', 'speech write select 1'],
  ['keyboard autoscan off', 'keyboard autoscan on'],
  ['screen size C0 = 0', 'screen size C0 = 1'],
  ['screen size C1 = 0', 'screen size C1 = 1'],
  ['Caps Lock LED on', 'Caps Lock LED off'],
  ['Shift Lock LED on', 'Shift Lock LED off'],
];

/** "entry &2 = red", or "entry &8 = black/white, flashing": the byte's colour is stored EOR 7 (Stage 40). */
function describePaletteEntry(value: number): string {
  const first = PHYSICAL_COLOUR_NAMES[paletteColour(value, false)] ?? '?';
  const entry = `entry &${(value >> 4).toString(16).toUpperCase()}`;
  if ((value & ULA_PALETTE_FLASH) === 0) return `${entry} = ${first}`;
  return `${entry} = ${first}/${PHYSICAL_COLOUR_NAMES[paletteColour(value, true)] ?? '?'}, flashing`;
}

/** e.g. "CRTC R0=&3F (horizontal total)", "ULA ctrl=&4B", "latch: sound WE off (bit 0 = 1)". */
export function describeHardwareWrite(write: HardwareWrite): string {
  const { register, value } = write;
  switch (write.device) {
    case 'crtc':
      return `CRTC R${String(register)}=&${hex8(value)} (${CRTC_REGISTER_NAMES[register] ?? 'no such register'})`;
    case 'ulaControl':
      return `ULA ctrl=&${hex8(value)}`;
    case 'ulaPalette':
      return `ULA palette=&${hex8(value)} (${describePaletteEntry(value)})`;
    case 'latch': {
      const bit = value === 0 ? 0 : 1;
      return `latch: ${LATCH_BIT_TEXT[register & 7]?.[bit] ?? '?'} (bit ${String(register & 7)} = ${String(bit)})`;
    }
  }
}
