import { CRTC_ADDRESS, CRTC_DATA, CRTC_R0_HORIZONTAL_TOTAL, CRTC_R3_SYNC_WIDTHS, CRTC_R8_INTERLACE_AND_SKEW, CRTC_R9_MAX_SCAN_LINE, Crtc6845 } from './crtc6845';

/**
 * MOS 1.20's CRTC tables, R0-R11, as it writes them to the chip (R7 one more
 * than the ROM's table: Stage 37 doc).
 */
const TABLE = {
  modes012: [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  mode3: [0x7f, 0x50, 0x62, 0x28, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  modes45: [0x3f, 0x28, 0x31, 0x24, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  mode6: [0x3f, 0x28, 0x31, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  mode7: [0x3f, 0x28, 0x33, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x93, 0x12, 0x72, 0x13],
} as const;

type TableName = keyof typeof TABLE;

/** The ULA's clock for each table: 2 MHz for the 80-column shapes. */
const FAST: Readonly<Record<TableName, boolean>> = { modes012: true, mode3: true, modes45: false, mode6: false, mode7: false };

function set(crtc: Crtc6845, n: number, value: number): void {
  crtc.write(CRTC_ADDRESS, n);
  crtc.write(CRTC_DATA, value);
}

interface Rig {
  readonly crtc: Crtc6845;
  /** CPU cycles one character takes: 1 at 2 MHz, 2 at 1 MHz. */
  readonly perChar: number;
  /** Every change of the VSYNC pin, with the CPU cycle it happened on. */
  readonly edges: { level: number; cycle: number }[];
  cycle: number;
}

/** A CRTC programmed like the MOS does it, then reset so the counters start at line 0, character 0. */
function rig(name: TableName, changes: Readonly<Record<number, number>> = {}): Rig {
  const fast = FAST[name];
  const crtc = new Crtc6845();
  TABLE[name].forEach((v, r) => {
    set(crtc, r, v);
  });
  for (const [r, v] of Object.entries(changes)) set(crtc, Number(r), v);
  crtc.connectClock(() => fast);
  const r: Rig = { crtc, perChar: fast ? 1 : 2, edges: [], cycle: 0 };
  crtc.connectVsync((level) => {
    r.edges.push({ level, cycle: r.cycle });
  });
  crtc.reset();
  r.edges.length = 0;
  return r;
}

/** One character clock. */
function char(r: Rig): void {
  r.cycle += r.perChar;
  r.crtc.tick(r.perChar);
}

/**
 * Runs characters until the next scanline starts. Returns how many. (Not
 * "until character 0": a counter that wraps past 255 passes 0 mid-line.)
 */
function toNextLine(r: Rig): number {
  const line = r.crtc.fieldLine;
  let n = 0;
  do {
    char(r);
    n++;
  } while (r.crtc.fieldLine === line);
  return n;
}

/** Runs to the start of the next field. Returns its scanlines. */
function wholeField(r: Rig): number {
  let lines = 0;
  do {
    toNextLine(r);
    lines++;
  } while (r.crtc.fieldLine !== 0);
  return lines;
}

describe('6845 horizontal counter', () => {
  it('counts characters 0 to R0 and wraps: MODE 7 (R0 = &3F) has 64 characters a line', () => {
    const r = rig('mode7');
    const seen: number[] = [r.crtc.character];
    for (let i = 0; i < 64; i++) {
      char(r);
      seen.push(r.crtc.character);
    }
    expect(seen).toEqual([...Array.from({ length: 64 }, (_, i) => i), 0]);
  });

  it('MODE 0 (R0 = &7F) has 128 characters a line', () => {
    expect(toNextLine(rig('modes012'))).toBe(128);
  });

  it('display enable is on for characters 0 to R1 - 1: 40 in MODE 7, 80 in MODE 0', () => {
    for (const [name, shown] of [['mode7', 40], ['modes012', 80]] as const) {
      const r = rig(name);
      const on: number[] = [];
      do {
        if (r.crtc.displayEnable) on.push(r.crtc.character);
        char(r);
      } while (r.crtc.character !== 0);
      expect(on).toEqual(Array.from({ length: shown }, (_, i) => i));
    }
  });

  it('HSYNC goes high at R2 for R3 bits 0-3 characters: 51-54 in MODE 7, 98-105 in MODE 0', () => {
    for (const [name, from, width] of [['mode7', 51, 4], ['modes012', 98, 8], ['modes45', 49, 4]] as const) {
      const r = rig(name);
      const high: number[] = [];
      do {
        if (r.crtc.hsync) high.push(r.crtc.character);
        char(r);
      } while (r.crtc.character !== 0);
      expect(high).toEqual(Array.from({ length: width }, (_, i) => from + i));
    }
  });

  it('an HSYNC width of 0 gives no HSYNC at all (the MC6845 reading)', () => {
    const r = rig('mode7', { [CRTC_R3_SYNC_WIDTHS]: 0x20 });
    let high = 0;
    do {
      if (r.crtc.hsync) high++;
      char(r);
    } while (r.crtc.character !== 0);
    expect(high).toBe(0);
  });

  it('compares with "equals", so lowering R0 below the counter makes one long line: on to 255, wrap, then up to the new R0', () => {
    const r = rig('modes012');
    for (let i = 0; i < 100; i++) char(r);
    expect(r.crtc.character).toBe(100);
    set(r.crtc, CRTC_R0_HORIZONTAL_TOTAL, 0x3f);
    // 100 → 255 is 155 characters, the wrap to 0 one more, then 0 → 63 and the line ends.
    expect(toNextLine(r)).toBe(156 + 64);
    expect(toNextLine(r)).toBe(64);
  });
});

describe('6845 vertical counters', () => {
  it('the scanline counter runs 0 to R9, then the row counter steps: MODE 0 rows are 8 lines', () => {
    const r = rig('modes012');
    const seen: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      seen.push([r.crtc.row, r.crtc.scanline]);
      toNextLine(r);
    }
    expect(seen).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [1, 0], [1, 1]]);
  });

  it('a non-interlaced MODE 0 field is (R4 + 1) × (R9 + 1) + R5 = 39 × 8 = 312 scanlines, every field', () => {
    const r = rig('modes012', { [CRTC_R8_INTERLACE_AND_SKEW]: 0x00 });
    expect([wholeField(r), wholeField(r), wholeField(r)]).toEqual([312, 312, 312]);
  });

  it('MODE 3\'s vertical adjust: 31 rows × 10 lines, then R5 = 2 lines outside any row (312 non-interlaced)', () => {
    const r = rig('mode3', { [CRTC_R8_INTERLACE_AND_SKEW]: 0x00 });
    let adjust = 0;
    let lines = 0;
    do {
      if (r.crtc.inAdjust) adjust++;
      toNextLine(r);
      lines++;
    } while (r.crtc.fieldLine !== 0);
    expect([lines, adjust]).toEqual([312, 2]);
  });

  it('interlaced fields alternate 312 and 313 scanlines: the odd field has one more adjust line', () => {
    for (const name of ['modes012', 'mode3', 'modes45', 'mode6', 'mode7'] as const) {
      const r = rig(name);
      expect(r.crtc.oddField).toBe(false);
      const lengths = [wholeField(r), wholeField(r), wholeField(r), wholeField(r)];
      expect(lengths).toEqual([312, 313, 312, 313]);
    }
  });

  it('vertical display enable is on for rows 0 to R6 - 1: MODE 0 lines 0-255, MODE 7 lines 0-249', () => {
    for (const [name, lines] of [['modes012', 256], ['mode7', 250]] as const) {
      const r = rig(name);
      const on: number[] = [];
      for (let line = 0; line < 312; line++) {
        // Character 0 of each line: horizontally on, so only the vertical side decides.
        if (r.crtc.displayEnable) on.push(r.crtc.fieldLine);
        toNextLine(r);
      }
      expect(on).toEqual(Array.from({ length: lines }, (_, i) => i));
    }
  });

  it('the row counter is 7 bits and compares with "equals": an R4 below the row makes it count on to 127, wrap and come round', () => {
    const r = rig('modes012', { [CRTC_R8_INTERLACE_AND_SKEW]: 0x00 });
    for (let i = 0; i < 20 * 8; i++) toNextLine(r);
    expect(r.crtc.row).toBe(20);
    set(r.crtc, 4, 10);
    // From here: rows 20-127, then 0-10, all in the same field. 108 + 11 = 119 rows of 8 lines.
    expect(wholeField(r)).toBe(119 * 8);
  });
});

describe('6845 interlace sync and video (MODE 7, R8 = &93)', () => {
  it('the scanline output is 0, 2 … 18 in the even field and 1, 3 … 19 in the odd one: 10 lines a row, per field', () => {
    const r = rig('mode7');
    const even: number[] = [];
    for (let i = 0; i < 11; i++) {
      even.push(r.crtc.scanline);
      toNextLine(r);
    }
    expect(even).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 0]);
    expect(r.crtc.row).toBe(1);
    wholeField(r);
    expect(r.crtc.oddField).toBe(true);
    const odd: number[] = [];
    for (let i = 0; i < 11; i++) {
      odd.push(r.crtc.scanline);
      toNextLine(r);
    }
    expect(odd).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 1]);
  });

  it('R9\'s bit 0 is ignored in this mode: &13 gives the same 10-line rows as &12', () => {
    const r = rig('mode7', { [CRTC_R9_MAX_SCAN_LINE]: 0x13 });
    expect([wholeField(r), wholeField(r)]).toEqual([312, 313]);
  });

  it('in interlace sync only (R8 = &01), both fields show the same scanlines 0 to R9', () => {
    const r = rig('mode6');
    wholeField(r);
    expect(r.crtc.oddField).toBe(true);
    const odd: number[] = [];
    for (let i = 0; i < 11; i++) {
      odd.push(r.crtc.scanline);
      toNextLine(r);
    }
    expect(odd).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  });
});

