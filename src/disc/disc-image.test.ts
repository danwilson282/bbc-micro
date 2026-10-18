import {
  DiscImage,
  SECTOR_SIZE,
  SECTORS_PER_TRACK,
  TRACK_SIZE,
  formatFromName,
  maxImageSize,
  sectorOffset,
} from './disc-image';

/** Each byte is its offset's low byte XOR its sector index's low byte, so a slip of a byte or a sector shows. */
function patterned(length: number): Uint8Array {
  return new Uint8Array(length).map((_, i) => (i ^ (i >> 8)) & 0xff);
}

describe('disc geometry constants (Acorn DFS, single density)', () => {
  it('has 10 sectors of 256 bytes, so a track holds &A00 bytes', () => {
    expect(SECTOR_SIZE).toBe(0x100);
    expect(SECTORS_PER_TRACK).toBe(10);
    expect(TRACK_SIZE).toBe(0xa00);
  });

  it.each([
    ['ssd', 102_400, 204_800],
    ['dsd', 204_800, 409_600],
  ] as const)('a full %s is %d bytes at 40 tracks and %d at 80', (format, forty, eighty) => {
    expect(maxImageSize(format, 40)).toBe(forty);
    expect(maxImageSize(format, 80)).toBe(eighty);
  });
});

describe('sectorOffset: .ssd stores one side, track after track', () => {
  it.each([
    [0, 0, 0x00000],
    [0, 1, 0x00100],
    [0, 9, 0x00900],
    [1, 0, 0x00a00],
    [5, 3, 0x03500],
    [39, 9, 0x18f00],
    [79, 9, 0x31f00],
  ])('track %d sector %d starts at offset %d', (track, sector, offset) => {
    expect(sectorOffset('ssd', 0, track, sector)).toBe(offset);
  });
});

describe('sectorOffset: .dsd interleaves the two sides one track at a time', () => {
  it.each([
    [0, 0, 0, 0x00000],
    [1, 0, 0, 0x00a00],
    [0, 1, 0, 0x01400],
    [1, 1, 0, 0x01e00],
    [0, 5, 3, 0x06700],
    [1, 5, 3, 0x07100],
    [1, 79, 9, 0x63f00],
  ])('side %d track %d sector %d starts at offset %d', (side, track, sector, offset) => {
    expect(sectorOffset('dsd', side, track, sector)).toBe(offset);
  });

  it('side 1 of a track sits exactly one track (&A00) after side 0 of the same track', () => {
    for (let track = 0; track < 80; track++) {
      expect(sectorOffset('dsd', 1, track, 0) - sectorOffset('dsd', 0, track, 0)).toBe(TRACK_SIZE);
    }
  });

  it('visits every sector of an 80-track dsd exactly once, covering the file with no gaps', () => {
    const seen = new Set<number>();
    for (let side = 0; side < 2; side++) {
      for (let track = 0; track < 80; track++) {
        for (let sector = 0; sector < 10; sector++) seen.add(sectorOffset('dsd', side, track, sector));
      }
    }
    expect(seen.size).toBe(1600);
    expect(Math.max(...seen)).toBe(409_600 - SECTOR_SIZE);
    for (const offset of seen) expect(offset % SECTOR_SIZE).toBe(0);
  });

  it('a 40-track dsd and an 80-track ssd are the same size but put sector &A00 on different sides', () => {
    // Same offset, two meanings: this is why the format can't be guessed from the size.
    expect(sectorOffset('ssd', 0, 1, 0)).toBe(0xa00);
    expect(sectorOffset('dsd', 1, 0, 0)).toBe(0xa00);
  });
});

describe('sectorOffset rejects addresses that are not on a disc', () => {
  it.each([
    ['ssd', 1, 0, 0],
    ['dsd', 2, 0, 0],
    ['ssd', 0, 80, 0],
    ['ssd', 0, -1, 0],
    ['ssd', 0, 0, 10],
    ['ssd', 0, 0, 1.5],
  ] as const)('%s side %d track %d sector %d is a RangeError', (format, side, track, sector) => {
    expect(() => sectorOffset(format, side, track, sector)).toThrow(RangeError);
  });
});

describe('formatFromName: the extension says how the file is laid out', () => {
  it.each([
    ['elite.ssd', 'ssd'],
    ['ELITE.SSD', 'ssd'],
    ['discs/games/Repton.dsd', 'dsd'],
  ] as const)('%s is %s', (name, format) => {
    expect(formatFromName(name)).toBe(format);
  });

  it.each(['elite.img', 'ssd', 'disc.ssd.zip', ''])('%j is not a format we know', (name) => {
    expect(formatFromName(name)).toBeUndefined();
  });
});

