import { SCREEN_10K, SCREEN_20K } from '../../video/screen-address';
import { CRTC_REGISTER_COUNT } from '../../devices/crtc6845';
import { buildCrtcView, vsyncRateText, type CrtcCounters, type CrtcViewInput } from './crtc-view-model';

/** What MOS 1.20 leaves in the chip after MODE 0 (R7 is the table's &22 + 1) and MODE 7, R0-R15. */
const MODE0 = [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08, 0x06, 0x00, 0x06, 0x00];
const MODE7 = [0x3f, 0x28, 0x33, 0x24, 0x1e, 0x02, 0x19, 0x1c, 0x93, 0x12, 0x72, 0x13, 0x28, 0x00, 0x28, 0xc9];

function input(registers: readonly number[], ulaControl: number, previous?: readonly number[]): CrtcViewInput {
  const all = new Array<number>(CRTC_REGISTER_COUNT).fill(0);
  registers.forEach((v, i) => (all[i] = v));
  return { registers: all, addressRegister: 14, ulaControl, previous, screenSize: SCREEN_20K };
}

describe('buildCrtcView', () => {
  it('MODE 7: the summary is 40×25 characters, 50.00 Hz, interlaced (sync and video)', () => {
    expect(buildCrtcView(input(MODE7, 0x4b)).summary).toBe('40×25 characters, 50.00 Hz, interlaced (sync and video)');
  });

  it('lists all eighteen registers with name, hex value and who can read or write them', () => {
    const rows = buildCrtcView(input(MODE7, 0x4b)).rows;
    expect(rows).toHaveLength(18);
    expect(rows.slice(0, 2).map((r) => [r.label, r.name, r.hex, r.access])).toEqual([
      ['R0', 'horizontal total', '3F', 'W'],
      ['R1', 'horizontal displayed', '28', 'W'],
    ]);
    expect(rows.slice(14).map((r) => r.access)).toEqual(['R/W', 'R/W', 'R', 'R']);
  });

  it('says what each value means in its own units (MODE 0, 2 MHz clock)', () => {
    const meaning = buildCrtcView(input(MODE0, 0x9c)).rows.map((r) => r.meaning);
    expect(meaning.slice(0, 12)).toEqual([
      '128 characters a line: 64 µs',
      '80 shown',
      'HSYNC at character 98: 49 µs in',
      'HSYNC 8 characters (4 µs), VSYNC 2 lines',
      '39 rows a field',
      '+0 lines',
      '32 rows shown',
      'VSYNC at row 35: line 280',
      'interlace sync; no skew',
      '8 lines a row',
      'cursor from line 7, blinks every 32 fields',
      'cursor to line 8',
    ]);
    expect(meaning.slice(12)).toEqual(['start address MA &0600', '', 'cursor at MA &0600', '', 'light pen: not connected', '']);
  });

  it('MODE 7\'s R8 and R9 read as interlace sync and video with skew, and 10 lines a row per field', () => {
    const rows = buildCrtcView(input(MODE7, 0x4b)).rows;
    expect(rows[8]?.meaning).toBe('interlace sync and video; display skew 1, cursor skew 2');
    expect(rows[9]?.meaning).toBe('10 lines a row in each field (20 across both)');
  });

  it('marks the register &FE01 reaches now', () => {
    const rows = buildCrtcView(input(MODE7, 0x4b)).rows;
    expect(rows.filter((r) => r.selected).map((r) => r.label)).toEqual(['R14']);
  });

  it('marks registers whose value changed since the last view', () => {
    const rows = buildCrtcView(input(MODE0, 0x9c, input(MODE7, 0x4b).registers)).rows;
    expect(rows.filter((r) => r.changed).map((r) => r.label)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R14', 'R15']);
  });

  it('works the geometry through step by step, with the real numbers', () => {
    expect(buildCrtcView(input(MODE0, 0x9c)).geometry).toEqual([
      { label: 'Character clock', value: '2 MHz (ULA &FE20 bit 4 = 1)' },
      { label: 'Scanline', value: '128 characters ÷ 2 MHz = 64 µs (15,625 Hz)' },
      { label: 'Field', value: '39 rows × 8 lines + 0 = 312 lines, + ½ for interlace = 312.5' },
      { label: 'Field time', value: '312.5 × 64 µs = 20.000 ms: 50.00 Hz fields, 25.00 Hz frames' },
      { label: 'Displayed', value: '80 × 32 characters: 256 of the 312.5 lines' },
      { label: 'Interlace', value: 'sync only: both fields show the same lines' },
    ]);
  });

  it('non-interlaced: no half line, and a frame is a field', () => {
    const regs = [...MODE0];
    regs[8] = 0x00;
    const geometry = buildCrtcView(input(regs, 0x9c)).geometry;
    expect(geometry[2]?.value).toBe('39 rows × 8 lines + 0 = 312 lines');
    expect(geometry[3]?.value).toBe('312 × 64 µs = 19.968 ms: 50.08 Hz, one field a frame');
    expect(geometry[5]?.value).toBe('off: every field is the same');
  });

  it('the frame drawing, in percent of one field: the displayed box, the HSYNC band and the VSYNC band', () => {
    expect(buildCrtcView(input(MODE0, 0x9c)).frame).toEqual({
      displayed: { left: 0, top: 0, width: 62.5, height: 81.92 },
      hsync: { left: 76.5625, top: 0, width: 6.25, height: 100 },
      vsync: { left: 0, top: 89.6, width: 100, height: 0.64 },
    });
  });

  it('an unprogrammed chip (all &00) draws inside the box without NaN', () => {
    const frame = buildCrtcView(input([], 0x00)).frame;
    for (const box of [frame.displayed, frame.hsync, frame.vsync]) {
      for (const v of [box.left, box.top, box.width, box.height]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  describe('the counters (Stage 38)', () => {
    const atVsync: CrtcCounters = {
      character: 32, scanline: 1, row: 28, fieldLine: 280, inAdjust: false, oddField: true,
      hsync: false, vsync: true, displayEnable: false, vsyncCount: 1234, vsyncPeriodCycles: 40_000,
      memoryAddress: 0x2c80, displayStart: 0x2800, fieldsSinceReset: 1234,
    };

    it('says where the beam is, what the three outputs are, and the field rate measured from VSYNC', () => {
      expect(buildCrtcView({ ...input(MODE7, 0x4b), counters: atVsync }).counters).toEqual([
        { label: 'Beam', value: 'line 280 of the field, character 32' },
        { label: 'Counters', value: 'row 28, scanline 1' },
        { label: 'Outputs', value: 'DISPEN low, HSYNC low, VSYNC high' },
        { label: 'Fields', value: 'odd field; 1,234 VSYNCs since power-on' },
        { label: 'Measured', value: 'VSYNC every 40,000 cycles = 20.000 ms: 50.00 Hz' },
        { label: 'Address', value: 'MA &2C80, RA 1 → &7C80 (teletext: MA13 = 1)' },
        { label: 'Start', value: '&2800 → &7C00, latched at this field\'s start' },
        { label: 'Cursor', value: 'MA &28C9 (row 5, column 1), lines 18-19, blinks every 32 fields: off now' },
      ]);
    });

    it('non-interlaced there is no odd or even, and 39,936 cycles is 50.08 Hz', () => {
      const regs = [...MODE0];
      regs[8] = 0x00;
      const lines = buildCrtcView({ ...input(regs, 0x9c), counters: { ...atVsync, vsyncPeriodCycles: 39_936 } }).counters;
      expect(lines[3]?.value).toBe('1,234 VSYNCs since power-on');
      expect(lines[4]?.value).toBe('VSYNC every 39,936 cycles = 19.968 ms: 50.08 Hz');
    });

    it('in the vertical adjust there is no row: it says so', () => {
      const lines = buildCrtcView({ ...input(MODE7, 0x4b), counters: { ...atVsync, inAdjust: true, row: 30, fieldLine: 311 } }).counters;
      expect(lines[1]?.value).toBe('vertical adjust, after row 30');
    });

    it('before two VSYNCs there is nothing to measure', () => {
      expect(buildCrtcView({ ...input(MODE7, 0x4b), counters: { ...atVsync, vsyncPeriodCycles: 0 } }).counters[4]?.value).toBe('waiting for two VSYNCs');
      expect(vsyncRateText(0)).toBeUndefined();
    });

    describe('addressing and the cursor (Stage 39)', () => {
      /** MODE 7 with R12/R13 and R14/R15 as given. */
      function withStart(r12: number, r13: number, r14 = 0x28, r15 = 0xc9): number[] {
        const regs = [...MODE7];
        regs[12] = r12;
        regs[13] = r13;
        regs[14] = r14;
        regs[15] = r15;
        return regs;
      }

      it('a bitmap MODE\'s MA and RA make MA × 8 + RA', () => {
        const regs = [...MODE0];
        regs[12] = 0x06;
        const lines = buildCrtcView({ ...input(regs, 0x9c), counters: { ...atVsync, memoryAddress: 0x0601, scanline: 3, displayStart: 0x0600 } }).counters;
        expect(lines[5]?.value).toBe('MA &0601, RA 3 → &300B (bitmap: MA13 = 0)');
        expect(lines[6]?.value).toBe('&0600 → &3000, latched at this field\'s start');
      });

      it('MA12 = 1 shows the board\'s wrap by IC32\'s screen size: MA &1000 in a 10K screen is &5800', () => {
        const regs = [...MODE0];
        regs[12] = 0x0b;
        regs[13] = 0x28;
        const lines = buildCrtcView({
          ...input(regs, 0x88),
          screenSize: SCREEN_10K,
          counters: { ...atVsync, memoryAddress: 0x1000, scanline: 2, displayStart: 0x0b28 },
        }).counters;
        expect(lines[5]?.value).toBe('MA &1000, RA 2 → &5802 (bitmap, MA12 = 1: wrapped, − &2800 (10K screen))');
      });

      it('R12/R13 written since the field began are shown as waiting for the next field', () => {
        const lines = buildCrtcView({ ...input(withStart(0x28, 0x28), 0x4b), counters: atVsync }).counters;
        expect(lines[6]?.value).toBe('&2800 → &7C00, latched at this field\'s start; R12/R13 = &2828 from the next');
      });

      it('in the blink\'s on phase the cursor says "on now"', () => {
        const lines = buildCrtcView({ ...input(MODE7, 0x4b), counters: { ...atVsync, fieldsSinceReset: 32 } }).counters;
        expect(lines[7]?.value).toMatch(/: on now$/);
      });

      it('R10 = &20 is "no cursor", and R8 cursor skew %11 is too', () => {
        const noCursor = [...MODE7];
        noCursor[10] = 0x20;
        expect(buildCrtcView({ ...input(noCursor, 0x4b), counters: atVsync }).counters[7]?.value).toBe('MA &28C9: none (R10 blink %01)');
        const skewOff = [...MODE7];
        skewOff[8] = 0xd3;
        expect(buildCrtcView({ ...input(skewOff, 0x4b), counters: atVsync }).counters[7]?.value).toBe('MA &28C9: none (R8 cursor skew %11)');
      });

      it('a cursor MA outside the displayed area is said to be off the screen', () => {
        const lines = buildCrtcView({ ...input(withStart(0x28, 0x00, 0x27, 0xff), 0x4b), counters: atVsync }).counters;
        expect(lines[7]?.value).toBe('MA &27FF (not on the screen), lines 18-19, blinks every 32 fields: off now');
      });
    });

    it('puts the beam in the frame drawing: line 280 of 312.5, character 32 of 64', () => {
      expect(buildCrtcView({ ...input(MODE7, 0x4b), counters: atVsync }).beam).toEqual({ left: 50, top: 89.6, width: 0, height: 0 });
    });

    it('without counters (Stage 37\'s panel) there are no counter lines and no beam', () => {
      const view = buildCrtcView(input(MODE7, 0x4b));
      expect([view.counters, view.beam]).toEqual([[], undefined]);
    });
  });
});