describe('6845 VSYNC', () => {
  /** Where VSYNC rose and fell: [field line, character] for each edge in the first two fields. */
  function edgesOverTwoFields(r: Rig): [string, number, number][] {
    const out: [string, number, number][] = [];
    let was = r.crtc.vsync;
    for (let field = 0; field < 2; field++) {
      do {
        char(r);
        if (r.crtc.vsync !== was) {
          was = r.crtc.vsync;
          out.push([was ? 'up' : 'down', r.crtc.fieldLine, r.crtc.character]);
        }
      } while (r.crtc.fieldLine !== 0 || r.crtc.character !== 0);
    }
    return out;
  }

  it('MODE 0 interlaced: high for 2 lines from line 280 in the even field, from half way along line 280 in the odd one', () => {
    expect(edgesOverTwoFields(rig('modes012'))).toEqual([
      ['up', 280, 0],
      ['down', 282, 0],
      ['up', 280, 64],
      ['down', 282, 64],
    ]);
  });

  it('MODE 7: the same lines; half a line is 32 characters at 1 MHz', () => {
    expect(edgesOverTwoFields(rig('mode7'))).toEqual([
      ['up', 280, 0],
      ['down', 282, 0],
      ['up', 280, 32],
      ['down', 282, 32],
    ]);
  });

  it('non-interlaced, VSYNC is at the start of line 280 in every field', () => {
    expect(edgesOverTwoFields(rig('modes012', { [CRTC_R8_INTERLACE_AND_SKEW]: 0x00 }))).toEqual([
      ['up', 280, 0],
      ['down', 282, 0],
      ['up', 280, 0],
      ['down', 282, 0],
    ]);
  });

  it('a VSYNC width of 0 means 16 lines', () => {
    expect(edgesOverTwoFields(rig('modes012', { [CRTC_R3_SYNC_WIDTHS]: 0x08, [CRTC_R8_INTERLACE_AND_SKEW]: 0x00 })).slice(0, 2)).toEqual([
      ['up', 280, 0],
      ['down', 296, 0],
    ]);
  });

  it('the rising edges are 40,000 CPU cycles (20 ms, 50.00 Hz) apart in every interlaced MODE', () => {
    for (const name of ['modes012', 'mode3', 'modes45', 'mode6', 'mode7'] as const) {
      const r = rig(name);
      for (let i = 0; i < 4; i++) wholeField(r);
      const rises = r.edges.filter((e) => e.level === 1).map((e) => e.cycle);
      expect(rises.slice(1).map((c, i) => c - (rises[i] ?? 0))).toEqual([40_000, 40_000, 40_000]);
      expect(r.crtc.vsyncPeriodCycles).toBe(40_000);
    }
  });

  it('non-interlaced (*TV 0,1) they are 39,936 cycles apart: 312 × 64 µs, 50.08 Hz', () => {
    const r = rig('modes012', { [CRTC_R8_INTERLACE_AND_SKEW]: 0x00 });
    for (let i = 0; i < 3; i++) wholeField(r);
    expect(r.crtc.vsyncPeriodCycles).toBe(39_936);
  });

  it('counts its rising edges; the period is 0 until there have been two', () => {
    const r = rig('mode7');
    expect([r.crtc.vsyncCount, r.crtc.vsyncPeriodCycles]).toEqual([0, 0]);
    wholeField(r);
    expect([r.crtc.vsyncCount, r.crtc.vsyncPeriodCycles]).toEqual([1, 0]);
    wholeField(r);
    expect([r.crtc.vsyncCount, r.crtc.vsyncPeriodCycles]).toEqual([2, 40_000]);
  });

  it('tells its listener only about changes, and drives the level it has now as soon as it is connected', () => {
    const crtc = new Crtc6845();
    const levels: number[] = [];
    crtc.connectVsync((level) => levels.push(level));
    expect(levels).toEqual([0]);
  });
});

