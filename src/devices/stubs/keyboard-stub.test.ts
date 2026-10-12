import { DEFAULT_LINKS, KeyboardStub } from './keyboard-stub';

const SHIFT = 0x00;
const CTRL = 0x01;
const KEY_A = 0x41; // row 4, column 1

describe('KeyboardStub (no keys pressed; the real keyboard is Part 7)', () => {
  it('no real key is ever down: SHIFT, CTRL and A all answer PA7 = 0', () => {
    const kb = new KeyboardStub();
    expect([kb.pa7(SHIFT, false), kb.pa7(CTRL, false), kb.pa7(KEY_A, false)]).toEqual([0, 0, 0]);
  });

  it('with all links open (the default, &FF) every link reads "not pressed"', () => {
    const kb = new KeyboardStub();
    expect(kb.links).toBe(DEFAULT_LINKS);
    for (let column = 2; column <= 9; column++) expect(kb.pa7(column, false)).toBe(0);
  });

  it('a closed link reads as a pressed key: bit b of links is the link on column 9 - b, and 0 = closed', () => {
    const kb = new KeyboardStub(0xfe); // bit 0 clear: column 9 closed
    expect(kb.pa7(0x09, false)).toBe(1);
    expect(kb.pa7(0x08, false)).toBe(0);
    kb.links = 0x7f; // bit 7 clear: column 2 closed
    expect(kb.pa7(0x02, false)).toBe(1);
    expect(kb.pa7(0x09, false)).toBe(0);
  });

  it('links are only on row 0: column 9 in row 1 is an ordinary key, and not down', () => {
    const kb = new KeyboardStub(0x00); // every link closed
    expect(kb.pa7(0x09, false)).toBe(1);
    expect(kb.pa7(0x19, false)).toBe(0);
  });

  it('columns 10-15 don\'t exist (10 columns): nothing is there', () => {
    const kb = new KeyboardStub(0x00);
    expect(kb.pa7(0x0a, false)).toBe(0);
    expect(kb.pa7(0x0f, false)).toBe(0);
  });

  it('with autoscan on (latch bit 3 = 1) the CPU isn\'t picking the key: PA7 is driven low', () => {
    const kb = new KeyboardStub(0x00);
    expect(kb.pa7(0x09, true)).toBe(0);
  });

  it('reads only PA0-PA6: bit 7 of the key number is PA7 itself, the answer', () => {
    const kb = new KeyboardStub(0xfe);
    expect(kb.pa7(0x89, false)).toBe(1);
  });
});
