// The Video ULA (Stage 40): Acorn's own chip between screen RAM and the RGB
// socket. Two write-only registers (Advanced User Guide §19.3), with only A0
// decoded, so they repeat through &FE20-&FE2F:
//
//   &FE20  video control
//            bits 7-5  cursor segments: 7 = segment 1, 6 = segment 2, 5 = segments 3 and 4
//            bit  4    6845 clock: 0 = 1 MHz, 1 = 2 MHz (the byte clock)
//            bits 3-2  pixel clock ("characters per line"): 2, 4, 8, 16 MHz (10, 20, 40, 80)
//            bit  1    teletext: the SAA5050's RGB instead of our own pixels
//            bit  0    flash phase: 1 inverts every flashing palette entry
//
//   &FE21  palette: top nibble = entry 0-15, bottom nibble = flash bit (3)
//          and the physical colour EOR 7 (bits 2-0). The MOS inverts at &EA11.
//
// Pixels a byte = pixel clock ÷ byte clock: MODE 1's &D8 is 8 MHz ÷ 2 MHz = 4,
// so 2 bits a pixel. Which bits of the byte form the 4-bit palette index is
// Stage 41; drawing it is Stage 42. Here, the registers and what they mean.
//
// Like the real chip it never drives the data bus, so a read sees whatever
// the bus last carried. That's why the MOS keeps copies at &0248 and &0249.

import type { IoDevice } from '../memory/io-device';
import type { DataBus } from '../memory/placeholder-device';
import type { HardwareLog } from './hardware-log';

/** Register select 0 (&FE20). */
export const ULA_CONTROL = 0;
/** Register select 1 (&FE21). */
export const ULA_PALETTE = 1;

/** &FE20 bit 0: flashing palette entries show their second colour. */
export const ULA_CONTROL_FLASH = 0x01;
/** &FE20 bit 1: the RGB output comes from the SAA5050 (MODE 7). */
export const ULA_CONTROL_TELETEXT = 0x02;
/** &FE20 bits 3-2: the pixel clock, which the AUG names "number of characters per line". */
export const ULA_CONTROL_PIXEL_RATE = 0x0c;
/** &FE20 bit 4: the 6845's character clock is 2 MHz, not 1 MHz. */
export const ULA_CONTROL_FAST_CLOCK = 0x10;
/** &FE20 bit 5: cursor segments 3 and 4. */
export const ULA_CONTROL_CURSOR_SEGMENTS_3_4 = 0x20;
/** &FE20 bit 6: cursor segment 2. */
export const ULA_CONTROL_CURSOR_SEGMENT_2 = 0x40;
/** &FE20 bit 7: cursor segment 1. */
export const ULA_CONTROL_CURSOR_SEGMENT_1 = 0x80;

/** &FE21 bit 3 (of the stored nibble): this entry flashes. */
export const ULA_PALETTE_FLASH = 0x08;
/** &FE21 bits 2-0: the physical colour, stored inverted. */
export const ULA_PALETTE_COLOUR = 0x07;

/** The pixel clock for bits 3-2 = %00, %01, %10, %11. */
const PIXEL_CLOCK_HZ = [2_000_000, 4_000_000, 8_000_000, 16_000_000] as const;
/** 8-pixel characters in the standard 40 µs of displayed line, for the same four values. */
const CHARACTERS_PER_LINE = [10, 20, 40, 80] as const;

/** Physical colours as the RGB socket numbers them: bit 0 red, bit 1 green, bit 2 blue. */
export const PHYSICAL_COLOUR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

export type CharactersPerLine = (typeof CHARACTERS_PER_LINE)[number];

/** The control byte, field by field. */
export interface UlaControl {
  /** Segments 1-4 (bit 7, bit 6, bit 5, bit 5): each one byte-time of cursor. */
  readonly cursorSegments: readonly [boolean, boolean, boolean, boolean];
  /** Bit 4: the 6845's clock, so the rate screen bytes arrive. */
  readonly characterClockHz: 1_000_000 | 2_000_000;
  /** Bits 3-2, as the AUG names them. */
  readonly charactersPerLine: CharactersPerLine;
  /** Bits 3-2: the rate pixels are shifted out. */
  readonly pixelClockHz: number;
  /** Pixel clock ÷ byte clock: 1, 2, 4, 8 or 16. */
  readonly pixelsPerByte: number;
  /** 8 ÷ pixels a byte: 1, 2 or 4. Undefined for the two combinations no MOS MODE uses (16 or 1 pixels a byte). */
  readonly bitsPerPixel: 1 | 2 | 4 | undefined;
  /** Bit 1. */
  readonly teletext: boolean;
  /** Bit 0. */
  readonly flash: boolean;
}

/** Decodes a control byte. Allocates: for the workbench and tests, not a per-pixel path. */
export function decodeUlaControl(control: number): UlaControl {
  const c = control & 0xff;
  const rate = (c & ULA_CONTROL_PIXEL_RATE) >> 2;
  const characterClockHz = (c & ULA_CONTROL_FAST_CLOCK) !== 0 ? 2_000_000 : 1_000_000;
  const pixelClockHz = PIXEL_CLOCK_HZ[rate] ?? PIXEL_CLOCK_HZ[0];
  const pixelsPerByte = pixelClockHz / characterClockHz;
  const segments34 = (c & ULA_CONTROL_CURSOR_SEGMENTS_3_4) !== 0;
  return {
    cursorSegments: [(c & ULA_CONTROL_CURSOR_SEGMENT_1) !== 0, (c & ULA_CONTROL_CURSOR_SEGMENT_2) !== 0, segments34, segments34],
    characterClockHz,
    charactersPerLine: CHARACTERS_PER_LINE[rate] ?? CHARACTERS_PER_LINE[0],
    pixelClockHz,
    pixelsPerByte,
    bitsPerPixel: pixelsPerByte === 8 ? 1 : pixelsPerByte === 4 ? 2 : pixelsPerByte === 2 ? 4 : undefined,
    teletext: (c & ULA_CONTROL_TELETEXT) !== 0,
    flash: (c & ULA_CONTROL_FLASH) !== 0,
  };
}

/**
 * The physical colour (0-7) a palette nibble gives: bits 2-0 EOR 7, and if
 * bit 3 marks it as flashing and the flash phase is on, inverted again.
 */
export function paletteColour(entry: number, flashPhase: boolean): number {
  const colour = (entry & ULA_PALETTE_COLOUR) ^ 0x07;
  return flashPhase && (entry & ULA_PALETTE_FLASH) !== 0 ? colour ^ 0x07 : colour;
}

export class VideoUla implements IoDevice {
  private controlByte = 0;
  /** The bottom nibble last written to each entry. Zeros at power-on (the real RAM's contents are unknown). */
  private readonly entries = new Uint8Array(16);

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
      this.entries[v >> 4] = v & 0x0f;
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

  /** Control bit 1: MODE 7's SAA5050 drives the RGB output. */
  get teletext(): boolean {
    return (this.controlByte & ULA_CONTROL_TELETEXT) !== 0;
  }

  /** Control bit 0: flashing entries are in their second colour. */
  get flash(): boolean {
    return (this.controlByte & ULA_CONTROL_FLASH) !== 0;
  }

  /** The nibble last written to entry 0-15, as stored (colour inverted). */
  paletteEntry(index: number): number {
    return this.entries[index & 0x0f] ?? 0;
  }

  /** The physical colour (0-7) entry 0-15 gives now, in this flash phase. */
  physicalColour(index: number): number {
    return paletteColour(this.entries[index & 0x0f] ?? 0, this.flash);
  }
}
