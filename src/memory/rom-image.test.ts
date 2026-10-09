import { toRomImage } from './rom-image';
import { ROM_SIZE } from './memory-regions';

describe('toRomImage: fitting a ROM file to a 16K socket', () => {
  it('takes a 16K file as it is', () => {
    const bytes = new Uint8Array(ROM_SIZE).map((_, i) => i & 0xff);
    const image = toRomImage(bytes, 'basic2.rom');
    expect(image).toHaveLength(0x4000);
    expect(image[0x3fff]).toBe(0xff);
    expect(image).toEqual(bytes);
  });

  it('copies the bytes, so changing the file buffer later leaves the image alone', () => {
    const bytes = new Uint8Array(ROM_SIZE);
    const image = toRomImage(bytes, 'x.rom');
    bytes[0] = 0x42;
    expect(image[0]).toBe(0x00);
  });

  it('repeats an 8K ROM twice: the chip ignores A13, so &A000 reads the same as &8000', () => {
    const bytes = new Uint8Array(0x2000).map((_, i) => (i * 7) & 0xff);
    const image = toRomImage(bytes, 'dfs090.rom');
    expect(image).toHaveLength(0x4000);
    expect(image[0x0000]).toBe(bytes[0x0000]);
    expect(image[0x2000]).toBe(bytes[0x0000]);
    expect(image[0x3fff]).toBe(bytes[0x1fff]);
  });

  it.each([0, 100, 0x3fff, 0x4001, 0x8000])('rejects a %d-byte file with a RangeError naming it', (size) => {
    expect(() => toRomImage(new Uint8Array(size), 'odd.rom')).toThrow(RangeError);
    expect(() => toRomImage(new Uint8Array(size), 'odd.rom')).toThrow(/odd\.rom/);
  });
});
