import {
  CRTC_ADDRESS,
  CRTC_DATA,
  CRTC_R10_CURSOR_START,
  CRTC_R11_CURSOR_END,
  CRTC_R12_START_ADDRESS_HIGH,
  CRTC_R13_START_ADDRESS_LOW,
  CRTC_R14_CURSOR_ADDRESS_HIGH,
  CRTC_R15_CURSOR_ADDRESS_LOW,
  CRTC_R8_INTERLACE_AND_SKEW,
  Crtc6845,
  cursorBlinkOn,
  cursorOnScanline,
} from './crtc6845';

/** MOS 1.20's CRTC tables, R0-R11, as it writes them (R7 one more than the ROM's table: Stage 37 doc). */
const TABLE = {
  modes012: [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  mode3: [0x7f, 0x50, 0x62, 0x28, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  modes45: [0x3f, 0x28, 0x31, 0x24, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  mode6: [0x3f, 0x28, 0x31, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  mode7: [0x3f, 0x28, 0x33, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x93, 0x12, 0x72, 0x13],
} as const;

type TableName = keyof typeof TABLE;

function set(crtc: Crtc6845, n: number, value: number): void {
  crtc.write(CRTC_ADDRESS, n);
  crtc.write(CRTC_DATA, value);
}

function setStart(crtc: Crtc6845, ma: number): void {
  set(crtc, CRTC_R12_START_ADDRESS_HIGH, ma >> 8);
  set(crtc, CRTC_R13_START_ADDRESS_LOW, ma & 0xff);
}

function setCursor(crtc: Crtc6845, ma: number): void {
  set(crtc, CRTC_R14_CURSOR_ADDRESS_HIGH, ma >> 8);
  set(crtc, CRTC_R15_CURSOR_ADDRESS_LOW, ma & 0xff);
}

/**
 * A CRTC with one of the MOS's tables and a start address, reset to the top
 * of an even field. The clock is left at 2 MHz, so tick(1) is one character
 * whatever the MODE: here we count characters, not time.
 */
function crtcFor(name: TableName, start: number, changes: Readonly<Record<number, number>> = {}): Crtc6845 {
  const crtc = new Crtc6845();
  TABLE[name].forEach((v, r) => {
    set(crtc, r, v);
  });
  setStart(crtc, start);
  for (const [r, v] of Object.entries(changes)) set(crtc, Number(r), v);
  crtc.reset();
  return crtc;
}

/** Characters until the next field starts (fieldLine back to 0). */
function toNextField(crtc: Crtc6845): void {
  const fields = crtc.fieldsSinceReset;
  while (crtc.fieldsSinceReset === fields) crtc.tick(1);
}

describe('6845 memory address (MA) counter', () => {
  test('MA starts the field at R12/R13 and goes up by one each character clock', () => {
    const crtc = crtcFor('mode7', 0x2800);
    expect(crtc.memoryAddress).toBe(0x2800);
    crtc.tick(5);
    expect(crtc.character).toBe(5);
    expect(crtc.memoryAddress).toBe(0x2805);
    crtc.tick(34);
    expect(crtc.memoryAddress).toBe(0x2827); // character 39, the last displayed one
  });

  test('MA keeps counting through the blanking part of the line, past R1', () => {
    const crtc = crtcFor('mode7', 0x2800);
    crtc.tick(63); // character 63 = R0, the line's last
    expect(crtc.displayEnable).toBe(false);
    expect(crtc.memoryAddress).toBe(0x283f);
  });

  test('every scanline of a character row starts again at the row\'s start address', () => {
    const crtc = crtcFor('modes45', 0x0b00);
    crtc.tick(64); // one whole line: now scanline 1, character 0
    expect(crtc.scanline).toBe(1);
    expect(crtc.character).toBe(0);
    expect(crtc.memoryAddress).toBe(0x0b00);
  });

  test('after a row\'s last scanline (R9), the next row starts R1 characters on', () => {
    const crtc = crtcFor('modes45', 0x0b00); // R9 = 7: 8 lines a row, R1 = &28
    crtc.tick(64 * 8);
    expect(crtc.row).toBe(1);
    expect(crtc.scanline).toBe(0);
    expect(crtc.memoryAddress).toBe(0x0b28);
  });

  test('in interlace sync and video (MODE 7) a row is 10 lines a field and still moves on by R1', () => {
    const crtc = crtcFor('mode7', 0x2800);
    crtc.tick(64 * 10);
    expect(crtc.row).toBe(1);
    expect(crtc.memoryAddress).toBe(0x2828);
    crtc.tick(64 * 10 * 23);
    expect(crtc.row).toBe(24);
    expect(crtc.memoryAddress).toBe(0x2bc0);
  });

  // Object.keys gives string[]; TABLE's keys are exactly TableName.
  test.each(Object.keys(TABLE) as TableName[])('%s: every displayed character of a field reads start + row × R1 + character', (name) => {
    const r1 = TABLE[name][1];
    const r6 = TABLE[name][6];
    const start = 0x2bf0; // so MODE 7's run goes past &2BFF: MA itself doesn't wrap there
    const crtc = crtcFor(name, start);
    let checked = 0;
    let wrong = 0;
    while (crtc.fieldsSinceReset === 0) {
      if (crtc.displayEnable) {
        checked++;
        if (crtc.memoryAddress !== ((start + crtc.row * r1 + crtc.character) & 0x3fff)) wrong++;
      }
      crtc.tick(1);
    }
    expect(wrong).toBe(0);
    // Every displayed character of every displayed scanline: R1 × R6 rows × lines per row.
    const linesPerRow = name === 'mode7' ? 10 : (TABLE[name][9] + 1);
    expect(checked).toBe(r1 * r6 * linesPerRow);
  });

  test('MA is 14 bits: it wraps from &3FFF to &0000', () => {
    const crtc = crtcFor('mode7', 0x3fff);
    crtc.tick(1);
    expect(crtc.memoryAddress).toBe(0x0000);
  });

  test('R12/R13 written mid-field change nothing until the next field starts', () => {
    const crtc = crtcFor('mode7', 0x2800);
    crtc.tick(64 * 10 * 12); // row 12
    setStart(crtc, 0x2828);
    expect(crtc.displayStart).toBe(0x2800);
    crtc.tick(64 * 10);
    expect(crtc.row).toBe(13);
    expect(crtc.memoryAddress).toBe(0x2800 + 13 * 0x28); // still the old start's rows
    toNextField(crtc);
    expect(crtc.displayStart).toBe(0x2828);
    expect(crtc.memoryAddress).toBe(0x2828);
  });

  test('reset reloads MA from R12/R13 and starts the field count again', () => {
    const crtc = crtcFor('mode7', 0x2800);
    toNextField(crtc);
    crtc.tick(1234);
    setStart(crtc, 0x2850);
    crtc.reset();
    expect(crtc.memoryAddress).toBe(0x2850);
    expect(crtc.displayStart).toBe(0x2850);
    expect(crtc.fieldsSinceReset).toBe(0);
  });
});

describe('6845 cursor output (CUDISP)', () => {
  /** Every (row, character, scanline) in one field where the cursor output was on. */
  function cursorSpots(crtc: Crtc6845): string[] {
    const spots: string[] = [];
    const fields = crtc.fieldsSinceReset;
    while (crtc.fieldsSinceReset === fields) {
      if (crtc.cursor) spots.push(`row ${String(crtc.row)} char ${String(crtc.character)} line ${String(crtc.scanline)}`);
      crtc.tick(1);
    }
    return spots;
  }

  test('is on only where MA = R14/R15, on scanlines R10 to R11', () => {
    // MODE 4's shape with a steady cursor on lines 6-7 at row 1, character 3.
    const crtc = crtcFor('modes45', 0x0b00, { [CRTC_R10_CURSOR_START]: 0x06, [CRTC_R11_CURSOR_END]: 0x07 });
    setCursor(crtc, 0x0b00 + 40 + 3);
    expect(cursorSpots(crtc)).toEqual(['row 1 char 3 line 6', 'row 1 char 3 line 7']);
  });

  test('MODE 7\'s underline cursor is RA 18 in the even field and RA 19 in the odd one', () => {
    // R10 = &12: steady, line 18. R11 = &13.
    const crtc = crtcFor('mode7', 0x2800, { [CRTC_R10_CURSOR_START]: 0x12 });
    setCursor(crtc, 0x28c9); // the > prompt's next cell: row 5, column 1
    expect(cursorSpots(crtc)).toEqual(['row 5 char 1 line 18']);
    expect(cursorSpots(crtc)).toEqual(['row 5 char 1 line 19']);
  });

  test('matches the counter, not the RAM address: a cursor MA past &2BFF still shows', () => {
    // The MOS's own numbers after a scroll: start &2A30, cursor &2DF1 (961 characters on: row 24, column 1).
    const crtc = crtcFor('mode7', 0x2a30, { [CRTC_R10_CURSOR_START]: 0x12 });
    setCursor(crtc, 0x2df1);
    expect(cursorSpots(crtc)).toEqual(['row 24 char 1 line 18']);
  });

  test('is never on outside display enable, even where MA matches', () => {
    // &2BED is character 45 of row 24 (in the line's blanking) and character 5
    // of row 25 (past R6): reached twice, displayed never. (&2800 + 50 wouldn't
    // do: it's also row 1, character 10.)
    const crtc = crtcFor('mode7', 0x2800, { [CRTC_R10_CURSOR_START]: 0x12 });
    setCursor(crtc, 0x2bed);
    expect(cursorSpots(crtc)).toEqual([]);
  });

  test('R10 blink mode %01 means no cursor at all', () => {
    const crtc = crtcFor('mode7', 0x2800, { [CRTC_R10_CURSOR_START]: 0x20 }); // VDU 23,1,0's value
    setCursor(crtc, 0x28c9);
    expect(cursorSpots(crtc)).toEqual([]);
  });

  test('R8 cursor skew %11 turns the cursor off', () => {
    const crtc = crtcFor('mode7', 0x2800, { [CRTC_R10_CURSOR_START]: 0x12, [CRTC_R8_INTERLACE_AND_SKEW]: 0xd3 });
    setCursor(crtc, 0x28c9);
    expect(cursorSpots(crtc)).toEqual([]);
  });

  test('MODE 7\'s %11 blink: on for 16 fields, off for 16, counted by the 6845 itself', () => {
    const crtc = crtcFor('mode7', 0x2800); // R10 = &72
    setCursor(crtc, 0x28c9);
    const seen: string[] = [];
    for (let field = 0; field < 64; field++) seen.push(cursorSpots(crtc).length > 0 ? '#' : '.');
    expect(seen.join('')).toBe('################................################................');
  });
});

describe('cursorBlinkOn (R10 bits 5-6 and the field count)', () => {
  test('%00 is always on and %01 is never on', () => {
    for (let f = 0; f < 64; f++) {
      expect(cursorBlinkOn(0x00, f)).toBe(true);
      expect(cursorBlinkOn(0x20, f)).toBe(false);
    }
  });

  test('%10 blinks every 16 fields: 8 on, 8 off', () => {
    const pattern = Array.from({ length: 32 }, (_, f) => (cursorBlinkOn(0x40, f) ? '#' : '.')).join('');
    expect(pattern).toBe('########........########........');
  });

  test('%11 blinks every 32 fields: 16 on, 16 off (1.5625 Hz at 50 fields a second)', () => {
    const pattern = Array.from({ length: 64 }, (_, f) => (cursorBlinkOn(0x60, f) ? '#' : '.')).join('');
    expect(pattern).toBe('################................################................');
  });

  test('the start-line bits (0-4) don\'t affect the blink', () => {
    expect(cursorBlinkOn(0x72, 0)).toBe(true);
    expect(cursorBlinkOn(0x72, 16)).toBe(false);
  });
});

describe('cursorOnScanline (R10 bits 0-4 to R11)', () => {
  test('covers the start line to the end line, inclusive', () => {
    const lines = Array.from({ length: 20 }, (_, ra) => (cursorOnScanline(0x72, 0x13, ra) ? ra : -1)).filter((ra) => ra >= 0);
    expect(lines).toEqual([18, 19]);
  });

  test('MODE 0\'s R10 &67, R11 &08: lines 7 and 8 (but R9 = 7, so only 7 is ever reached)', () => {
    expect(cursorOnScanline(0x67, 0x08, 6)).toBe(false);
    expect(cursorOnScanline(0x67, 0x08, 7)).toBe(true);
    expect(cursorOnScanline(0x67, 0x08, 8)).toBe(true);
  });

  test('start after end shows no lines (our choice: 6845 variants differ)', () => {
    for (let ra = 0; ra < 32; ra++) expect(cursorOnScanline(0x09, 0x02, ra)).toBe(false);
  });
});
