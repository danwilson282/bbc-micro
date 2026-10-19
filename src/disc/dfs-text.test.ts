import type { DfsCatalogue, DfsFile } from './dfs-catalogue';
import { catLines, dfsAddress, infoLine, sortedForCat } from './dfs-text';

const file = (directory: string, name: string, locked = false): DfsFile => ({
  directory,
  name,
  locked,
  load: 0x1900,
  exec: 0x8023,
  length: 0x100,
  startSector: 2,
});

const REPTONISH: DfsCatalogue = {
  title: 'REPLOAD',
  cycle: 0x01,
  bootOption: 3,
  sectorCount: 800,
  files: [file('E', 'REPTON1', true), file('$', 'REPTON', true), file('E', 'EDITOR', true), file('$', '!BOOT', true), file('$', 'FONTS')],
};

describe('addresses as *INFO shows them', () => {
  test('18-bit addresses with bits 16-17 both set mean the I/O processor: &31900 shows as FF1900', () => {
    expect(dfsAddress(0x3_1900)).toBe('FF1900');
    expect(dfsAddress(0x3_8023)).toBe('FF8023');
  });
  test('any other value is six hex digits', () => {
    expect(dfsAddress(0x1900)).toBe('001900');
    expect(dfsAddress(0x1_2345)).toBe('012345');
    expect(dfsAddress(0x2_0000)).toBe('020000');
  });
});

describe('*CAT-style text', () => {
  test('the current directory ($) comes first, then other directories, each sorted by name ignoring case', () => {
    expect(sortedForCat(REPTONISH.files).map((f) => `${f.directory}.${f.name}`)).toEqual(['$.!BOOT', '$.FONTS', '$.REPTON', 'E.EDITOR', 'E.REPTON1']);
    const mixed = sortedForCat([file('$', 'music'), file('$', 'Game'), file('$', 'CASTLE')]);
    expect(mixed.map((f) => f.name)).toEqual(['CASTLE', 'Game', 'music']);
  });

  test('header: title and cycle, drive and boot option, directory and library', () => {
    expect(catLines(REPTONISH, 0).slice(0, 4)).toEqual(['REPLOAD (01)', 'Drive 0             Option 3 (EXEC)', 'Directory :0.$      Library :0.$', '']);
  });

  test('files in two columns; L for locked; other directories after a blank line, with their letter (as DFS 0.98 prints it)', () => {
    expect(catLines(REPTONISH, 0).slice(4)).toEqual([
      // 0         1         2         3
      // 0123456789012345678901234567890123
      '    !BOOT    L          FONTS',
      '    REPTON   L',
      '',
      '  E.EDITOR   L        E.REPTON1  L',
    ]);
  });

  test('no blank line when every file is in the current directory', () => {
    expect(catLines({ ...REPTONISH, files: REPTONISH.files.filter((f) => f.directory === '$') }, 0).slice(4)).toEqual([
      '    !BOOT    L          FONTS',
      '    REPTON   L',
    ]);
  });

  test('side 1 of a dsd is drive 2', () => {
    expect(catLines({ ...REPTONISH, files: [] }, 2)[1]).toBe('Drive 2             Option 3 (EXEC)');
  });

  test('every boot option has its *CAT name', () => {
    const names = ([0, 1, 2, 3] as const).map((bootOption) => catLines({ ...REPTONISH, bootOption }, 0)[1]?.slice(20));
    expect(names).toEqual(['Option 0 (off)', 'Option 1 (LOAD)', 'Option 2 (RUN)', 'Option 3 (EXEC)']);
  });

  test('every line fits MODE 7\'s 40 columns', () => {
    const full: DfsCatalogue = { ...REPTONISH, title: 'TWELVE CHARS', files: Array.from({ length: 31 }, (_, i) => file('Z', `LONGNM${String(i % 10)}`, true)) };
    for (const line of catLines(full, 0)) expect(line.length).toBeLessThanOrEqual(39);
  });
});

describe('*INFO-style lines', () => {
  test('name, lock, load, exec, length and start sector in hex', () => {
    expect(infoLine({ directory: '$', name: 'MANIC', locked: true, load: 0x1900, exec: 0x801f, length: 0x760, startSector: 3 })).toBe(
      '$.MANIC   L  001900 00801F 000760 003',
    );
    expect(infoLine({ directory: 'E', name: 'REPTON3', locked: false, load: 0x3_0400, exec: 0x3_0400, length: 0x400, startSector: 0x192 })).toBe(
      'E.REPTON3    FF0400 FF0400 000400 192',
    );
  });
});
