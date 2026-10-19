import {
  CATALOGUE_SIZE,
  catalogueProblems,
  decodeCatalogue,
  encodeCatalogue,
  fileSectors,
  type DfsCatalogue,
  type DfsFile,
} from './dfs-catalogue';

/** Sector 0 and sector 1 of a catalogue, from its 512 bytes. */
function split(bytes: Uint8Array): [Uint8Array, Uint8Array] {
  return [bytes.subarray(0, 256), bytes.subarray(256, 512)];
}

/** Manic Miner's catalogue, byte for byte (discs/Disc011-ManicMiner.ssd), so no disc is needed. */
function manicMinerSectors(): [Uint8Array, Uint8Array] {
  const bytes = new Uint8Array(512);
  const names = ['MINER4 ', 'MINER3 ', 'MINER2 ', 'MINER1 ', 'MANIC  ', '!BOOT  '];
  bytes.set([0x4d, 0x41, 0x4e, 0x49, 0x43], 0); // "MANIC", then NULs
  names.forEach((name, i) => {
    for (let c = 0; c < 7; c++) bytes[8 + i * 8 + c] = name.charCodeAt(c);
    bytes[8 + i * 8 + 7] = 0xa4; // "$" + locked
  });
  bytes.set([0x00, 0x00, 0x00, 0x00, 0x01, 0x30, 0x33, 0x20], 0x100);
  const info = [
    [0x80, 0x55, 0x9a, 0x61, 0x80, 0x2a, 0x00, 0x3e],
    [0x00, 0x30, 0x00, 0x30, 0x80, 0x02, 0x00, 0x3b],
    [0x00, 0x4c, 0x00, 0x73, 0x00, 0x28, 0x00, 0x13],
    [0x00, 0x74, 0xb5, 0x74, 0x00, 0x08, 0x00, 0x0b],
    [0x00, 0x19, 0x1f, 0x80, 0x60, 0x07, 0x00, 0x03],
    [0x00, 0x00, 0x00, 0x00, 0x2e, 0x00, 0x00, 0x02],
  ];
  info.forEach((entry, i) => {
    bytes.set(entry, 0x108 + i * 8);
  });
  return split(bytes);
}

const file = (over: Partial<DfsFile>): DfsFile => ({
  directory: '$',
  name: 'FILE',
  locked: false,
  load: 0x1900,
  exec: 0x1900,
  length: 0x100,
  startSector: 2,
  ...over,
});

const catalogue = (over: Partial<DfsCatalogue>): DfsCatalogue => ({
  title: '',
  cycle: 0,
  bootOption: 0,
  sectorCount: 800,
  files: [],
  ...over,
});

