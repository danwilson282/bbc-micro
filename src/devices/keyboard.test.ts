import { BBC_KEYS, DEFAULT_LINKS, Keyboard, MATRIX_COLUMNS, MATRIX_ROWS, bbcKey, keyColumn, keyNumber, keyRow } from './keyboard';

const SHIFT = 0x00;
const CTRL = 0x01;
const KEY_A = 0x41; // row 4, column 1
const KEY_Q = 0x10;
const RETURN = 0x49;

/** The key number for a key's name, or a test failure. */
function numberOf(name: string): number {
  const key = BBC_KEYS.find((k) => k.name === name);
  if (key === undefined) throw new Error(`no BBC key called ${name}`);
  return key.key;
}

describe('BBC_KEYS: the matrix positions (Advanced User Guide internal key numbers)', () => {
  it('is 10 columns by 8 rows', () => {
    expect([MATRIX_COLUMNS, MATRIX_ROWS]).toEqual([10, 8]);
  });

  it('a key number is row × 16 + column: &41 is row 4, column 1', () => {
    expect(keyNumber(4, 1)).toBe(0x41);
    expect([keyRow(0x41), keyColumn(0x41)]).toEqual([4, 1]);
  });

  // INKEY -n tests internal key n - 1 (AUG). Every key here is from its INKEY table.
  it.each([
    ['SHIFT', -1], ['CTRL', -2], ['Q', -17], ['3', -18], ['f4', -21], ['^', -25], ['LEFT', -26],
    ['f0', -33], ['W', -34], ['_', -41], ['DOWN', -42], ['1', -49], ['2', -50], ['[', -57], ['UP', -58],
    ['CAPS LOCK', -65], ['A', -66], ['@', -72], [':', -73], ['RETURN', -74],
    ['SHIFT LOCK', -81], ['S', -82], [';', -88], [']', -89], ['DELETE', -90],
    ['TAB', -97], ['Z', -98], ['SPACE', -99], ['/', -105], ['COPY', -106],
    ['ESCAPE', -113], ['f1', -114], ['f9', -120], ['\\', -121], ['RIGHT', -122],
  ])('%s is internal key INKEY(%i) - 1', (name, inkey) => {
    expect(numberOf(name)).toBe(-inkey - 1);
  });

  it('has 72 keys (80 positions less 8 links), and every one is in a different place on the grid', () => {
    expect(BBC_KEYS).toHaveLength(72);
    expect(new Set(BBC_KEYS.map((k) => k.key)).size).toBe(72);
  });

  it('fills every position except row 0 columns 2-9, which are the eight links', () => {
    for (let row = 0; row < MATRIX_ROWS; row++) {
      for (let column = 0; column < MATRIX_COLUMNS; column++) {
        const isLink = row === 0 && column >= 2;
        expect(bbcKey(keyNumber(row, column)) === undefined).toBe(isLink);
      }
    }
  });

  it('has no BREAK: it is wired to reset, not to the matrix', () => {
    expect(BBC_KEYS.some((k) => k.name === 'BREAK')).toBe(false);
  });

  it('knows the BBC shifted symbols: SHIFT+2 is ", SHIFT+: is *, SHIFT+_ is £', () => {
    expect(bbcKey(numberOf('2'))?.shifted).toBe('"');
    expect(bbcKey(numberOf(':'))?.shifted).toBe('*');
    expect(bbcKey(numberOf('_'))?.shifted).toBe('£');
  });
});

