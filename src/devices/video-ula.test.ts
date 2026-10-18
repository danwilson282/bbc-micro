import type { IoDevice } from '../memory/io-device';
import { HardwareLog } from './hardware-log';
import { ULA_CONTROL, ULA_PALETTE, VideoUla, decodeUlaControl, paletteColour } from './video-ula';

/** A data bus that last carried `value`. */
function floating(value: number): { dataBus: number } {
  return { dataBus: value };
}

describe('Video ULA control register (&FE20)', () => {
  it('keeps the last byte written, as the MOS\'s copy at &0248 does', () => {
    const ula = new VideoUla(floating(0));
    ula.write(ULA_CONTROL, 0x4b);
    ula.write(ULA_CONTROL, 0xd8);
    expect(ula.control).toBe(0xd8);
  });

  it('bit 1 selects teletext and bit 0 the flash phase', () => {
    const ula = new VideoUla(floating(0));
    ula.write(ULA_CONTROL, 0x4b);
    expect([ula.teletext, ula.flash]).toEqual([true, true]);
    ula.write(ULA_CONTROL, 0xd8);
    expect([ula.teletext, ula.flash]).toEqual([false, false]);
  });

  it('only A0 is decoded: &FE22 is the control register again, &FE2F the palette', () => {
    const ula = new VideoUla(floating(0));
    ula.write(0x02, 0x9c);
    ula.write(0x0f, 0x26);
    expect(ula.control).toBe(0x9c);
    expect(ula.paletteEntry(2)).toBe(0x6);
  });
});

describe('decoding the control byte', () => {
  it('MODE 1\'s &D8: 2 MHz bytes, 8 MHz pixels, so 4 pixels a byte at 2 bits each, cursor segments 1 and 2', () => {
    expect(decodeUlaControl(0xd8)).toEqual({
      cursorSegments: [true, true, false, false],
      characterClockHz: 2_000_000,
      charactersPerLine: 40,
      pixelClockHz: 8_000_000,
      pixelsPerByte: 4,
      bitsPerPixel: 2,
      teletext: false,
      flash: false,
    });
  });

  it.each([
    // MODE, control (as text and as a number), bytes/s, pixels/s, pixels a byte, bits a pixel (MOS 1.20's table at &C3F7)
    [0, '&9C', 0x9c, 2_000_000, 16_000_000, 8, 1],
    [1, '&D8', 0xd8, 2_000_000, 8_000_000, 4, 2],
    [2, '&F4', 0xf4, 2_000_000, 4_000_000, 2, 4],
    [4, '&88', 0x88, 1_000_000, 8_000_000, 8, 1],
    [5, '&C4', 0xc4, 1_000_000, 4_000_000, 4, 2],
  ])('MODE %i (%s): pixels a byte = pixel clock ÷ byte clock', (_mode, _hex, control, bytes, pixels, perByte, bits) => {
    const c = decodeUlaControl(control);
    expect([c.characterClockHz, c.pixelClockHz, c.pixelsPerByte, c.bitsPerPixel]).toEqual([bytes, pixels, perByte, bits]);
  });

  it('bits 3-2 count characters of 8 pixels in 40 µs: %00 10, %01 20, %10 40, %11 80', () => {
    expect([0x00, 0x04, 0x08, 0x0c].map((c) => decodeUlaControl(c).charactersPerLine)).toEqual([10, 20, 40, 80]);
  });

  it('cursor bits: 7 is segment 1, 6 segment 2, 5 segments 3 and 4 (MODE 2\'s &F4 uses all four; MODE 7\'s &4B only segment 2)', () => {
    expect(decodeUlaControl(0xf4).cursorSegments).toEqual([true, true, true, true]);
    expect(decodeUlaControl(0x4b).cursorSegments).toEqual([false, true, false, false]);
    expect(decodeUlaControl(0x20).cursorSegments).toEqual([false, false, true, true]);
  });

  it('the two combinations no MOS MODE uses have no bits-per-pixel: 16 pixels from a byte, or 1', () => {
    expect([decodeUlaControl(0x0c).pixelsPerByte, decodeUlaControl(0x0c).bitsPerPixel]).toEqual([16, undefined]);
    expect([decodeUlaControl(0x10).pixelsPerByte, decodeUlaControl(0x10).bitsPerPixel]).toEqual([1, undefined]);
  });
});