describe('decoding a DFS catalogue', () => {
  test("Manic Miner: title MANIC (NUL-padded), cycle &01, boot option 3, &320 = 800 sectors, 6 files", () => {
    const [s0, s1] = manicMinerSectors();
    const cat = decodeCatalogue(s0, s1);
    expect(cat.title).toBe('MANIC');
    expect(cat.cycle).toBe(0x01);
    expect(cat.bootOption).toBe(3);
    expect(cat.sectorCount).toBe(800);
    expect(cat.files.map((f) => f.name)).toEqual(['MINER4', 'MINER3', 'MINER2', 'MINER1', 'MANIC', '!BOOT']);
  });

  test('the directory byte &A4 is "$" with bit 7 (locked) set', () => {
    const [s0, s1] = manicMinerSectors();
    const manic = decodeCatalogue(s0, s1).files[4];
    expect(manic).toEqual({ directory: '$', name: 'MANIC', locked: true, load: 0x1900, exec: 0x801f, length: 0x0760, startSector: 3 });
  });

  test('a title is 8 bytes from sector 0 then 4 from sector 1, trailing spaces trimmed', () => {
    const bytes = new Uint8Array(512);
    const title = 'TWELVE CHARS';
    for (let i = 0; i < 8; i++) bytes[i] = title.charCodeAt(i);
    for (let i = 0; i < 4; i++) bytes[0x100 + i] = title.charCodeAt(8 + i);
    expect(decodeCatalogue(...split(bytes)).title).toBe('TWELVE CHARS');
    bytes.set([0x41, 0x42, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20], 0);
    bytes.set([0x20, 0x20, 0x20, 0x20], 0x100);
    expect(decodeCatalogue(...split(bytes)).title).toBe('AB');
  });

  test('the mixed byte supplies bits 16-17 of load (bits 2-3), length (4-5) and exec (6-7), and bits 8-9 of the start sector (0-1)', () => {
    const bytes = new Uint8Array(512);
    bytes.set([0x41, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x24], 8); // "A      " in $
    bytes[0x105] = 8;
    // load &1234, exec &5678, length &9ABC, mixed %10 01 11 01, start &EF
    bytes.set([0x34, 0x12, 0x78, 0x56, 0xbc, 0x9a, 0b1001_1101, 0xef], 0x108);
    const f = decodeCatalogue(...split(bytes)).files.at(0);
    expect(f?.load).toBe(0x3_1234);
    expect(f?.length).toBe(0x1_9abc);
    expect(f?.exec).toBe(0x2_5678);
    expect(f?.startSector).toBe(0x1ef);
  });

  test("Repton 3's E.REPTON3 entry 00 04 00 04 00 04 01 92 starts at sector &192 (402)", () => {
    const bytes = new Uint8Array(512);
    bytes.set([0x52, 0x45, 0x50, 0x54, 0x4f, 0x4e, 0x33, 0xc5], 8); // "REPTON3", "E" + locked
    bytes[0x105] = 8;
    bytes.set([0x00, 0x04, 0x00, 0x04, 0x00, 0x04, 0x01, 0x92], 0x108);
    const [f] = decodeCatalogue(...split(bytes)).files;
    expect(f).toEqual({ directory: 'E', name: 'REPTON3', locked: true, load: 0x0400, exec: 0x0400, length: 0x0400, startSector: 0x192 });
  });

  test("names are read leniently: bit 7 stripped, any character kept (Castle Quest's t?data?)", () => {
    const bytes = new Uint8Array(512);
    bytes.set([0x74, 0x3f, 0x64, 0x61, 0x74, 0x61, 0xbf, 0x24], 8); // "t?data" + "?" with bit 7 set
    bytes[0x105] = 8;
    expect(decodeCatalogue(...split(bytes)).files[0]?.name).toBe('t?data?');
  });

  test('a file count byte (&105) that is not a multiple of 8, or over 31 files, is refused', () => {
    const bytes = new Uint8Array(512);
    bytes[0x105] = 0x0c;
    expect(() => decodeCatalogue(...split(bytes))).toThrow(/&105 is &0C: not a multiple of 8/);
    bytes[0x105] = 0xf8; // 31 files: allowed
    expect(decodeCatalogue(...split(bytes)).files).toHaveLength(31);
  });

  test('a catalogue sector that is not 256 bytes is refused', () => {
    expect(() => decodeCatalogue(new Uint8Array(255), new Uint8Array(256))).toThrow(RangeError);
  });
});

