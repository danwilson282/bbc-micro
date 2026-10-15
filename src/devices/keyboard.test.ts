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

describe('Keyboard: the autoscan counter and CA2 (Stage 35)', () => {
  /** A keyboard with autoscan on and CA2 wired to a recorder of every change (the level sent on connecting is dropped). */
  function scanning(): { keyboard: Keyboard; levels: number[] } {
    const levels: number[] = [];
    const keyboard = new Keyboard();
    keyboard.connectCa2((level) => {
      levels.push(level);
    });
    levels.length = 0;
    keyboard.setAutoscan(true);
    return { keyboard, levels };
  }

  it('the counter steps once per microsecond (2 CPU cycles) and wraps after 15: 16 columns, 10-15 empty', () => {
    const { keyboard } = scanning();
    keyboard.selectColumn(0); // ignored: autoscan is on
    expect(keyboard.scanColumn).toBe(0);
    keyboard.tick(1);
    expect(keyboard.scanColumn).toBe(0); // half a microsecond, kept for later
    keyboard.tick(1);
    expect(keyboard.scanColumn).toBe(1);
    keyboard.tick(2 * 15);
    expect(keyboard.scanColumn).toBe(0); // 1 + 15 = 16 = 0 again
  });

  it('with nothing pressed CA2 stays low for a whole sweep, and no edge is sent', () => {
    const { keyboard, levels } = scanning();
    keyboard.tick(2 * 32);
    expect(keyboard.ca2).toBe(0);
    expect(levels).toEqual([]);
    expect(keyboard.ca2Rises).toBe(0);
  });

  it('A (&41) held: CA2 rises for the 1 µs the counter is on column 1, once every 16 µs', () => {
    const { keyboard, levels } = scanning();
    keyboard.press(0x41);
    keyboard.tick(2); // counter 0 → 1
    expect(keyboard.ca2).toBe(1);
    keyboard.tick(2); // 1 → 2
    expect(keyboard.ca2).toBe(0);
    keyboard.tick(2 * 32); // two more sweeps: column 1 at µs 17 and 33
    expect(levels).toEqual([1, 0, 1, 0, 1, 0]);
    expect(keyboard.ca2Rises).toBe(3);
  });

  it('a pulse inside one long tick is still sent: a 7-cycle instruction passing column 1 gives a rise and a fall', () => {
    const { keyboard, levels } = scanning();
    keyboard.press(0x41);
    keyboard.tick(7); // 3 µs: counter 0 → 1 → 2 → 3 (and half a µs over)
    expect(levels).toEqual([1, 0]);
    expect(keyboard.ca2).toBe(0);
  });

  it('keys in neighbouring columns keep CA2 high across both: one rise, not two', () => {
    const { keyboard, levels } = scanning();
    keyboard.press(0x41); // A, column 1
    keyboard.press(0x42); // X, column 2
    keyboard.tick(2 * 3); // columns 1, 2, 3
    expect(levels).toEqual([1, 0]);
  });

  it('row 0 never reaches CA2: SHIFT, CTRL and closed links are invisible to the scan', () => {
    const { keyboard, levels } = scanning();
    keyboard.links = 0x00; // every link closed
    keyboard.press(0x00); // SHIFT
    keyboard.press(0x01); // CTRL
    keyboard.tick(2 * 32);
    expect(levels).toEqual([]);
  });

  it('autoscan off: the counter follows PA0-PA3 at once, and CA2 says whether that column has a key in rows 1-7', () => {
    const { keyboard, levels } = scanning();
    keyboard.press(0x41);
    keyboard.setAutoscan(false);
    keyboard.selectColumn(0x0f); // the MOS's dummy column: no keys there
    expect(keyboard.ca2).toBe(0);
    keyboard.selectColumn(0x41); // only PA0-PA3 count: column 1
    expect(keyboard.scanColumn).toBe(1);
    expect(keyboard.ca2).toBe(1);
    keyboard.tick(2 * 10); // the counter doesn't count while the CPU picks
    expect(keyboard.scanColumn).toBe(1);
    expect(levels).toEqual([1]);
  });

  it('a key pressed in the column already selected raises CA2 straight away, and releasing it drops CA2', () => {
    const { keyboard, levels } = scanning();
    keyboard.setAutoscan(false);
    keyboard.selectColumn(1);
    keyboard.press(0x41);
    expect(keyboard.ca2).toBe(1);
    keyboard.release(0x41);
    expect(levels).toEqual([1, 0]);
  });

  it('autoscan back on counts on from the CPU\'s last column', () => {
    const { keyboard } = scanning();
    keyboard.setAutoscan(false);
    keyboard.selectColumn(7);
    keyboard.setAutoscan(true);
    keyboard.tick(2);
    expect(keyboard.scanColumn).toBe(8);
  });

  it('resetScan (power-on) puts the counter at 0 and CA2 low, and clears the rise count', () => {
    const { keyboard } = scanning();
    keyboard.press(0x41);
    keyboard.tick(2);
    keyboard.resetScan();
    expect([keyboard.scanColumn, keyboard.ca2, keyboard.ca2Rises]).toEqual([0, 0, 0]);
  });
});

describe('Keyboard: CA2 is always driven (Stage 35)', () => {
  it('connecting CA2 sends the current level at once, so a VIA input floating high is pulled low before the first key', () => {
    const levels: number[] = [];
    new Keyboard().connectCa2((level) => {
      levels.push(level);
    });
    expect(levels).toEqual([0]);
  });
});
