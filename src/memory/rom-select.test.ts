import { RomSelect } from './rom-select';

function latch(dataBus = 0x80): { romsel: RomSelect; selected: number[] } {
  const selected: number[] = [];
  const romsel = new RomSelect({ dataBus }, (slot) => selected.push(slot));
  return { romsel, selected };
}

describe('RomSelect: the paged ROM select latch at &FE30', () => {
  it('starts at slot 0', () => {
    expect(latch().romsel.slot).toBe(0);
  });

  it('a write latches the ROM number and tells the memory map at once', () => {
    const { romsel, selected } = latch();
    romsel.write(0, 0x0f);
    expect(romsel.slot).toBe(15);
    expect(selected).toEqual([15]);
  });

  it('keeps only the low 4 bits: writing &4E selects ROM 14, writing &FF selects ROM 15', () => {
    const { romsel, selected } = latch();
    romsel.write(0, 0x4e);
    romsel.write(0, 0xff);
    expect(selected).toEqual([14, 15]);
  });

  it('is write only: reading it gets the floating bus, not the latched number', () => {
    const { romsel } = latch(0xfe);
    romsel.write(0, 0x0c);
    expect(romsel.read()).toBe(0xfe);
    expect(romsel.peek()).toBe(0xfe);
  });

  it('a read does not change the latch', () => {
    const { romsel, selected } = latch();
    romsel.write(0, 0x03);
    romsel.read();
    expect(romsel.slot).toBe(3);
    expect(selected).toEqual([3]);
  });
});