describe('Keyboard: pressing and releasing switches', () => {
  it('starts with no key down', () => {
    const kb = new Keyboard();
    expect(BBC_KEYS.some((k) => kb.isDown(k.key))).toBe(false);
  });

  it('a pressed key is down until it is released', () => {
    const kb = new Keyboard();
    kb.press(KEY_A);
    expect(kb.isDown(KEY_A)).toBe(true);
    kb.release(KEY_A);
    expect(kb.isDown(KEY_A)).toBe(false);
  });

  it('pressing one key closes only its own switch: A (&41) is not Q (&10), S (&51) or X (&42)', () => {
    const kb = new Keyboard();
    kb.press(KEY_A);
    expect([kb.isDown(KEY_Q), kb.isDown(0x51), kb.isDown(0x42)]).toEqual([false, false, false]);
  });

  it('several keys can be down at once, and release one by one', () => {
    const kb = new Keyboard();
    kb.press(SHIFT);
    kb.press(KEY_A);
    kb.press(RETURN);
    kb.release(KEY_A);
    expect([kb.isDown(SHIFT), kb.isDown(KEY_A), kb.isDown(RETURN)]).toEqual([true, false, true]);
    kb.releaseAll();
    expect([kb.isDown(SHIFT), kb.isDown(RETURN)]).toEqual([false, false]);
  });

  it('pressing a key twice is still one closed switch: one release opens it', () => {
    const kb = new Keyboard();
    kb.press(KEY_A);
    kb.press(KEY_A);
    kb.release(KEY_A);
    expect(kb.isDown(KEY_A)).toBe(false);
  });

  it('columnRows gives a column\'s closed rows as a bit mask: A and Z in column 1 are rows 4 and 6, &50', () => {
    const kb = new Keyboard();
    kb.press(KEY_A);
    kb.press(0x61); // Z
    expect(kb.columnRows(1)).toBe(0x50);
    expect(kb.columnRows(2)).toBe(0x00);
  });

  it('a press or release outside the grid (columns 10-15, the link positions) changes nothing', () => {
    const kb = new Keyboard();
    kb.press(0x4a);
    kb.press(0x05); // a link position: links are set with .links, not pressed
    expect(kb.isDown(0x4a)).toBe(false);
    expect(kb.isDown(0x05)).toBe(false);
  });

  it('calls onChange when a switch opens or closes, not when nothing changes', () => {
    const changes: number[] = [];
    const kb = new Keyboard(DEFAULT_LINKS, () => changes.push(1));
    kb.press(KEY_A);
    kb.press(KEY_A);
    kb.release(KEY_A);
    kb.release(KEY_A);
    kb.releaseAll();
    expect(changes).toHaveLength(2);
  });
});

// These are the Stage 28 stub's tests, kept: the links and PA7 behave as before.
describe('Keyboard: the links and PA7 (as the Stage 28 stub did)', () => {
  it('with no key pressed SHIFT, CTRL and A all answer PA7 = 0', () => {
    const kb = new Keyboard();
    expect([kb.pa7(SHIFT, false), kb.pa7(CTRL, false), kb.pa7(KEY_A, false)]).toEqual([0, 0, 0]);
  });

  it('with autoscan off, a pressed key answers PA7 = 1 when its number is on PA0-PA6', () => {
    const kb = new Keyboard();
    kb.press(KEY_A);
    expect(kb.pa7(KEY_A, false)).toBe(1);
    expect(kb.pa7(KEY_Q, false)).toBe(0);
  });

  it('with all links open (the default, &FF) every link reads "not pressed"', () => {
    const kb = new Keyboard();
    expect(kb.links).toBe(DEFAULT_LINKS);
    for (let column = 2; column <= 9; column++) expect(kb.pa7(column, false)).toBe(0);
  });

  it('a closed link reads as a pressed key: bit b of links is the link on column 9 - b, and 0 = closed', () => {
    const kb = new Keyboard(0xfe); // bit 0 clear: column 9 closed
    expect(kb.pa7(0x09, false)).toBe(1);
    expect(kb.pa7(0x08, false)).toBe(0);
    kb.links = 0x7f; // bit 7 clear: column 2 closed
    expect(kb.pa7(0x02, false)).toBe(1);
    expect(kb.pa7(0x09, false)).toBe(0);
  });

  it('a closed link shows in its column\'s rows as row 0', () => {
    const kb = new Keyboard(0xfe);
    expect(kb.columnRows(9)).toBe(0x01);
  });

  it('links are only on row 0: column 9 in row 1 is an ordinary key (LEFT), and not down', () => {
    const kb = new Keyboard(0x00); // every link closed
    expect(kb.pa7(0x09, false)).toBe(1);
    expect(kb.pa7(0x19, false)).toBe(0);
  });

  it('columns 10-15 don\'t exist (10 columns): nothing is there', () => {
    const kb = new Keyboard(0x00);
    expect(kb.pa7(0x0a, false)).toBe(0);
    expect(kb.pa7(0x0f, false)).toBe(0);
  });

  it('with autoscan on (latch bit 3 = 1) the CPU isn\'t picking the key: PA7 is driven low (Stage 35 builds the scan)', () => {
    const kb = new Keyboard(0x00);
    kb.press(KEY_A);
    expect(kb.pa7(0x09, true)).toBe(0);
    expect(kb.pa7(KEY_A, true)).toBe(0);
  });

  it('reads only PA0-PA6: bit 7 of the key number is PA7 itself, the answer', () => {
    const kb = new Keyboard(0xfe);
    expect(kb.pa7(0x89, false)).toBe(1);
  });
});