describe('palette (&FE21)', () => {
  it('the top nibble picks one of 16 entries, the bottom nibble is stored in it', () => {
    const ula = new VideoUla(floating(0));
    ula.write(ULA_PALETTE, 0x07);
    ula.write(ULA_PALETTE, 0xa2);
    expect(ula.paletteEntry(0)).toBe(0x7);
    expect(ula.paletteEntry(10)).toBe(0x2);
    expect(ula.paletteEntry(5)).toBe(0x0);
  });

  it('a later write to the same entry replaces it', () => {
    const ula = new VideoUla(floating(0));
    ula.write(ULA_PALETTE, 0x37);
    ula.write(ULA_PALETTE, 0x31);
    expect(ula.paletteEntry(3)).toBe(0x1);
  });

  it('colours are stored inverted: &7 is black, &6 red, &4 yellow, &0 white (the MOS EORs with 7 at &EA11)', () => {
    expect([0x7, 0x6, 0x5, 0x4, 0x3, 0x2, 0x1, 0x0].map((e) => paletteColour(e, false))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('bit 3 marks a flashing entry: the first phase shows its colour, the second its complement', () => {
    // Physical colour 9 (red/cyan) stored as 9 EOR 7 = &E.
    expect(paletteColour(0xe, false)).toBe(1);
    expect(paletteColour(0xe, true)).toBe(6);
  });

  it('a steady entry ignores the flash phase', () => {
    expect(paletteColour(0x6, true)).toBe(1);
  });

  it('physicalColour follows control bit 0: every flashing entry changes at once', () => {
    const ula = new VideoUla(floating(0));
    ula.write(ULA_PALETTE, 0x8f); // entry 8: physical 8 (black/white) EOR 7
    ula.write(ULA_PALETTE, 0x9e); // entry 9: physical 9 (red/cyan) EOR 7
    ula.write(ULA_PALETTE, 0x16); // entry 1: steady red
    ula.write(ULA_CONTROL, 0xf4);
    expect([8, 9, 1].map((e) => ula.physicalColour(e))).toEqual([0, 1, 1]);
    ula.write(ULA_CONTROL, 0xf5);
    expect([8, 9, 1].map((e) => ula.physicalColour(e))).toEqual([7, 6, 1]);
  });

  it('powers up as zeros (the MOS doesn\'t write it in MODE 7), which decodes as white', () => {
    const ula = new VideoUla(floating(0));
    expect(ula.physicalColour(0)).toBe(7);
  });
});

describe('the bus side', () => {
  it('is write-only: a read drives nothing and sees the floating bus', () => {
    const bus = floating(0xfe);
    const ula: IoDevice = new VideoUla(bus); // as the memory map sees it
    ula.write(ULA_CONTROL, 0x4b);
    expect(ula.read(ULA_CONTROL)).toBe(0xfe);
    bus.dataBus = 0x20;
    expect(ula.peek(ULA_PALETTE)).toBe(0x20);
  });

  it('masks writes to a byte', () => {
    const ula = new VideoUla(floating(0));
    ula.write(ULA_CONTROL, 0x14b);
    expect(ula.control).toBe(0x4b);
  });

  it('reports control and palette writes to the hardware log', () => {
    const log = new HardwareLog({ cycles: 0 });
    const ula = new VideoUla(floating(0), log);
    ula.write(ULA_CONTROL, 0x4b);
    ula.write(ULA_PALETTE, 0xf0);
    expect(log.recent().map((w) => [w.device, w.value])).toEqual([
      ['ulaControl', 0x4b],
      ['ulaPalette', 0xf0],
    ]);
  });
});