describe('6845 clock', () => {
  it('at 1 MHz a character takes two CPU cycles, and an odd cycle is carried into the next tick', () => {
    const r = rig('mode7');
    r.crtc.tick(7);
    expect(r.crtc.character).toBe(3);
    r.crtc.tick(5);
    expect(r.crtc.character).toBe(6);
  });

  it('at 2 MHz a character is one CPU cycle', () => {
    const r = rig('modes012');
    r.crtc.tick(7);
    expect(r.crtc.character).toBe(7);
  });

  it('asks the clock at every tick, so a MODE change that switches the ULA\'s bit 4 takes effect at once', () => {
    const crtc = new Crtc6845();
    TABLE.modes012.forEach((v, n) => {
      set(crtc, n, v);
    });
    let fast = false;
    crtc.connectClock(() => fast);
    crtc.tick(10);
    expect(crtc.character).toBe(5);
    fast = true;
    crtc.tick(10);
    expect(crtc.character).toBe(15);
  });

  it('one big tick does the same as many small ones', () => {
    const a = rig('mode7');
    const b = rig('mode7');
    a.crtc.tick(123_457);
    for (let i = 0; i < 123_457; i++) b.crtc.tick(1);
    expect([a.crtc.fieldLine, a.crtc.character, a.crtc.vsyncCount]).toEqual([b.crtc.fieldLine, b.crtc.character, b.crtc.vsyncCount]);
  });
});

describe('6845 /RESET', () => {
  it('puts the counters back to line 0, character 0, even field, and keeps the registers', () => {
    const r = rig('mode7');
    wholeField(r);
    for (let i = 0; i < 1000; i++) char(r);
    r.crtc.reset();
    expect([r.crtc.fieldLine, r.crtc.character, r.crtc.row, r.crtc.scanline, r.crtc.oddField, r.crtc.vsync]).toEqual([0, 0, 0, 0, false, false]);
    expect(r.crtc.register(0)).toBe(0x3f);
  });

  it('an unprogrammed chip (all &00) still counts: 1-character lines, 1-line fields, VSYNC held high', () => {
    const crtc = new Crtc6845();
    const levels: number[] = [];
    crtc.connectVsync((level) => levels.push(level));
    crtc.tick(10_000);
    expect(crtc.vsync).toBe(true);
    expect(levels).toEqual([0, 1]);
  });
});
