import { Cpu6502 } from '../cpu/cpu6502';
import type { Bus } from './bus';
import { BbcMemoryMap } from './bbc-memory-map';
import type { IoDevice } from './io-device';
import { SHEILA_SLOTS } from './sheila';

/** A device that remembers every call, and reads back &A0 + the register number. */
class SpyDevice implements IoDevice {
  readonly calls: string[] = [];
  read(offset: number): number {
    this.calls.push(`read ${String(offset)}`);
    return 0xa0 + offset;
  }
  write(offset: number, value: number): void {
    this.calls.push(`write ${String(offset)} ${String(value)}`);
  }
  peek(offset: number): number {
    this.calls.push(`peek ${String(offset)}`);
    return 0xa0 + offset;
  }
}

describe('BbcMemoryMap: region routing', () => {
  it('can be used anywhere a Bus is expected', () => {
    const bus: Bus = new BbcMemoryMap();
    bus.write(0x7c00, 0x48);
    expect(bus.read(0x7c00)).toBe(0x48);
  });

  it('has 32K of RAM at &0000-&7FFF: every byte holds its own value', () => {
    const map = new BbcMemoryMap();
    for (let a = 0; a < 0x8000; a++) map.write(a, (a ^ (a >> 8)) & 0xff);
    for (let a = 0; a < 0x8000; a++) expect(map.read(a)).toBe((a ^ (a >> 8)) & 0xff);
  });

  it('masks addresses to 16 lines and values to 8: &17C00 is &7C00, &148 is stored as &48', () => {
    const map = new BbcMemoryMap();
    map.write(0x17c00, 0x148);
    expect(map.read(0x7c00)).toBe(0x48);
  });

  it('ignores a CPU write to the MOS ROM (&C000-&FBFF, &FF00-&FFFF): ROM has no write line', () => {
    const map = new BbcMemoryMap();
    map.poke(0xc000, 0x11);
    map.poke(0xfffc, 0xcd);
    map.write(0xc000, 0x99);
    map.write(0xfbff, 0x99);
    map.write(0xfffc, 0x99);
    expect(map.read(0xc000)).toBe(0x11);
    expect(map.read(0xfbff)).toBe(0xff); // a blank ROM image reads &FF
    expect(map.read(0xfffc)).toBe(0xcd);
  });

  it('starts with a blank MOS ROM image (all &FF, like an erased EPROM) until one is loaded', () => {
    const map = new BbcMemoryMap();
    expect([map.read(0xc000), map.read(0xd9cd), map.read(0xffff)]).toEqual([0xff, 0xff, 0xff]);
  });

  it('poke() writes into the ROM image, as a loader or EPROM programmer would, and read() sees it', () => {
    const map = new BbcMemoryMap();
    map.poke(0xfffc, 0x00);
    map.poke(0xfffd, 0x04);
    expect([map.read(0xfffc), map.read(0xfffd)]).toEqual([0x00, 0x04]);
  });

  it('the MOS ROM is one 16K chip: &FF00-&FFFF is its last page, not a separate one', () => {
    const map = new BbcMemoryMap();
    map.poke(0xc0ff, 0x01);
    map.poke(0xffff, 0x02);
    expect(map.peek(0xc0ff)).toBe(0x01);
    expect(map.peek(0xffff)).toBe(0x02);
  });

  it('a CPU write to the empty sideways socket (&8000-&BFFF) is lost, and so is a poke', () => {
    const map = new BbcMemoryMap();
    map.write(0x8000, 0x42);
    map.poke(0xbfff, 0x42);
    map.write(0x0000, 0x00); // put something else on the bus
    expect(map.read(0x8000)).not.toBe(0x42);
    expect(map.peek(0xbfff)).not.toBe(0x42);
  });

  it('a read of the empty sideways socket returns the floating bus: the last byte the bus carried', () => {
    const map = new BbcMemoryMap();
    map.write(0x0070, 0x5a);
    expect(map.read(0x8000)).toBe(0x5a);
    map.read(0x0070); // reads &5A again
    map.write(0x0071, 0x80);
    expect(map.read(0xbfff)).toBe(0x80);
  });

  it('LDA &8000 on the CPU reads &80: the high byte of its own address, the last byte fetched', () => {
    const map = new BbcMemoryMap();
    [0xad, 0x00, 0x80].forEach((b, i) => {
      map.write(0x0400 + i, b);
    }); // LDA &8000
    map.poke(0xfffc, 0x00);
    map.poke(0xfffd, 0x04);
    const cpu = new Cpu6502(map);
    cpu.reset();
    cpu.step();
    expect(cpu.regs.a).toBe(0x80);
  });

  it('FRED (&FC00-&FCFF) and JIM (&FD00-&FDFF) have nothing connected: reads float, writes are lost', () => {
    const map = new BbcMemoryMap();
    map.write(0xfc00, 0x33);
    expect(map.read(0xfc00)).toBe(0x33); // still floating from the write itself
    map.write(0x1000, 0x44);
    expect(map.read(0xfd80)).toBe(0x44);
  });

  it('poke() to &FC00-&FEFF goes to I/O, not to the hidden MOS bytes underneath', () => {
    const map = new BbcMemoryMap();
    map.poke(0xfc00, 0x28); // "(" from the MOS credits; FRED has nothing to take it
    map.write(0x1000, 0x00);
    expect(map.read(0xfc00)).toBe(0x00); // floating, not &28
  });
});