describe('DiscImage.fromBytes: size validation and geometry', () => {
  it.each([
    ['ssd', 102_400, 1, 40],
    ['ssd', 204_800, 1, 80],
    ['dsd', 204_800, 2, 40],
    ['dsd', 409_600, 2, 80],
    ['ssd', 102_401, 1, 80],
    ['dsd', 204_801, 2, 80],
  ] as const)('a %s of %d bytes is %d-sided with %d tracks', (format, size, sides, tracks) => {
    const image = DiscImage.fromBytes(new Uint8Array(size), format, 'x');
    expect(image.geometry).toEqual({ format, sides, tracks });
    expect(image.fileLength).toBe(size);
  });

  it('accepts a short ssd (written only up to its last used sector) as a 40-track disc', () => {
    const image = DiscImage.fromBytes(new Uint8Array(20 * SECTOR_SIZE), 'ssd', 'short.ssd');
    expect(image.geometry.tracks).toBe(40);
    expect(image.fileLength).toBe(5120);
  });

  it('rejects an empty file with a RangeError naming it', () => {
    expect(() => DiscImage.fromBytes(new Uint8Array(0), 'ssd', 'empty.ssd')).toThrow(/empty\.ssd/);
  });

  it.each([
    ['ssd', 204_801],
    ['dsd', 409_601],
  ] as const)('rejects a %s of %d bytes: more than 80 tracks', (format, size) => {
    expect(() => DiscImage.fromBytes(new Uint8Array(size), format, 'big')).toThrow(RangeError);
    expect(() => DiscImage.fromBytes(new Uint8Array(size), format, 'big')).toThrow(/big/);
  });
});

describe('DiscImage.readSector', () => {
  it('returns the 256 bytes at the sector offset of an ssd', () => {
    const bytes = patterned(102_400);
    const image = DiscImage.fromBytes(bytes, 'ssd', 'x.ssd');
    const sector = image.readSector(0, 5, 3);
    expect(sector).toHaveLength(SECTOR_SIZE);
    expect(sector).toEqual(bytes.subarray(0x3500, 0x3600));
  });

  it('returns side 1 track 5 sector 3 of a dsd from offset &7100', () => {
    const bytes = patterned(409_600);
    const image = DiscImage.fromBytes(bytes, 'dsd', 'x.dsd');
    expect(image.readSector(1, 5, 3)).toEqual(bytes.subarray(0x7100, 0x7200));
  });

  it('reads sectors past the end of a short image as &00', () => {
    const bytes = new Uint8Array(1000).fill(0xe5);
    const image = DiscImage.fromBytes(bytes, 'ssd', 'short.ssd');
    const last = image.readSector(0, 0, 3); // offsets &300-&3FF; the file ends at 1000 = &3E8
    expect(last[0xe7]).toBe(0xe5);
    expect(last[0xe8]).toBe(0x00);
    expect(image.readSector(0, 39, 9).every((b) => b === 0)).toBe(true);
  });

  it('copies on the way in: changing the file buffer later leaves the disc alone', () => {
    const bytes = new Uint8Array(102_400);
    const image = DiscImage.fromBytes(bytes, 'ssd', 'x.ssd');
    bytes[0] = 0x42;
    expect(image.readSector(0, 0, 0)[0]).toBe(0x00);
  });

  it('copies on the way out: changing a returned sector leaves the disc alone', () => {
    const image = DiscImage.fromBytes(new Uint8Array(102_400), 'ssd', 'x.ssd');
    image.readSector(0, 0, 0)[0] = 0x42;
    expect(image.readSector(0, 0, 0)[0]).toBe(0x00);
  });

  it('throws a RangeError for side 1 of a single-sided disc and track 40 of a 40-track disc', () => {
    const image = DiscImage.fromBytes(new Uint8Array(102_400), 'ssd', 'x.ssd');
    expect(() => image.readSector(1, 0, 0)).toThrow(RangeError);
    expect(() => image.readSector(0, 40, 0)).toThrow(RangeError);
  });
});

describe('DiscImage.hasSector: the check a disc controller makes before it reads', () => {
  it('knows the bounds of a 40-track dsd', () => {
    const image = DiscImage.fromBytes(new Uint8Array(204_800), 'dsd', 'x.dsd');
    expect(image.hasSector(1, 39, 9)).toBe(true);
    expect(image.hasSector(2, 0, 0)).toBe(false);
    expect(image.hasSector(0, 40, 0)).toBe(false);
    expect(image.hasSector(0, 0, 10)).toBe(false);
    expect(image.hasSector(0, -1, 0)).toBe(false);
  });
});

describe('DiscImage.offsetOf: the file offset, checked against this disc', () => {
  it('gives &7100 for side 1 track 5 sector 3 of an 80-track dsd', () => {
    const image = DiscImage.fromBytes(new Uint8Array(409_600), 'dsd', 'x.dsd');
    expect(image.offsetOf(1, 5, 3)).toBe(0x7100);
  });

  it('refuses track 79 of a 40-track ssd, though an 80-track ssd would have it', () => {
    const image = DiscImage.fromBytes(new Uint8Array(102_400), 'ssd', 'x.ssd');
    expect(() => image.offsetOf(0, 79, 0)).toThrow(/40-track single-sided ssd/);
  });
});
