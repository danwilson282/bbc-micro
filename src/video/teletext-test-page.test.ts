import { mode7Text } from './mode7-text';
import { decodeRow } from './teletext-attributes';
import { TEST_PAGE_ROWS, pageRow, teletextTestPage } from './teletext-test-page';

describe('pageRow: one teletext row from bytes and text', () => {
  test('mixes control codes and text, and pads with spaces to 40', () => {
    const bytes = pageRow([0x81, 'Hi']);
    expect(bytes).toHaveLength(40);
    expect(bytes.slice(0, 4)).toEqual([0x81, 0x48, 0x69, 0x20]);
  });

  test('a row longer than 40 cells is an error, not a silent wrap onto the next row', () => {
    expect(() => pageRow(['x'.repeat(41)])).toThrow(/41 cells/);
  });

  test('text must be 7-bit: a £ is written as # (&23)', () => {
    expect(() => pageRow(['£'])).toThrow(/&23/);
  });
});

describe('the Stage 32 test page', () => {
  const page = teletextTestPage();

  test('is exactly 1,000 bytes: 25 rows of 40', () => {
    expect(page).toHaveLength(1000);
    expect(TEST_PAGE_ROWS).toHaveLength(25);
  });

  test('uses every Stage 32 control code', () => {
    const codes = new Set(page.filter((b) => (b & 0x7f) < 0x20).map((b) => b & 0x7f));
    for (const code of [1, 2, 3, 4, 5, 6, 7, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x1f]) expect(codes).toContain(code);
  });

  test('shows all 64 sixels, contiguous and separated', () => {
    const mosaics = TEST_PAGE_ROWS.flatMap((row) => decodeRow(row)).filter((c) => c.kind === 'mosaic');
    for (const separated of [false, true]) {
      expect(new Set(mosaics.filter((c) => c.separated === separated).map((c) => c.code)).size).toBe(64);
    }
  });

  test('reads as text with its title on the first row', () => {
    const rows = mode7Text((address) => page[address - 0x7c00] ?? 0);
    expect(rows[0]).toContain('Teletext colours & graphics');
  });
});