describe('BbcMemoryMap: SHEILA dispatch', () => {
  it('sends &FE40-&FE5F to the System VIA as registers 0-15, so &FE4E and its mirror &FE5E are both reg 14', () => {
    const via = new SpyDevice();
    const map = new BbcMemoryMap({ devices: { systemVia: via } });
    expect(map.read(0xfe44)).toBe(0xa4);
    map.write(0xfe4e, 0x7f);
    map.write(0xfe5e, 0x80);
    expect(map.read(0xfe5f)).toBe(0xaf);
    expect(via.calls).toEqual(['read 4', 'write 14 127', 'write 14 128', 'read 15']);
  });

  it('sends the User VIA (&FE60-&FE7F) to its own device, not the System VIA', () => {
    const sys = new SpyDevice();
    const user = new SpyDevice();
    const map = new BbcMemoryMap({ devices: { systemVia: sys, userVia: user } });
    map.write(0xfe60, 0x01);
    map.write(0xfe7c, 0x02);
    expect(user.calls).toEqual(['write 0 1', 'write 12 2']);
    expect(sys.calls).toEqual([]);
  });

  it.each([
    ['crtc', 0xfe00, 0], ['crtc', 0xfe07, 1],
    ['acia', 0xfe08, 0], ['acia', 0xfe0b, 1],
    ['serialUla', 0xfe10, 0], ['serialUla', 0xfe17, 0],
    ['econetId', 0xfe18, 0],
    ['videoUla', 0xfe20, 0], ['videoUla', 0xfe21, 1], ['videoUla', 0xfe2f, 1],
    ['fdc', 0xfe80, 0], ['fdc', 0xfe84, 4], ['fdc', 0xfe9c, 4],
    ['adlc', 0xfea0, 0], ['adlc', 0xfebf, 3],
    ['adc', 0xfec0, 0], ['adc', 0xfec2, 2],
    ['tube', 0xfee0, 0], ['tube', 0xfeff, 7],
  ] as const)('a write to the %s slot at %p (decimal) reaches register %p', (id, address, register) => {
    const spy = new SpyDevice();
    const map = new BbcMemoryMap({ devices: { [id]: spy } });
    map.write(address, 0x5a);
    expect(spy.calls).toEqual([`write ${String(register)} 90`]);
  });

  it('every one of the 256 SHEILA offsets reaches exactly one device (ROMSEL is the map\'s own latch)', () => {
    const others = SHEILA_SLOTS.filter((slot) => slot.id !== 'romsel');
    const spies = new Map(others.map((slot) => [slot.id, new SpyDevice()]));
    const map = new BbcMemoryMap({ devices: Object.fromEntries(spies) });
    for (let o = 0; o < 0x100; o++) map.write(0xfe00 + o, o);
    const total = [...spies.values()].reduce((sum, spy) => sum + spy.calls.length, 0);
    expect(total).toBe(256 - 16);
    for (const slot of others) expect(spies.get(slot.id)?.calls).toHaveLength(slot.size);
    expect(map.pagedRom).toBe(0x0f); // the last ROMSEL write was &3F, to &FE3F
  });

  it('a placeholder ignores writes and floats on reads: LDA &FE44 reads &FE, the high byte just fetched', () => {
    const map = new BbcMemoryMap();
    [0xad, 0x44, 0xfe].forEach((b, i) => {
      map.write(0x0400 + i, b);
    });
    map.poke(0xfffc, 0x00);
    map.poke(0xfffd, 0x04);
    const cpu = new Cpu6502(map);
    cpu.reset();
    cpu.step();
    expect(cpu.regs.a).toBe(0xfe);
  });

  it('peek() asks the device for its side-effect-free view, not read()', () => {
    const via = new SpyDevice();
    const map = new BbcMemoryMap({ devices: { systemVia: via } });
    expect(map.peek(0xfe44)).toBe(0xa4);
    expect(via.calls).toEqual(['peek 4']);
  });

  it('poke() into SHEILA writes the device (the debugger may), but read() and write() are the only ones logged', () => {
    const via = new SpyDevice();
    const map = new BbcMemoryMap({ devices: { systemVia: via } });
    map.poke(0xfe40, 0x12);
    map.peek(0xfe40);
    expect(via.calls).toEqual(['write 0 18', 'peek 0']);
    expect(map.ioLog.count).toBe(0);
  });

  it('peek() and poke() leave the floating bus alone: looking must not change what the CPU would read', () => {
    const map = new BbcMemoryMap();
    map.write(0x0070, 0x5a);
    map.poke(0x0071, 0x11);
    map.peek(0x0071);
    expect(map.dataBus).toBe(0x5a);
    expect(map.read(0x8000)).toBe(0x5a);
  });

  it('masks a device read to 8 bits', () => {
    const wide: IoDevice = { read: () => 0x1ff, write: () => undefined, peek: () => 0x1ff };
    const map = new BbcMemoryMap({ devices: { adc: wide } });
    expect(map.read(0xfec0)).toBe(0xff);
    expect(map.peek(0xfec0)).toBe(0xff);
  });
});

