import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { BbcModelB } from '../machine/bbc-model-b';
import { MOS_ULA_CONTROL, MOS_ULA_CONTROL_TABLE, mosModesFor } from './mos-video-ula';

describe('MOS 1.20\'s Video ULA control table', () => {
  withRoms('roms/os12.rom')('is the 8 bytes at &C3F7: &9C &D8 &F4 &9C &88 &C4 &88 &4B', () => {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    const table = Array.from({ length: 8 }, (_, mode) => m.map.peek(MOS_ULA_CONTROL_TABLE + mode));
    expect(table).toEqual(MOS_ULA_CONTROL);
  });

  it('MODE 3 shares MODE 0\'s byte and MODE 6 MODE 4\'s: the difference is all in the 6845', () => {
    expect(mosModesFor(0x9c)).toEqual([0, 3]);
    expect(mosModesFor(0x88)).toEqual([4, 6]);
  });

  it('ignores the flash bit: &D9 is still MODE 1, and &4A still MODE 7', () => {
    expect(mosModesFor(0xd9)).toEqual([1]);
    expect(mosModesFor(0x4a)).toEqual([7]);
  });

  it('a byte the MOS never writes belongs to no MODE', () => {
    expect(mosModesFor(0x00)).toEqual([]);
  });
});
