import { encodeWav } from './wav';

// A WAV file: a 44-byte RIFF header, then signed 16-bit little-endian samples.

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

describe('encodeWav: 16-bit mono PCM', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 44_100);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  it('is 44 header bytes plus 2 bytes a sample', () => {
    expect(wav).toHaveLength(44 + 4 * 2);
  });

  it('starts "RIFF", size, "WAVE"; the size counts everything after the first 8 bytes', () => {
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
  });

  it('the "fmt " chunk says PCM (1), 1 channel, 44,100 Hz (&AC44), 88,200 bytes/s, 2-byte frames, 16 bits', () => {
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(0xac44);
    expect(Array.from(wav.subarray(24, 28))).toEqual([0x44, 0xac, 0x00, 0x00]);
    expect(view.getUint32(28, true)).toBe(88_200);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('the "data" chunk holds the samples scaled by 32,767: 0, &7FFF, &8001, &4000', () => {
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + 2 * i, true))).toEqual([0, 32_767, -32_767, 16_384]);
    expect(Array.from(wav.subarray(46, 48))).toEqual([0xff, 0x7f]);
  });

  it('samples beyond ±1 are clipped, not wrapped', () => {
    const loud = encodeWav(new Float32Array([2, -3]), 8_000);
    const v = new DataView(loud.buffer, loud.byteOffset, loud.byteLength);
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([32_767, -32_767]);
  });
});
