import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DiscImage, formatFromName, sectorOffset } from './disc-image';
import { catalogueProblems } from './dfs-catalogue';
import { buildDfsImage, buildDfsSide, openDfsDisc, readCatalogue, readFile, type NewDfsSide } from './dfs-disc';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const filled = (length: number, seed: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 7 + seed) & 0xff);

const SIDE: NewDfsSide = {
  title: 'ROUND TRIP',
  bootOption: 3,
  tracks: 40,
  files: [
    { name: '!BOOT', load: 0, exec: 0, data: bytes(0x2a, 0x52, 0x55, 0x4e, 0x20, 0x48, 0x49, 0x0d) },
    { name: 'HI', load: 0xffff1900, exec: 0xffff1900, data: filled(0x123, 1), locked: true },
    { directory: 'E', name: 'EMPTY', load: 0x3000, exec: 0x3000, data: new Uint8Array(0) },
    { directory: 'E', name: 'BIG', load: 0x0e00, exec: 0x8023, data: filled(0x2a80, 9) },
  ],
};

describe('building a DFS side', () => {
  test('files are laid out from sector 2 in the order given, each taking ceil(length / 256) sectors', () => {
    const image = DiscImage.fromBytes(buildDfsSide(SIDE), 'ssd', 'built.ssd');
    const starts = new Map(readCatalogue(image, 0).files.map((f) => [f.name, f.startSector]));
    expect(starts).toEqual(
      new Map([
        ['!BOOT', 2], // 8 bytes: 1 sector
        ['HI', 3], // &123: 2 sectors
        ['EMPTY', 5], // empty: no sectors, so BIG starts here too
        ['BIG', 5],
      ]),
    );
  });

  test('the catalogue lists them highest start sector first, as DFS keeps it', () => {
    const image = DiscImage.fromBytes(buildDfsSide(SIDE), 'ssd', 'built.ssd');
    const cat = readCatalogue(image, 0);
    expect(cat.files.map((f) => f.startSector)).toEqual([5, 5, 3, 2]);
    expect(catalogueProblems(cat)).toEqual([]);
  });

  test('round trip: every file reads back with its name, flags, addresses and exact bytes', () => {
    const image = DiscImage.fromBytes(buildDfsSide(SIDE), 'ssd', 'built.ssd');
    const cat = readCatalogue(image, 0);
    expect(cat).toMatchObject({ title: 'ROUND TRIP', bootOption: 3, sectorCount: 400, cycle: 0 });
    for (const spec of SIDE.files) {
      const found = cat.files.find((f) => f.name === spec.name);
      expect(found).toMatchObject({
        directory: spec.directory ?? '$',
        locked: spec.locked ?? false,
        load: spec.load & 0x3ffff,
        exec: spec.exec & 0x3ffff,
        length: spec.data.length,
      });
      if (found === undefined) continue;
      expect([...readFile(image, 0, found)]).toEqual([...spec.data]);
    }
  });

  test('a load address of &FFFF1900 is stored as its low 18 bits, &31900', () => {
    const image = DiscImage.fromBytes(buildDfsSide(SIDE), 'ssd', 'built.ssd');
    expect(readCatalogue(image, 0).files.find((f) => f.name === 'HI')?.load).toBe(0x3_1900);
  });

  test('a 40-track side is 102,400 bytes and says &190 sectors; an 80-track side 204,800 and &320', () => {
    expect(buildDfsSide({ tracks: 40, files: [] })).toHaveLength(102_400);
    const eighty = buildDfsSide({ tracks: 80, files: [] });
    expect(eighty).toHaveLength(204_800);
    expect([eighty[0x106], eighty[0x107]]).toEqual([0x03, 0x20]);
  });

  test('names DFS would refuse are refused: wildcards, ".", ":", quote, space, too long, empty', () => {
    for (const name of ['A#', 'A*', 'A.B', 'A:B', 'A"', 'A B', 'EIGHTCHR', '', 'café']) {
      expect(() => buildDfsSide({ tracks: 40, files: [{ name, load: 0, exec: 0, data: new Uint8Array(1) }] })).toThrow(RangeError);
    }
    expect(() => buildDfsSide({ tracks: 40, files: [{ directory: '#', name: 'A', load: 0, exec: 0, data: new Uint8Array(1) }] })).toThrow(/directory/);
  });

  test('two files with the same name, ignoring case, are refused; the same name in another directory is fine', () => {
    const file = (directory: string, name: string): NewDfsSide['files'][number] => ({ directory, name, load: 0, exec: 0, data: new Uint8Array(1) });
    expect(() => buildDfsSide({ tracks: 40, files: [file('$', 'HELLO'), file('$', 'hello')] })).toThrow(/\$\.hello: there's already a \$\.HELLO/);
    expect(() => buildDfsSide({ tracks: 40, files: [file('$', 'HELLO'), file('E', 'HELLO')] })).not.toThrow();
  });

  test('files that need more sectors than the disc has are refused', () => {
    // 398 free sectors on a 40-track side (400 less the catalogue's 2).
    const fits = { name: 'FULL', load: 0, exec: 0, data: new Uint8Array(398 * 256) };
    expect(() => buildDfsSide({ tracks: 40, files: [fits] })).not.toThrow();
    expect(() => buildDfsSide({ tracks: 40, files: [fits, { name: 'ONE', load: 0, exec: 0, data: new Uint8Array(1) }] })).toThrow(
      /\$\.ONE doesn't fit: it needs sectors &190-&190, but a 40-track side has &190 \(400\)/,
    );
  });

  test('more than 31 files is refused', () => {
    const files = Array.from({ length: 32 }, (_, i) => ({ name: `F${String(i)}`, load: 0, exec: 0, data: new Uint8Array(0) }));
    expect(() => buildDfsSide({ tracks: 40, files })).toThrow(/31/);
  });
});

describe('building a disc image', () => {
  test('a dsd puts side 1 in the odd track slots, with its own catalogue at &A00', () => {
    const image = buildDfsImage('dsd', [
      { title: 'FRONT', tracks: 40, files: [{ name: 'A', load: 0, exec: 0, data: filled(300, 2) }] },
      { title: 'BACK', tracks: 40, files: [{ name: 'B', load: 0, exec: 0, data: filled(300, 5) }] },
    ]);
    expect(image).toHaveLength(204_800);
    expect(String.fromCharCode(...image.subarray(sectorOffset('dsd', 1, 0, 0), sectorOffset('dsd', 1, 0, 0) + 4))).toBe('BACK');
    const disc = DiscImage.fromBytes(image, 'dsd', 'built.dsd');
    expect(readCatalogue(disc, 0).title).toBe('FRONT');
    const back = readCatalogue(disc, 1);
    expect(back.title).toBe('BACK');
    const b = back.files.at(0);
    expect(b === undefined ? [] : [...readFile(disc, 1, b)]).toEqual([...filled(300, 5)]);
  });

  test('an ssd takes one side, a dsd two, and both sides must have the same track count', () => {
    const side: NewDfsSide = { tracks: 40, files: [] };
    expect(() => buildDfsImage('ssd', [side, side])).toThrow(/one side/);
    expect(() => buildDfsImage('dsd', [side])).toThrow(/two sides/);
    expect(() => buildDfsImage('dsd', [side, { tracks: 80, files: [] }])).toThrow(/track/);
  });
});

describe('opening a DFS disc', () => {
  test("a short ssd whose catalogue says 800 sectors is taken as 80 tracks (the size alone said 40)", () => {
    const full = buildDfsSide({ tracks: 80, files: [{ name: 'A', load: 0, exec: 0, data: new Uint8Array(10) }] });
    const short = full.slice(0, 0x300);
    expect(DiscImage.fromBytes(short, 'ssd', 'short.ssd').geometry.tracks).toBe(40);
    expect(openDfsDisc(short, 'ssd', 'short.ssd').geometry.tracks).toBe(80);
  });

  test('a catalogue sector count that is neither 400 nor 800 leaves the size to decide', () => {
    const odd = buildDfsSide({ tracks: 40, files: [] });
    odd[0x107] = 0x00; // 1 × 256 = 256 sectors
    expect(openDfsDisc(odd, 'ssd', 'odd.ssd').geometry.tracks).toBe(40);
  });

  test('reading a file whose sectors are past the end of the disc throws a RangeError naming it', () => {
    const side = buildDfsSide({ tracks: 40, files: [{ name: 'A', load: 0, exec: 0, data: new Uint8Array(10) }] });
    side[0x10f] = 0x90; // start sector &190 low byte
    side[0x10e] = 0x01; // and bits 8-9 = 1: sector &190, one past the last
    const disc = DiscImage.fromBytes(side, 'ssd', 'bad.ssd');
    const file = readCatalogue(disc, 0).files.at(0);
    expect(file === undefined ? undefined : () => readFile(disc, 0, file)).toThrow(/\$\.A: sector &190 is not on this disc/);
  });
});

// The real discs in discs/ (gitignored: the user's own). Each must read with
// no problems, and every file must be readable to its full length.
const DISC_DIR = 'discs';
const realDiscs = existsSync(DISC_DIR) ? readdirSync(DISC_DIR).filter((name) => formatFromName(name) !== undefined) : [];

describe('real discs in discs/', () => {
  if (realDiscs.length === 0) {
    test.skip('no .ssd or .dsd files in discs/ (your own disc images; gitignored)', () => undefined);
    return;
  }
  test.each(realDiscs)('%s: the catalogue reads with no problems and every file reads to its length', (name) => {
    const format = formatFromName(name);
    if (format === undefined) return;
    const disc = openDfsDisc(readFileSync(join(DISC_DIR, name)), format, name);
    for (let side = 0; side < disc.geometry.sides; side++) {
      const cat = readCatalogue(disc, side);
      expect(catalogueProblems(cat)).toEqual([]);
      for (const file of cat.files) expect(readFile(disc, side, file)).toHaveLength(file.length);
    }
  });
});
