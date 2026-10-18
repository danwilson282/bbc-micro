import { SCREEN_10K, SCREEN_16K, SCREEN_20K, SCREEN_8K, WRAP_SUBTRACT, bitmapAddress, screenAddress, teletextAddress, type ScreenSize } from './screen-address';

describe('teletext addressing (MA13 = 1, MODE 7)', () => {
  test('MOS 1.20\'s R12/R13 = &2800 is &7C00: MA11 is A14, A10-A13 are forced high', () => {
    expect(teletextAddress(0x2800)).toBe(0x7c00);
  });

  test('with MA11 = 0 the screen is &3C00 (a 16K machine\'s MODE 7)', () => {
    expect(teletextAddress(0x2000)).toBe(0x3c00);
  });

  test('MA0-MA9 are the low 10 bits: the 1,000th cell is &7FE7', () => {
    expect(teletextAddress(0x2800 + 999)).toBe(0x7fe7);
  });

  test('MA10 isn\'t wired, so the counter going past &2BFF wraps the screen to &7C00', () => {
    expect(teletextAddress(0x2bff)).toBe(0x7fff);
    expect(teletextAddress(0x2c00)).toBe(0x7c00);
    expect(teletextAddress(0x2df1)).toBe(0x7df1); // the MOS's cursor MA after a scroll
  });

  test('the AUG\'s formula R12/R13 = (start - &7400) EOR &2000 comes back to start for every row start', () => {
    for (let row = 0; row < 25; row++) {
      const start = 0x7c00 + row * 40;
      expect(teletextAddress((start - 0x7400) ^ 0x2000)).toBe(start);
    }
  });
});

describe('bitmap addressing (MA13 = 0, MODES 0-6)', () => {
  test('each character is 8 bytes, one per scanline: RA0-RA2 are A0-A2', () => {
    expect(bitmapAddress(0x0b00, 0, SCREEN_10K)).toBe(0x5800); // MODE 4's R12/R13 = &0B00: &5800
    expect(bitmapAddress(0x0b00, 7, SCREEN_10K)).toBe(0x5807);
    expect(bitmapAddress(0x0b01, 0, SCREEN_10K)).toBe(0x5808);
  });

  test('every MODE\'s screen start is R12/R13 × 8', () => {
    expect(bitmapAddress(0x0600, 0, SCREEN_20K)).toBe(0x3000); // MODES 0-2
    expect(bitmapAddress(0x0800, 0, SCREEN_16K)).toBe(0x4000); // MODE 3
    expect(bitmapAddress(0x0b00, 0, SCREEN_10K)).toBe(0x5800); // MODES 4-5
    expect(bitmapAddress(0x0c00, 0, SCREEN_8K)).toBe(0x6000); // MODE 6
  });

  test('RA3 and RA4 aren\'t address bits: MODE 3 and 6\'s scanlines 8 and 9 would read lines 0 and 1 again (RA3 blanks them instead)', () => {
    expect(bitmapAddress(0x0800, 8, SCREEN_16K)).toBe(0x4000);
    expect(bitmapAddress(0x0800, 9, SCREEN_16K)).toBe(0x4001);
  });

});

describe('hardware wrap-around (MA12 = 1: subtract the screen size C0/C1 select)', () => {
  test('the codes are (C1 << 1) | C0, as BeebWiki\'s table and the MOS\'s latch writes have them', () => {
    expect(SCREEN_16K).toBe(0); // C1 = 0, C0 = 0: MODE 3
    expect(SCREEN_8K).toBe(1); // C1 = 0, C0 = 1: MODE 6
    expect(SCREEN_20K).toBe(2); // C1 = 1, C0 = 0: MODES 0-2
    expect(SCREEN_10K).toBe(3); // C1 = 1, C0 = 1: MODES 4-5
    expect(WRAP_SUBTRACT).toEqual([0x4000, 0x2000, 0x5000, 0x2800]);
  });

  test('each size + its screen start is &8000: every screen ends at the top of RAM', () => {
    const starts = [0x4000, 0x6000, 0x3000, 0x5800];
    WRAP_SUBTRACT.forEach((size, code) => {
      expect(size + (starts[code] ?? 0)).toBe(0x8000);
    });
  });

  test('MA &1000 (just past &7FFF) wraps to the start of each screen size', () => {
    expect(bitmapAddress(0x1000, 0, SCREEN_20K)).toBe(0x3000);
    expect(bitmapAddress(0x1000, 0, SCREEN_16K)).toBe(0x4000);
    expect(bitmapAddress(0x1000, 0, SCREEN_10K)).toBe(0x5800);
    expect(bitmapAddress(0x1000, 0, SCREEN_8K)).toBe(0x6000);
  });

  test('RA still picks the byte in the cell after a wrap: MA &1001, RA 7 in MODE 4 is &580F', () => {
    expect(bitmapAddress(0x1001, 7, SCREEN_10K)).toBe(0x580f);
  });

  test('below MA12 the size makes no difference: the last byte of RAM is MA &0FFF, RA 7 in every size', () => {
    for (const size of [SCREEN_16K, SCREEN_8K, SCREEN_20K, SCREEN_10K] as const) {
      expect(bitmapAddress(0x0fff, 7, size)).toBe(0x7fff);
      expect(bitmapAddress(0x0600, 0, size)).toBe(0x3000);
    }
  });

  test('MODE 0 scrolled once (R12/R13 = &0650): row 30 ends at &7FF8, row 31 is the row the scroll freed at &3000', () => {
    const start = 0x0650;
    expect(bitmapAddress(start + 30 * 80 + 79, 0, SCREEN_20K)).toBe(0x7ff8);
    expect(bitmapAddress(start + 31 * 80, 0, SCREEN_20K)).toBe(0x3000);
    expect(bitmapAddress(start + 31 * 80 + 79, 0, SCREEN_20K)).toBe(0x3278);
  });

  test('every scrolled start of every size reads its whole screen exactly once, in ring order', () => {
    const screens: readonly { size: ScreenSize; start: number; cells: number }[] = [
      { size: SCREEN_20K, start: 0x3000, cells: 80 * 32 },
      { size: SCREEN_16K, start: 0x4000, cells: 80 * 25 }, // MODE 3: 25 rows, &180 bytes spare
      { size: SCREEN_10K, start: 0x5800, cells: 40 * 32 },
      { size: SCREEN_8K, start: 0x6000, cells: 40 * 25 }, // MODE 6: &C0 bytes spare
    ];
    for (const { size, start, cells } of screens) {
      const bytes = 0x8000 - start;
      const wrong: string[] = [];
      for (let scroll = 0; scroll < bytes; scroll += 0x40) {
        const ma = (start + scroll) >> 3;
        for (let cell = 0; cell < cells; cell++) {
          const expected = start + ((scroll + cell * 8) % bytes) + 3;
          if (bitmapAddress(ma + cell, 3, size) !== expected) wrong.push(`start &${(start + scroll).toString(16)} cell ${String(cell)}`);
        }
      }
      expect(wrong).toEqual([]);
    }
  });

  test('teletext addressing ignores the size: MODE 7 is its own 1K ring', () => {
    expect(screenAddress(0x2800, 0, SCREEN_20K)).toBe(0x7c00);
    expect(screenAddress(0x2c00, 0, SCREEN_8K)).toBe(0x7c00);
  });
});

describe('screenAddress', () => {
  test('MA13 picks the scheme', () => {
    expect(screenAddress(0x2800, 5, SCREEN_10K)).toBe(0x7c00);
    expect(screenAddress(0x0b00, 5, SCREEN_10K)).toBe(0x5805);
  });
});
