import { DiscImage } from './disc-image';
import { catalogueProblems } from './dfs-catalogue';
import { readCatalogue, readFile } from './dfs-disc';
import { catLines, infoLine } from './dfs-text';
import { buildTestDisc, helloProgram, testDiscSide } from './test-disc';

describe('the Stage 48 test disc', () => {
  const disc = DiscImage.fromBytes(buildTestDisc(), 'ssd', 'stage48.ssd');
  const cat = readCatalogue(disc, 0);

  test('HELLO is our own assembler\'s output: LDX #0 (A2 00) at &1900, ending in a zero after "HELLO FROM DISC"', () => {
    const bytes = helloProgram();
    expect([...bytes.subarray(0, 2)]).toEqual([0xa2, 0x00]);
    expect(String.fromCharCode(...bytes.subarray(bytes.length - 16, bytes.length - 1))).toBe('HELLO FROM DISC');
    expect(bytes.at(-1)).toBe(0);
  });

  test('round trip: written, then read back through the catalogue, every file is byte-identical', () => {
    expect(catalogueProblems(cat)).toEqual([]);
    for (const spec of testDiscSide().files) {
      const found = cat.files.find((f) => f.directory === (spec.directory ?? '$') && f.name === spec.name);
      expect(found === undefined ? undefined : [...readFile(disc, 0, found)]).toEqual([...spec.data]);
    }
  });

  test('the catalogue as *CAT shows it', () => {
    expect(catLines(cat, 0)).toEqual([
      'STAGE 48 (00)',
      'Drive 0             Option 3 (EXEC)',
      'Directory :0.$      Library :0.$',
      '',
      '    !BOOT               EMPTY',
      '    HELLO   L           README',
      '  E.DATA',
    ]);
  });

  test('*INFO for each file, in catalogue order (highest start sector first)', () => {
    expect(cat.files.map(infoLine)).toEqual([
      'E.DATA       003000 003000 000258 005',
      '$.EMPTY      003000 003000 000000 005',
      '$.README     000000 000000 00004A 004',
      '$.HELLO   L  FF1900 FF1900 000021 003',
      '$.!BOOT      000000 000000 00000B 002',
    ]);
  });
});
