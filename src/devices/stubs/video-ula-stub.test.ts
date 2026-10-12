import type { IoDevice } from '../../memory/io-device';
import { HardwareLog } from '../hardware-log';
import { ULA_CONTROL, ULA_PALETTE, VideoUlaStub } from './video-ula-stub';

/** A data bus that last carried `value`. */
function floating(value: number): { dataBus: number } {
  return { dataBus: value };
}

describe('VideoUlaStub (storage only: the real Video ULA is Stage 40)', () => {
  it('keeps the video control byte (&FE20): MODE 7\'s &4B', () => {
    const ula = new VideoUlaStub(floating(0));
    ula.write(ULA_CONTROL, 0x4b);
    expect(ula.control).toBe(0x4b);
  });

  it('keeps one palette entry per logical colour (&FE21): the top nibble picks it, the bottom nibble is stored', () => {
    const ula = new VideoUlaStub(floating(0));
    ula.write(ULA_PALETTE, 0x07);
    ula.write(ULA_PALETTE, 0xa2);
    expect(ula.palette(0)).toBe(0x7);
    expect(ula.palette(10)).toBe(0x2);
    expect(ula.palette(5)).toBe(0x0);
  });

  it('a later palette write to the same logical colour replaces it', () => {
    const ula = new VideoUlaStub(floating(0));
    ula.write(ULA_PALETTE, 0x37);
    ula.write(ULA_PALETTE, 0x31);
    expect(ula.palette(3)).toBe(0x1);
  });

  it('is write-only: a read drives nothing and sees the floating bus, as the real chip does', () => {
    const bus = floating(0xfe);
    const ula: IoDevice = new VideoUlaStub(bus); // as the memory map sees it
    ula.write(ULA_CONTROL, 0x4b);
    expect(ula.read(ULA_CONTROL)).toBe(0xfe);
    bus.dataBus = 0x20;
    expect(ula.peek(ULA_PALETTE)).toBe(0x20);
  });

  it('reports control and palette writes to the hardware log', () => {
    const log = new HardwareLog({ cycles: 0 });
    const ula = new VideoUlaStub(floating(0), log);
    ula.write(ULA_CONTROL, 0x4b);
    ula.write(ULA_PALETTE, 0xf0);
    expect(log.recent().map((w) => [w.device, w.value])).toEqual([
      ['ulaControl', 0x4b],
      ['ulaPalette', 0xf0],
    ]);
  });
});
