import { CRTC_REGISTER_COUNT } from './crtc6845';
import { characterClockHz, crtcGeometry, describeCrtcGeometry, type CrtcGeometry } from './crtc-geometry';

/**
 * MOS 1.20's five CRTC tables, R0-R11, as it writes them to the chip: the
 * tables in os12.rom at &C46E, but with R7 one more (&22 → &23, &1B → &1C),
 * because the MOS adds the *TV offset and a carry (Stage 37 doc).
 */
const TABLE = {
  modes012: [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  mode3: [0x7f, 0x50, 0x62, 0x28, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  modes45: [0x3f, 0x28, 0x31, 0x24, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08],
  mode6: [0x3f, 0x28, 0x31, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x01, 0x09, 0x67, 0x09],
  mode7: [0x3f, 0x28, 0x33, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x93, 0x12, 0x72, 0x13],
} as const;

const MHZ_2 = 2_000_000;
const MHZ_1 = 1_000_000;

/** R0-R17 from a table's R0-R11, with R12-R17 given (default 0). */
function regs(table: readonly number[], rest: readonly number[] = []): number[] {
  const r = new Array<number>(CRTC_REGISTER_COUNT).fill(0);
  table.forEach((v, i) => (r[i] = v));
  rest.forEach((v, i) => (r[12 + i] = v));
  return r;
}

describe('CRTC geometry for each MODE\'s standard register values', () => {
  type Row = [string, readonly number[], number, string, Partial<CrtcGeometry>];
  const rows: Row[] = [
    ['MODE 0-2', TABLE.modes012, MHZ_2, '80×32 characters, 50.00 Hz, interlaced', {
      charactersPerLine: 128, lineMicroseconds: 64, rowsPerField: 39, scanlinesPerRow: 8, adjustLines: 0,
      linesPerField: 312.5, displayedLines: 256, hsyncStart: 98, hsyncWidth: 8, vsyncLine: 280, vsyncLines: 2,
    }],
    ['MODE 3', TABLE.mode3, MHZ_2, '80×25 characters, 50.00 Hz, interlaced', {
      charactersPerLine: 128, rowsPerField: 31, scanlinesPerRow: 10, adjustLines: 2,
      linesPerField: 312.5, displayedLines: 250, vsyncLine: 280,
    }],
    ['MODE 4-5', TABLE.modes45, MHZ_1, '40×32 characters, 50.00 Hz, interlaced', {
      charactersPerLine: 64, lineMicroseconds: 64, hsyncStart: 49, hsyncWidth: 4, linesPerField: 312.5, displayedLines: 256,
    }],
    ['MODE 6', TABLE.mode6, MHZ_1, '40×25 characters, 50.00 Hz, interlaced', {
      charactersPerLine: 64, scanlinesPerRow: 10, linesPerField: 312.5, displayedLines: 250,
    }],
    ['MODE 7', TABLE.mode7, MHZ_1, '40×25 characters, 50.00 Hz, interlaced (sync and video)', {
      charactersPerLine: 64, hsyncStart: 51, rowsPerField: 31, scanlinesPerRow: 10, adjustLines: 2,
      linesPerField: 312.5, displayedLines: 250, vsyncLine: 280, interlace: 'sync-and-video',
    }],
  ];

  it.each(rows)('%s: %s', (_mode, table, clock, summary, expected) => {
    const g = crtcGeometry(regs(table), clock);
    expect(describeCrtcGeometry(g)).toBe(summary);
    expect(g).toMatchObject(expected);
  });

  it('every MODE has a 64 µs scanline (15,625 Hz): the MOS halves R0 whenever the ULA halves the clock', () => {
    const lines = [
      crtcGeometry(regs(TABLE.modes012), MHZ_2),
      crtcGeometry(regs(TABLE.mode3), MHZ_2),
      crtcGeometry(regs(TABLE.modes45), MHZ_1),
      crtcGeometry(regs(TABLE.mode6), MHZ_1),
      crtcGeometry(regs(TABLE.mode7), MHZ_1),
    ].map((g) => [g.lineMicroseconds, g.lineRateHz]);
    expect(lines).toEqual(new Array(5).fill([64, 15_625]));
  });

  it('VSYNC starts on scanline 280 in every MODE: row 35 × 8 lines, or row 28 × 10', () => {
    const lines = [
      crtcGeometry(regs(TABLE.modes012), MHZ_2),
      crtcGeometry(regs(TABLE.mode3), MHZ_2),
      crtcGeometry(regs(TABLE.modes45), MHZ_1),
      crtcGeometry(regs(TABLE.mode6), MHZ_1),
      crtcGeometry(regs(TABLE.mode7), MHZ_1),
    ].map((g) => g.vsyncLine);
    expect(lines).toEqual([280, 280, 280, 280, 280]);
  });

  it('HSYNC starts 49 µs into the line in MODEs 0-6 (character 98 at 2 MHz, 49 at 1 MHz) and 51 µs in MODE 7', () => {
    const at = (table: readonly number[], clock: number): number => {
      const g = crtcGeometry(regs(table), clock);
      return (g.hsyncStart * 1e6) / g.characterClockHz;
    };
    expect([at(TABLE.modes012, MHZ_2), at(TABLE.modes45, MHZ_1), at(TABLE.mode7, MHZ_1)]).toEqual([49, 49, 51]);
  });

  it('interlace adds half a line to the field: 312 + ½ lines × 64 µs = exactly 20 ms, 50 Hz fields, 25 Hz frames', () => {
    const g = crtcGeometry(regs(TABLE.modes012), MHZ_2);
    expect([g.interlace, g.linesPerField, g.fieldMicroseconds, g.fieldRateHz, g.frameRateHz]).toEqual(['sync', 312.5, 20_000, 50, 25]);
  });

  it('*TV 0,1 (R8 = &00, no interlace): 312 lines, 19,968 µs, 50.08 Hz, every field a whole frame', () => {
    const table: number[] = [...TABLE.modes012];
    table[8] = 0x00;
    const g = crtcGeometry(regs(table), MHZ_2);
    expect([g.interlace, g.linesPerField, g.fieldMicroseconds]).toEqual(['off', 312, 19_968]);
    expect(g.fieldRateHz).toBeCloseTo(50.08, 2);
    expect(g.frameRateHz).toBe(g.fieldRateHz);
    expect(describeCrtcGeometry(g)).toBe('80×32 characters, 50.08 Hz, non-interlaced');
  });

  it('R8 bits 0-1 = %10 is non-interlaced too (only bit 0 turns interlace on)', () => {
    const table: number[] = [...TABLE.modes012];
    table[8] = 0x02;
    expect(crtcGeometry(regs(table), MHZ_2).interlace).toBe('off');
  });

  it('MODE 7\'s interlace sync and video: R9 = 18 is 10 scanlines a row in each field (20 across both)', () => {
    const g = crtcGeometry(regs(TABLE.mode7), MHZ_1);
    expect([g.scanlinesPerRow, g.scanlinesPerRowPerFrame]).toEqual([10, 20]);
  });

  it('in the other modes each field draws the same lines: scanlines per frame row = per field row', () => {
    const g = crtcGeometry(regs(TABLE.modes012), MHZ_2);
    expect([g.scanlinesPerRow, g.scanlinesPerRowPerFrame]).toEqual([8, 8]);
  });

  it('MODE 7\'s R8 = &93 also sets display skew 1 character and cursor skew 2; the others have none', () => {
    const seven = crtcGeometry(regs(TABLE.mode7), MHZ_1);
    const zero = crtcGeometry(regs(TABLE.modes012), MHZ_2);
    expect([seven.displaySkew, seven.cursorSkew, zero.displaySkew, zero.cursorSkew]).toEqual([1, 2, 0, 0]);
  });

  it('a VSYNC width of 0 in R3\'s top nibble means 16 lines', () => {
    const table: number[] = [...TABLE.mode7];
    table[3] = 0x04;
    expect(crtcGeometry(regs(table), MHZ_1).vsyncLines).toBe(16);
  });

  it('the cursor: R10 = &72 is lines 18-19 with blink mode %11 (every 32 fields); R10 = &20 is no cursor', () => {
    const g = crtcGeometry(regs(TABLE.mode7, [0x28, 0x00, 0x28, 0xc9]), MHZ_1);
    expect([g.cursorStartLine, g.cursorEndLine, g.cursorBlink]).toEqual([18, 19, 'slow']);
    const blinks = [0x00, 0x20, 0x40, 0x60].map((r10) => crtcGeometry(regs([...TABLE.mode7.slice(0, 10), r10]), MHZ_1).cursorBlink);
    expect(blinks).toEqual(['steady', 'off', 'fast', 'slow']);
  });

  it('R12/R13 and R14/R15 make 14-bit addresses: &28 &00 is MA &2800, &28 &C9 is &28C9', () => {
    const g = crtcGeometry(regs(TABLE.mode7, [0x28, 0x00, 0x28, 0xc9]), MHZ_1);
    expect([g.startAddress, g.cursorAddress]).toEqual([0x2800, 0x28c9]);
  });

  it('a chip nobody has programmed yet (all &00) still gives finite numbers: 1 character, 1 row of 1 line', () => {
    const g = crtcGeometry(new Array<number>(CRTC_REGISTER_COUNT).fill(0), MHZ_1);
    expect([g.charactersPerLine, g.rowsPerField, g.scanlinesPerRow, g.linesPerField]).toEqual([1, 1, 1, 1]);
    expect(Number.isFinite(g.fieldRateHz)).toBe(true);
  });
});

describe('characterClockHz: the Video ULA picks the 6845\'s clock (control register bit 4)', () => {
  it.each([
    ['MODE 0', '&9C', 0x9c, MHZ_2],
    ['MODE 1', '&D8', 0xd8, MHZ_2],
    ['MODE 2', '&F4', 0xf4, MHZ_2],
    ['MODE 3', '&9C', 0x9c, MHZ_2],
    ['MODE 4', '&88', 0x88, MHZ_1],
    ['MODE 5', '&C4', 0xc4, MHZ_1],
    ['MODE 6', '&88', 0x88, MHZ_1],
    ['MODE 7', '&4B', 0x4b, MHZ_1],
  ])('%s: ULA control %s → %i Hz', (_mode, _hex, control, hz) => {
    expect(characterClockHz(control)).toBe(hz);
  });
});
