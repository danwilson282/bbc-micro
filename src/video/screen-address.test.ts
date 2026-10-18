import { bitmapAddress, screenAddress, teletextAddress } from './screen-address';

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
    expect(bitmapAddress(0x0b00, 0)).toBe(0x5800); // MODE 4's R12/R13 = &0B00: &5800
    expect(bitmapAddress(0x0b00, 7)).toBe(0x5807);
    expect(bitmapAddress(0x0b01, 0)).toBe(0x5808);
  });

  test('every MODE\'s screen start is R12/R13 × 8', () => {
    expect(bitmapAddress(0x0600, 0)).toBe(0x3000); // MODES 0-2
    expect(bitmapAddress(0x0800, 0)).toBe(0x4000); // MODE 3
    expect(bitmapAddress(0x0b00, 0)).toBe(0x5800); // MODES 4-5
    expect(bitmapAddress(0x0c00, 0)).toBe(0x6000); // MODE 6
  });

  test('RA3 and RA4 aren\'t address bits: MODE 3 and 6\'s scanlines 8 and 9 would read lines 0 and 1 again (the board blanks them: Stage 43)', () => {
    expect(bitmapAddress(0x0800, 8)).toBe(0x4000);
    expect(bitmapAddress(0x0800, 9)).toBe(0x4001);
  });

  test('MA12 (the wrap-around bit) has no effect yet: Stage 43 adds the screen-size adjustment', () => {
    expect(bitmapAddress(0x1000 | 0x0600, 0)).toBe(0x3000);
  });
});

describe('screenAddress', () => {
  test('MA13 picks the scheme', () => {
    expect(screenAddress(0x2800, 5)).toBe(0x7c00);
    expect(screenAddress(0x0b00, 5)).toBe(0x5805);
  });
});
