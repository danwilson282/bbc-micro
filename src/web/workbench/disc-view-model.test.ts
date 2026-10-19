import { buildDfsImage } from '../../disc/dfs-disc';
import { buildTestDisc } from '../../disc/test-disc';
import { discView } from './disc-view-model';

describe('the Disc panel view of a dropped image', () => {
  test('the Stage 48 test disc: heading, *CAT text, and one row per file in catalogue order', () => {
    const view = discView(buildTestDisc(), 'stage48.ssd');
    if (!view.ok) throw new Error(view.error);
    expect(view.heading).toBe('stage48.ssd: ssd, single-sided, 40 tracks');
    const side = view.sides.at(0);
    expect(side?.drive).toBe(0);
    expect(side?.catLines[0]).toBe('STAGE 48 (00)');
    expect(side?.files.map((f) => f.name)).toEqual(['E.DATA', '$.EMPTY', '$.README', '$.HELLO', '$.!BOOT']);
    expect(side?.files[3]).toEqual({ name: '$.HELLO', locked: true, load: 'FF1900', exec: 'FF1900', length: '&0021', start: '&003', sectors: 1 });
    expect(side?.summary).toBe('5 of 31 files · 6 of 398 sectors used · 392 free');
    expect(side?.problems).toEqual([]);
  });

  test('a dsd shows two drives, 0 and 2, each with its own catalogue', () => {
    const view = discView(
      buildDfsImage('dsd', [
        { title: 'FRONT', tracks: 80, files: [] },
        { title: 'BACK', tracks: 80, files: [] },
      ]),
      'two.DSD',
    );
    if (!view.ok) throw new Error(view.error);
    expect(view.sides.map((s) => [s.drive, s.catLines[0]])).toEqual([
      [0, 'FRONT (00)'],
      [2, 'BACK (00)'],
    ]);
  });

  test('a short image says so, with the catalogue deciding it has 80 tracks', () => {
    const full = buildDfsImage('ssd', [{ tracks: 80, files: [] }]);
    const view = discView(full.slice(0, 512), 'short.ssd');
    expect(view.ok && view.heading).toBe('short.ssd: ssd, single-sided, 80 tracks (short file: 512 bytes)');
  });

  test('a file that is not .ssd or .dsd, or is empty, is a message, not an exception', () => {
    const zip = discView(new Uint8Array(10), 'game.zip');
    expect(!zip.ok && zip.error).toMatch(/must end \.ssd or \.dsd/);
    const empty = discView(new Uint8Array(0), 'empty.ssd');
    expect(!empty.ok && empty.error).toMatch(/empty\.ssd is 0 bytes/);
  });

  test('a side whose catalogue is impossible shows the reason for that side only', () => {
    const bytes = buildTestDisc();
    bytes[0x105] = 0x0c;
    const view = discView(bytes, 'bad.ssd');
    expect(view.ok && view.sides[0]?.error).toMatch(/not a multiple of 8/);
  });
});