describe('BbcMemoryMap: the I/O log and counts', () => {
  it('logs each CPU access to &FC00-&FEFF in order, with its value and direction', () => {
    const map = new BbcMemoryMap();
    map.write(0xfe4e, 0x7f);
    map.read(0xfe44);
    map.read(0xfd00);
    map.write(0xfc10, 0x01);
    expect(map.ioLog.recent()).toEqual([
      { index: 1, address: 0xfe4e, value: 0x7f, write: true },
      { index: 2, address: 0xfe44, value: 0x7f, write: false }, // floating: the last byte was &7F
      { index: 3, address: 0xfd00, value: 0x7f, write: false },
      { index: 4, address: 0xfc10, value: 0x01, write: true },
    ]);
  });

  it('does not log RAM or ROM accesses', () => {
    const map = new BbcMemoryMap();
    map.write(0x0000, 1);
    map.read(0x8000);
    map.read(0xc000);
    map.write(0xffff, 1);
    expect(map.ioLog.count).toBe(0);
  });

  it('an INC &FE4E is three accesses to the device: read, the NMOS dummy write of the old value, then the new value', () => {
    const via = new SpyDevice();
    const map = new BbcMemoryMap({ devices: { systemVia: via } });
    [0xee, 0x4e, 0xfe].forEach((b, i) => {
      map.write(0x0400 + i, b);
    }); // INC &FE4E
    map.poke(0xfffc, 0x00);
    map.poke(0xfffd, 0x04);
    const cpu = new Cpu6502(map);
    cpu.reset();
    cpu.step();
    expect(via.calls).toEqual(['read 14', 'write 14 174', 'write 14 175']); // &AE, then &AF
    expect(map.ioLog.recent().map((e) => e.write)).toEqual([false, true, true]);
  });

  it('counts reads and writes per SHEILA slot', () => {
    const map = new BbcMemoryMap();
    const via = SHEILA_SLOTS.findIndex((s) => s.id === 'systemVia');
    map.read(0xfe44);
    map.read(0xfe54);
    map.write(0xfe4e, 0);
    expect([map.slotReads(via), map.slotWrites(via)]).toEqual([2, 1]);
    map.clearIoHistory();
    expect([map.slotReads(via), map.slotWrites(via), map.ioLog.count]).toEqual([0, 0, 0]);
  });

  it('two maps share nothing', () => {
    const a = new BbcMemoryMap();
    const b = new BbcMemoryMap();
    a.write(0x1234, 0x56);
    a.write(0xfe40, 0);
    expect(b.read(0x1234)).toBe(0x00);
    expect(b.ioLog.count).toBe(0);
  });
});

/** A 16K image whose every byte is `fill`, so slots can be told apart. */
function romFilledWith(fill: number): Uint8Array {
  return new Uint8Array(0x4000).fill(fill);
}

/** Puts `code` at &0400 and points the reset vector there. */
function cpuRunning(map: BbcMemoryMap, code: readonly number[]): Cpu6502 {
  code.forEach((b, i) => {
    map.write(0x0400 + i, b);
  });
  map.poke(0xfffc, 0x00);
  map.poke(0xfffd, 0x04);
  const cpu = new Cpu6502(map);
  cpu.reset();
  return cpu;
}

