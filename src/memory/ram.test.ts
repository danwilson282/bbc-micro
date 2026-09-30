import { Ram } from './ram';

describe('Ram', () => {
  it('starts zero-filled (real DRAM powers up with junk; we choose determinism)', () => {
    const ram = new Ram(0x8000);
    for (let offset = 0; offset < ram.size; offset++) {
      expect(ram.read(offset)).toBe(0x00);
    }
  });

  it('stores a byte at each offset and reads it back, with no two offsets sharing a cell', () => {
    const ram = new Ram(0x8000);
    // A pattern that differs between neighbouring cells and between pages.
    for (let offset = 0; offset < ram.size; offset++) {
      ram.write(offset, (offset ^ (offset >> 8)) & 0xff);
    }
    for (let offset = 0; offset < ram.size; offset++) {
      expect(ram.read(offset)).toBe((offset ^ (offset >> 8)) & 0xff);
    }
  });

  it('keeps only the low 8 bits of a written value, like 8 data lines', () => {
    const ram = new Ram(0x100);
    ram.write(0x00, 0x148);
    ram.write(0x01, -1);
    ram.write(0x02, 0x100);
    expect(ram.read(0x00)).toBe(0x48);
    expect(ram.read(0x01)).toBe(0xff);
    expect(ram.read(0x02)).toBe(0x00);
  });

  it('ignores address lines above its size, so a 32K chip mirrors: &8005 is &0005', () => {
    const ram = new Ram(0x8000);
    ram.write(0x8005, 0xaa);
    expect(ram.read(0x0005)).toBe(0xaa);
    ram.write(0x0006, 0x55);
    expect(ram.read(0x8006)).toBe(0x55);
    expect(ram.read(0xfffe)).toBe(ram.read(0x7ffe));
  });

  it('load() copies bytes in order starting at an offset', () => {
    const ram = new Ram(0x100);
    ram.load(0x10, [0x48, 0x49, 0x1ff]);
    expect(ram.read(0x10)).toBe(0x48);
    expect(ram.read(0x11)).toBe(0x49);
    expect(ram.read(0x12)).toBe(0xff);
  });

  it('load() wraps past the end of the chip back to offset 0', () => {
    const ram = new Ram(0x100);
    ram.load(0xff, [0x01, 0x02]);
    expect(ram.read(0xff)).toBe(0x01);
    expect(ram.read(0x00)).toBe(0x02);
  });

  it.each([0, -1, 3, 0x7fff, 1.5, 0x20000])(
    'rejects a size of %p (must be a power of two from 1 to 64K)',
    (size) => {
      expect(() => new Ram(size)).toThrow(RangeError);
    },
  );
});
