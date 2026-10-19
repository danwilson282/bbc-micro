import { DiscImage, SECTOR_SIZE, TRACK_SIZE } from '../disc/disc-image';
import {
  CYCLES_PER_BYTE,
  CYCLES_PER_REVOLUTION,
  CYCLES_PER_SECTOR,
  DATA_FIELD_START,
  DiscDrive,
  cyclesUntil,
} from './disc-drive';

function ssd(tracks = 40): DiscImage {
  return DiscImage.fromBytes(Uint8Array.from({ length: tracks * TRACK_SIZE }, (_, i) => (i >> 8) & 0xff), 'ssd', 't.ssd');
}

describe('the disc turns: timing constants for a 300 rpm single-density drive', () => {
  it('one revolution is 200 ms: 400,000 cycles of the 2 MHz CPU', () => {
    expect(CYCLES_PER_REVOLUTION).toBe(400_000);
  });

  it('a byte passes the head every 64 µs (FM at 125 kbit/s): 128 cycles', () => {
    expect(CYCLES_PER_BYTE).toBe(128);
  });

  it('ten sectors share a revolution: 40,000 cycles each, with room for the ID, 256 data bytes and the CRC', () => {
    expect(CYCLES_PER_SECTOR * 10).toBe(CYCLES_PER_REVOLUTION);
    expect(DATA_FIELD_START + (SECTOR_SIZE + 2) * CYCLES_PER_BYTE).toBeLessThan(CYCLES_PER_SECTOR);
  });

  it('cyclesUntil says how long until a point on the track comes round, wrapping at the index hole', () => {
    expect(cyclesUntil(0, 40_000)).toBe(40_000);
    expect(cyclesUntil(50_000, 40_000)).toBe(390_000);
    expect(cyclesUntil(400_000 * 3 + 39_999, 40_000)).toBe(1);
    expect(cyclesUntil(40_000, 40_000)).toBe(0);
  });
});

describe('DiscDrive: the disc and the READY line', () => {
  it('an empty drive is not ready and not write protected', () => {
    const d = new DiscDrive();
    expect(d.ready).toBe(false);
    expect(d.writeProtected).toBe(false);
    expect(d.disc).toBeUndefined();
  });

  it('with a disc in it is ready, and not write protected unless the disc has its tab on (Stage 51)', () => {
    const d = new DiscDrive();
    d.insert(ssd());
    expect(d.ready).toBe(true);
    expect(d.writeProtected).toBe(false);
    d.insert(ssd(), true);
    expect(d.writeProtected).toBe(true);
  });

  it('the tab can go on and off with the disc in, and it goes with the disc when it is ejected', () => {
    const d = new DiscDrive();
    d.insert(ssd());
    d.setWriteProtected(true);
    expect(d.writeProtected).toBe(true);
    d.setWriteProtected(false);
    expect(d.writeProtected).toBe(false);
    d.setWriteProtected(true);
    d.eject();
    expect(d.writeProtected).toBe(false);
  });

  it('writeByte changes the disc in the drive, and does nothing with no disc', () => {
    const d = new DiscDrive();
    const disc = ssd();
    d.insert(disc);
    d.writeByte(0x300, 0xab);
    expect(disc.byteAt(0x300)).toBe(0xab);
    d.eject();
    expect(() => {
      d.writeByte(0x300, 0xcd);
    }).not.toThrow();
  });

  it('eject takes the disc out: not ready again', () => {
    const d = new DiscDrive();
    d.insert(ssd());
    d.eject();
    expect(d.ready).toBe(false);
  });
});

describe('DiscDrive: the head', () => {
  it('starts on track 0, where TRK0 is raised', () => {
    const d = new DiscDrive();
    expect(d.headTrack).toBe(0);
    expect(d.track0).toBe(true);
  });

  it('each step moves it one track in (+1) or out (-1); TRK0 goes away off track 0', () => {
    const d = new DiscDrive();
    d.step(1);
    d.step(1);
    expect(d.headTrack).toBe(2);
    expect(d.track0).toBe(false);
    d.step(-1);
    expect(d.headTrack).toBe(1);
  });

  it('stops at the end stops: it cannot go outside track 0 or past track 79', () => {
    const d = new DiscDrive();
    d.step(-1);
    expect(d.headTrack).toBe(0);
    for (let i = 0; i < 100; i++) d.step(1);
    expect(d.headTrack).toBe(79);
  });

  it('the head stays where it is when the disc is changed', () => {
    const d = new DiscDrive();
    d.step(1);
    d.insert(ssd());
    d.eject();
    expect(d.headTrack).toBe(1);
  });
});

describe('DiscDrive: finding sectors under the head', () => {
  it('sectorOffset is where the sector on the head\'s track starts in the image', () => {
    const d = new DiscDrive();
    d.insert(ssd());
    d.step(1);
    expect(d.sectorOffset(0, 3)).toBe(TRACK_SIZE + 3 * SECTOR_SIZE);
    expect(d.byteAt(d.sectorOffset(0, 3))).toBe(13); // the 13th sector's number, from ssd()'s pattern
  });

  it('sectorOffset is -1 for a sector the track hasn\'t got: sector 10, side 1 of an ssd, past the last track, no disc', () => {
    const d = new DiscDrive();
    expect(d.sectorOffset(0, 0)).toBe(-1);
    d.insert(ssd(40));
    expect(d.sectorOffset(0, 10)).toBe(-1);
    expect(d.sectorOffset(1, 0)).toBe(-1);
    for (let i = 0; i < 40; i++) d.step(1);
    expect(d.sectorOffset(0, 0)).toBe(-1); // track 40 of a 40-track disc
  });

  it('a .dsd has both sides', () => {
    const d = new DiscDrive();
    d.insert(DiscImage.fromBytes(new Uint8Array(2 * 40 * TRACK_SIZE), 'dsd', 't.dsd'));
    expect(d.sectorOffset(1, 0)).toBe(TRACK_SIZE);
  });
});
