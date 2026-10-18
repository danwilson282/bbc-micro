import { HardwareLog, describeHardwareWrite, type HardwareWrite } from './hardware-log';

/** A clock the test can move. */
function clock(): { cycles: number } {
  return { cycles: 0 };
}

function write(device: HardwareWrite['device'], register: number, value: number): HardwareWrite {
  return { index: 1, cycles: 0, device, register, value };
}

describe('HardwareLog', () => {
  it('keeps writes in order, numbered from 1, each with the CPU cycle count when it happened', () => {
    const c = clock();
    const log = new HardwareLog(c);
    c.cycles = 100;
    log.record('crtc', 0, 0x3f);
    c.cycles = 112;
    log.record('latch', 3, 1);
    expect(log.recent()).toEqual([
      { index: 1, cycles: 100, device: 'crtc', register: 0, value: 0x3f },
      { index: 2, cycles: 112, device: 'latch', register: 3, value: 1 },
    ]);
  });

  it('is a ring: once full, the newest write overwrites the oldest, and count keeps counting', () => {
    const log = new HardwareLog(clock(), 4);
    for (let i = 0; i < 6; i++) log.record('ulaPalette', 0, i);
    expect(log.count).toBe(6);
    expect(log.recent().map((w) => [w.index, w.value])).toEqual([
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
    expect(log.recent(2).map((w) => w.index)).toEqual([5, 6]);
  });

  it('masks what it stores: registers and values are bytes', () => {
    const log = new HardwareLog(clock());
    log.record('crtc', 0x101, 0x1ff);
    expect(log.recent()[0]).toMatchObject({ register: 0x01, value: 0xff });
  });

  it('clear() empties it', () => {
    const log = new HardwareLog(clock());
    log.record('latch', 0, 0);
    log.clear();
    expect(log.count).toBe(0);
    expect(log.recent()).toEqual([]);
  });

  it('refuses a capacity that isn\'t a power of two', () => {
    expect(() => new HardwareLog(clock(), 1000)).toThrow(RangeError);
  });
});

describe('describeHardwareWrite', () => {
  it('names a CRTC register by number and by its 6845 datasheet name', () => {
    expect(describeHardwareWrite(write('crtc', 0, 0x3f))).toBe('CRTC R0=&3F (horizontal total)');
    expect(describeHardwareWrite(write('crtc', 12, 0x28))).toBe('CRTC R12=&28 (start address high)');
  });

  it('says so when the CRTC is given a register it doesn\'t have (R18-R31)', () => {
    expect(describeHardwareWrite(write('crtc', 20, 0x01))).toBe('CRTC R20=&01 (no such register)');
  });

  it('names the Video ULA\'s two registers; a palette byte is an entry and its colour, stored EOR 7', () => {
    expect(describeHardwareWrite(write('ulaControl', 0, 0x4b))).toBe('ULA ctrl=&4B');
    expect(describeHardwareWrite(write('ulaPalette', 0, 0xa7))).toBe('ULA palette=&A7 (entry &A = black)');
    expect(describeHardwareWrite(write('ulaPalette', 0, 0x26))).toBe('ULA palette=&26 (entry &2 = red)');
    expect(describeHardwareWrite(write('ulaPalette', 0, 0x8f))).toBe('ULA palette=&8F (entry &8 = black/white, flashing)');
  });

  it('names a latch bit by what it switches, reading active-low outputs the right way round', () => {
    expect(describeHardwareWrite(write('latch', 0, 1))).toBe('latch: sound WE off (bit 0 = 1)');
    expect(describeHardwareWrite(write('latch', 0, 0))).toBe('latch: sound WE on (bit 0 = 0)');
    expect(describeHardwareWrite(write('latch', 3, 0))).toBe('latch: keyboard autoscan off (bit 3 = 0)');
    expect(describeHardwareWrite(write('latch', 3, 1))).toBe('latch: keyboard autoscan on (bit 3 = 1)');
    expect(describeHardwareWrite(write('latch', 4, 1))).toBe('latch: screen size C0 = 1 (bit 4 = 1)');
    expect(describeHardwareWrite(write('latch', 6, 0))).toBe('latch: Caps Lock LED on (bit 6 = 0)');
    expect(describeHardwareWrite(write('latch', 7, 1))).toBe('latch: Shift Lock LED off (bit 7 = 1)');
  });
});