describe('BbcMemoryMap: ROMs and sideways paging', () => {
  it('loadMos puts a 16K image at &C000-&FFFF: file offset &3FFC is the reset vector at &FFFC', () => {
    const map = new BbcMemoryMap();
    const mos = new Uint8Array(0x4000);
    mos[0x0000] = 0x4c;
    mos[0x3ffc] = 0xcd;
    mos[0x3ffd] = 0xd9;
    map.loadMos(mos);
    expect([map.read(0xc000), map.read(0xfffc), map.read(0xfffd)]).toEqual([0x4c, 0xcd, 0xd9]);
  });

  it('starts with ROMSEL at 0 and all 16 slots empty', () => {
    const map = new BbcMemoryMap();
    expect(map.pagedRom).toBe(0);
    for (let slot = 0; slot < 16; slot++) expect(map.sidewaysRom(slot)).toBeUndefined();
  });

  it('a write to &FE30 pages in that slot: &8000-&BFFF then reads its ROM', () => {
    const map = new BbcMemoryMap();
    map.loadSidewaysRom(15, romFilledWith(0xbb));
    map.loadSidewaysRom(14, romFilledWith(0xdd));
    map.write(0xfe30, 15);
    expect([map.read(0x8000), map.read(0xbfff)]).toEqual([0xbb, 0xbb]);
    map.write(0xfe30, 14);
    expect([map.read(0x8000), map.read(0xbfff)]).toEqual([0xdd, 0xdd]);
    expect(map.pagedRom).toBe(14);
  });

  it('every mirror of ROMSEL (&FE30-&FE3F) pages, and only the low 4 bits count: &FE3F ← &4F selects ROM 15', () => {
    const map = new BbcMemoryMap();
    map.loadSidewaysRom(15, romFilledWith(0xbb));
    map.write(0xfe3f, 0x4f);
    expect(map.pagedRom).toBe(15);
    expect(map.read(0x8123)).toBe(0xbb);
  });

  it('a slot with no ROM floats, even when other slots are full', () => {
    const map = new BbcMemoryMap();
    map.loadSidewaysRom(15, romFilledWith(0xbb));
    map.write(0xfe30, 3);
    map.write(0x0070, 0x5a);
    expect(map.read(0x8000)).toBe(0x5a);
  });

  it('reading ROMSEL floats: the CPU cannot ask which ROM is paged in', () => {
    const map = new BbcMemoryMap();
    map.write(0xfe30, 0x0c);
    map.write(0x0070, 0x77);
    expect(map.read(0xfe30)).toBe(0x77);
    expect(map.pagedRom).toBe(0x0c);
  });

  it('the CPU cannot write to a paged ROM: the image is unchanged', () => {
    const map = new BbcMemoryMap();
    const rom = romFilledWith(0xbb);
    map.loadSidewaysRom(15, rom);
    map.write(0xfe30, 15);
    map.write(0x8000, 0x00);
    expect(map.read(0x8000)).toBe(0xbb);
    expect(rom[0]).toBe(0xbb);
  });

  it('peek sees the paged slot without side effects; poke writes into the paged image, as a tool would', () => {
    const map = new BbcMemoryMap();
    map.loadSidewaysRom(15, romFilledWith(0xbb));
    map.write(0xfe30, 15);
    expect(map.peek(0x8000)).toBe(0xbb);
    map.poke(0x8000, 0x12);
    expect(map.peek(0x8000)).toBe(0x12);
    expect(map.sidewaysRom(15)?.[0]).toBe(0x12);
  });

  it('loading a ROM into the slot that is already paged in takes effect at once', () => {
    const map = new BbcMemoryMap();
    map.write(0xfe30, 15);
    map.loadSidewaysRom(15, romFilledWith(0xbb));
    expect(map.read(0x8000)).toBe(0xbb);
    map.removeSidewaysRom(15);
    map.write(0x0070, 0x5a);
    expect(map.read(0x8000)).toBe(0x5a);
  });

  it('rejects a slot outside 0-15 and an image that is not 16K', () => {
    const map = new BbcMemoryMap();
    expect(() => {
      map.loadSidewaysRom(16, romFilledWith(0));
    }).toThrow(RangeError);
    expect(() => {
      map.loadSidewaysRom(-1, romFilledWith(0));
    }).toThrow(RangeError);
    expect(() => {
      map.loadSidewaysRom(0, new Uint8Array(0x2000));
    }).toThrow(RangeError);
    expect(() => {
      map.loadMos(new Uint8Array(100));
    }).toThrow(RangeError);
  });

  it('the CPU sees the new ROM on the very next instruction: STA &FE30 then LDA &8000', () => {
    const map = new BbcMemoryMap();
    map.loadSidewaysRom(14, romFilledWith(0xdd));
    // LDA #&0E : STA &FE30 : LDA &8000
    const cpu = cpuRunning(map, [0xa9, 0x0e, 0x8d, 0x30, 0xfe, 0xad, 0x00, 0x80]);
    cpu.step();
    cpu.step();
    cpu.step();
    expect(cpu.regs.a).toBe(0xdd);
  });

  it('the paging is logged like any other I/O write', () => {
    const map = new BbcMemoryMap();
    map.write(0xfe30, 0x0f);
    expect(map.ioLog.recent()).toEqual([{ index: 1, address: 0xfe30, value: 0x0f, write: true }]);
  });
});