describe('encoding a DFS catalogue', () => {
  test('encoding Manic Miner decoded gives back the same 512 bytes', () => {
    const [s0, s1] = manicMinerSectors();
    const bytes = encodeCatalogue(decodeCatalogue(s0, s1));
    expect(bytes).toHaveLength(CATALOGUE_SIZE);
    expect([...bytes.subarray(0, 256)]).toEqual([...s0]);
    expect([...bytes.subarray(256)]).toEqual([...s1]);
  });

  test('&106 holds the boot option in bits 4-5 and sector-count bits 8-9 in bits 0-1; &107 the low byte', () => {
    const bytes = encodeCatalogue(catalogue({ bootOption: 2, sectorCount: 400 }));
    expect(bytes[0x106]).toBe(0x21); // option 2, &190 → high bits 01
    expect(bytes[0x107]).toBe(0x90);
  });

  test('a locked file in directory E encodes its directory byte as &C5', () => {
    const bytes = encodeCatalogue(catalogue({ files: [file({ directory: 'E', locked: true })] }));
    expect(bytes[0x0f]).toBe(0xc5);
    expect(bytes[0x105]).toBe(0x08);
  });

  test('a FF1900 load address (18 bits &31900) sets mixed-byte bits 2-3', () => {
    const bytes = encodeCatalogue(catalogue({ files: [file({ load: 0x3_1900, exec: 0x3_8023, length: 0x123, startSector: 0x102 })] }));
    expect([...bytes.subarray(0x108, 0x110)]).toEqual([0x00, 0x19, 0x23, 0x80, 0x23, 0x01, 0b1100_1101, 0x02]);
  });

  test('names are padded to 7 with spaces and the title with NULs', () => {
    const bytes = encodeCatalogue(catalogue({ title: 'HI', files: [file({ name: 'AB' })] }));
    expect([...bytes.subarray(0, 8)]).toEqual([0x48, 0x49, 0, 0, 0, 0, 0, 0]);
    expect([...bytes.subarray(8, 16)]).toEqual([0x41, 0x42, 0x20, 0x20, 0x20, 0x20, 0x20, 0x24]);
  });

  test('values too wide for their fields are refused rather than silently masked', () => {
    expect(() => encodeCatalogue(catalogue({ files: [file({ length: 0x4_0000 })] }))).toThrow(/length/);
    expect(() => encodeCatalogue(catalogue({ files: [file({ startSector: 0x400 })] }))).toThrow(/start sector/);
    expect(() => encodeCatalogue(catalogue({ title: 'THIRTEEN CHRS' }))).toThrow(/title/);
    expect(() => encodeCatalogue(catalogue({ files: Array.from({ length: 32 }, (_, i) => file({ name: `F${String(i)}` })) }))).toThrow(/31/);
  });
});

describe('file sizes in sectors', () => {
  test('a file takes ceil(length / 256) sectors, and an empty file none', () => {
    expect(fileSectors(0)).toBe(0);
    expect(fileSectors(1)).toBe(1);
    expect(fileSectors(0x100)).toBe(1);
    expect(fileSectors(0x101)).toBe(2);
    expect(fileSectors(0x2a80)).toBe(43); // MINER4
  });
});

describe('catalogue problems (reported, not thrown)', () => {
  test('Manic Miner has none', () => {
    expect(catalogueProblems(decodeCatalogue(...manicMinerSectors()))).toEqual([]);
  });

  test('a file running past the last sector is reported', () => {
    const cat = catalogue({ sectorCount: 400, files: [file({ name: 'BIG', startSector: 399, length: 0x200 })] });
    expect(catalogueProblems(cat)).toEqual(['$.BIG runs past the end of the disc: sectors &18F-&190, but the disc has &190 sectors']);
  });

  test('overlapping files and entries out of start-sector order are reported', () => {
    const cat = catalogue({
      files: [file({ name: 'A', startSector: 2, length: 0x100 }), file({ name: 'B', startSector: 2, length: 0x300 })],
    });
    expect(catalogueProblems(cat)).toEqual(['$.B (sectors &002-&004) overlaps $.A (sectors &002-&002)']);
    const unsorted = catalogue({ files: [file({ name: 'A', startSector: 2 }), file({ name: 'B', startSector: 3 })] });
    expect(catalogueProblems(unsorted)).toEqual(['entries are out of order: $.B (sector &003) comes after $.A (sector &002), but DFS keeps the highest start sector first']);
  });

  test('a file starting inside the catalogue (sector 0 or 1) is reported', () => {
    expect(catalogueProblems(catalogue({ files: [file({ startSector: 1 })] }))).toEqual(['$.FILE starts at sector &001, inside the catalogue (sectors 0 and 1)']);
  });
});
