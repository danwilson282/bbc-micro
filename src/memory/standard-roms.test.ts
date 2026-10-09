import { readFileSync } from 'node:fs';
import { BbcMemoryMap } from './bbc-memory-map';
import { loadRomFile, loadStandardRoms, romPath } from './rom-files';
import { parseRomHeader } from './rom-header';
import { STANDARD_ROMS, installRom } from './standard-roms';
import { withRoms } from './with-roms';

function standard(id: string): (typeof STANDARD_ROMS)[number] {
  const rom = STANDARD_ROMS.find((r) => r.id === id);
  if (rom === undefined) throw new Error(`no standard ROM ${id}`);
  return rom;
}

const MOS = romPath(standard('mos'));
const BASIC = romPath(standard('basic'));
const DFS = romPath(standard('dfs'));

describe('the standard ROM set', () => {
  it('puts the MOS at &C000, BASIC in slot 15 (the highest, so it is the language at reset) and DFS in slot 14', () => {
    expect(STANDARD_ROMS.map((r) => [r.file, r.slot])).toEqual([
      ['os12.rom', 'mos'],
      ['basic2.rom', 15],
      ['dfs.rom', 14],
    ]);
  });

  it('installRom puts a sideways ROM in its slot and the MOS at &C000', () => {
    const map = new BbcMemoryMap();
    installRom(map, standard('basic'), new Uint8Array(0x4000).fill(0xbb));
    installRom(map, standard('mos'), new Uint8Array(0x4000).fill(0xcc));
    expect(map.sidewaysRom(15)?.[0]).toBe(0xbb);
    expect(map.read(0xc000)).toBe(0xcc);
  });

  it('loadStandardRoms reports each ROM as loaded or missing, never both', () => {
    const report = loadStandardRoms(new BbcMemoryMap());
    expect(report.loaded.length + report.missing.length).toBe(STANDARD_ROMS.length);
  });
});

describe('the real ROMs (each test skips if its file is missing)', () => {
  withRoms(MOS)('os12.rom maps to &C000-&FFFF: the reset vector at &FFFC is &D9CD', () => {
    const map = new BbcMemoryMap();
    map.loadMos(loadRomFile(MOS));
    const file = readFileSync(MOS);
    expect(map.read(0xc000)).toBe(file[0]);
    expect(map.read(0xfffc) | (map.read(0xfffd) << 8)).toBe(0xd9cd);
  });

  withRoms(MOS)('os12.rom has no paged ROM header: it is not a sideways ROM', () => {
    const image = loadRomFile(MOS);
    expect(parseRomHeader((a) => image[a - 0x8000] ?? 0xff).ok).toBe(false);
  });

  withRoms(BASIC)('basic2.rom, paged into slot 15: "BASIC", binary version 1, (C)1982 Acorn, type &60', () => {
    const map = new BbcMemoryMap();
    map.loadSidewaysRom(15, loadRomFile(BASIC));
    map.write(0xfe30, 15);
    const result = parseRomHeader((a) => map.peek(a));
    if (!result.ok) throw new Error(result.reason);
    expect(result.header).toMatchObject({ title: 'BASIC', binaryVersion: 1, type: 0x60, copyright: '(C)1982 Acorn\n\r', relocationAddress: 0x8000 });
  });

  withRoms(DFS)('dfs.rom has a valid header with a service entry, and no language entry', () => {
    const image = loadRomFile(DFS);
    const result = parseRomHeader((a) => image[a - 0x8000] ?? 0xff);
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.hasServiceEntry).toBe(true);
    expect(result.header.hasLanguageEntry).toBe(false);
  });
});
