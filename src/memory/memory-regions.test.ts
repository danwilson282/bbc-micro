import { hex16 } from '../util/bits';
import { MEMORY_REGIONS, regionOf } from './memory-regions';

describe('the Model B memory map', () => {
  it('covers all 64K in address order, with no gaps or overlaps', () => {
    let next = 0x0000;
    for (const region of MEMORY_REGIONS) {
      expect(region.start).toBe(next);
      next = region.end + 1;
    }
    expect(next).toBe(0x10000);
  });

  it.each(([
    [0x0000, 'ram'], [0x7fff, 'ram'],
    [0x8000, 'sideways'], [0xbfff, 'sideways'],
    [0xc000, 'mos'], [0xfbff, 'mos'],
    [0xfc00, 'fred'], [0xfcff, 'fred'],
    [0xfd00, 'jim'], [0xfdff, 'jim'],
    [0xfe00, 'sheila'], [0xfeff, 'sheila'],
    [0xff00, 'mos'], [0xffff, 'mos'],
  ] as const).map(([address, region]) => [hex16(address), address, region] as const))('&%s is %s', (_hex, address, region) => {
    expect(regionOf(address)).toBe(region);
  });

  it('agrees with the region table for every address', () => {
    for (const region of MEMORY_REGIONS) {
      for (let a = region.start; a <= region.end; a += 0x40) expect(regionOf(a)).toBe(region.id);
    }
  });

  it('masks to 16 address lines: &1FE40 is SHEILA', () => {
    expect(regionOf(0x1fe40)).toBe('sheila');
  });
});
