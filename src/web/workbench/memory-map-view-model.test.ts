import { BbcMemoryMap } from '../../memory/bbc-memory-map';
import type { IoDevice } from '../../memory/io-device';
import { buildMemoryMapView, formatSize } from './memory-map-view-model';

describe('buildMemoryMapView: regions', () => {
  it('lists the seven parts of the Model B map in address order, with sizes and shares of the 64K', () => {
    const view = buildMemoryMapView(new BbcMemoryMap());
    expect(view.regions.map((r) => `${r.range} ${r.size} ${r.name}`)).toEqual([
      '&0000-&7FFF 32K RAM',
      '&8000-&BFFF 16K Sideways ROM',
      '&C000-&FBFF 15K MOS ROM',
      '&FC00-&FCFF 256 bytes FRED',
      '&FD00-&FDFF 256 bytes JIM',
      '&FE00-&FEFF 256 bytes SHEILA',
      '&FF00-&FFFF 256 bytes MOS ROM',
    ]);
    expect(view.regions.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1);
    expect(view.regions[0]?.share).toBe(0.5);
  });

  it('marks the region PC is in', () => {
    const view = buildMemoryMapView(new BbcMemoryMap(), { pc: 0xd9cd });
    expect(view.regions.filter((r) => r.hasPc).map((r) => r.range)).toEqual(['&C000-&FBFF']);
  });

  it('formats sizes in K when whole, bytes otherwise', () => {
    expect([formatSize(0x8000), formatSize(0x3c00), formatSize(0x100)]).toEqual(['32K', '15K', '256 bytes']);
  });
});

describe('buildMemoryMapView: SHEILA slots', () => {
  it('shows each slot with its registers and mirrors, as a placeholder until its stage', () => {
    const view = buildMemoryMapView(new BbcMemoryMap());
    const via = view.slots.find((s) => s.id === 'systemVia');
    expect(via).toMatchObject({ range: '&FE40-&FE5F', name: 'System VIA', registers: '16, ×2', device: 'placeholder (Stages 24-28)', isPlaceholder: true });
    expect(view.slots.find((s) => s.id === 'romsel')?.registers).toBe('1, ×16');
  });

  it('says "emulated" for a real device', () => {
    const real: IoDevice = { read: () => 0, write: () => undefined, peek: () => 0 };
    const view = buildMemoryMapView(new BbcMemoryMap({ devices: { crtc: real } }));
    expect(view.slots.find((s) => s.id === 'crtc')?.device).toBe('emulated');
  });

  it('counts the CPU reads and writes of each slot', () => {
    const map = new BbcMemoryMap();
    map.write(0xfe4e, 0x7f);
    map.read(0xfe44);
    map.read(0xfe54);
    const via = buildMemoryMapView(map).slots.find((s) => s.id === 'systemVia');
    expect([via?.reads, via?.writes]).toEqual([2, 1]);
  });
});

describe('buildMemoryMapView: the I/O log', () => {
  it('says what to do when there has been no I/O', () => {
    const view = buildMemoryMapView(new BbcMemoryMap());
    expect(view.log).toEqual([]);
    expect(view.logNote).toBe('No I/O yet: Run or Step a program that touches &FC00-&FEFF.');
  });

  it('names each access with its device and register', () => {
    const map = new BbcMemoryMap();
    map.write(0xfe5e, 0x7f);
    map.read(0xfe44);
    const view = buildMemoryMapView(map);
    expect(view.log).toEqual([
      { index: 1, direction: 'W', address: '&FE5E', value: '&7F', text: 'System VIA reg 14 (IER), mirror of &FE4E' },
      { index: 2, direction: 'R', address: '&FE44', value: '&7F', text: 'System VIA reg 4 (T1C-L)' },
    ]);
    expect(view.logNote).toBe('2 accesses, oldest first.');
  });

  it('shows only the newest lines when there are more, and says so', () => {
    const map = new BbcMemoryMap();
    for (let i = 0; i < 20; i++) map.write(0xfe40, i);
    const view = buildMemoryMapView(map, { logLines: 16 });
    expect(view.log).toHaveLength(16);
    expect(view.log[0]?.index).toBe(5);
    expect(view.logNote).toBe('The last 16 of 20 accesses, oldest first.');
  });
});
