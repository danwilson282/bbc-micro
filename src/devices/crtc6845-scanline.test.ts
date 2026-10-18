import { CRTC_ADDRESS, CRTC_DATA, CRTC_R12_START_ADDRESS_HIGH, CRTC_R13_START_ADDRESS_LOW, Crtc6845 } from './crtc6845';

// Stage 42: the 6845 tells a listener when each scanline starts, so a
// renderer can draw the line from the MA and RA the chip has then.

/** MOS 1.20's MODE 0 table, R0-R11 (R7 as the MOS writes it). 39 rows of 8 lines, no adjust: 312 lines. */
const MODE0 = [0x7f, 0x50, 0x62, 0x28, 0x26, 0x00, 0x20, 0x23, 0x01, 0x07, 0x67, 0x08] as const;

function set(crtc: Crtc6845, n: number, value: number): void {
  crtc.write(CRTC_ADDRESS, n);
  crtc.write(CRTC_DATA, value);
}

interface LineSeen {
  readonly line: number;
  readonly start: number;
  readonly ra: number;
  readonly displayed: boolean;
}

/** A MODE 0 CRTC starting at MA &0600 (&3000), reset, with a listener recording every line start. */
function watched(): { crtc: Crtc6845; seen: LineSeen[] } {
  const crtc = new Crtc6845();
  MODE0.forEach((v, r) => {
    set(crtc, r, v);
  });
  set(crtc, CRTC_R12_START_ADDRESS_HIGH, 0x06);
  set(crtc, CRTC_R13_START_ADDRESS_LOW, 0x00);
  const seen: LineSeen[] = [];
  crtc.connectScanline((line) => {
    seen.push({ line, start: crtc.lineStartAddress, ra: crtc.scanline, displayed: crtc.rowDisplayed });
  });
  crtc.reset();
  return { crtc, seen };
}

/** Character clocks (2 MHz, so one per tick) until the next field begins. */
function toNextField(crtc: Crtc6845): void {
  const fields = crtc.fieldsSinceReset;
  while (crtc.fieldsSinceReset === fields) crtc.tick(1);
}

describe('6845 scanline listener', () => {
  test('/RESET starts line 0, and each line of a MODE 0 field starts once: 0-311, then 0-312 in the odd field', () => {
    const { crtc, seen } = watched();
    toNextField(crtc);
    toNextField(crtc);
    // Split the line numbers into fields at each 0. The third field has only just begun.
    const fields: number[][] = [];
    for (const { line } of seen) {
      if (line === 0) fields.push([]);
      fields.at(-1)?.push(line);
    }
    expect(fields.map((f) => f.length)).toEqual([312, 313, 1]);
    expect(fields[0]).toEqual(Array.from({ length: 312 }, (_, i) => i));
    // Interlace sync (R8 = &01): the odd field has one extra adjust line.
    expect(fields[1]).toEqual(Array.from({ length: 313 }, (_, i) => i));
  });

  test('at each line start, lineStartAddress is the row\'s first MA and scanline is its RA: row n starts R1 × n characters on', () => {
    const { crtc, seen } = watched();
    toNextField(crtc);
    const at = (line: number): string => {
      const s = seen.find((x) => x.line === line);
      return s === undefined ? 'missing' : `${s.start.toString(16)}/${String(s.ra)}`;
    };
    // &0600 + 80 × row: row 1 at &0650, row 31 at &0600 + &9B0 = &0FB0.
    expect([at(0), at(7), at(8), at(15), at(16), at(255)]).toEqual(['600/0', '600/7', '650/0', '650/7', '6a0/0', 'fb0/7']);
  });

  test('rowDisplayed is true for the R6 = 32 displayed rows (lines 0-255) and false for the rest of the field', () => {
    const { crtc, seen } = watched();
    toNextField(crtc);
    const field = seen.slice(0, -1);
    expect(field.filter((s) => s.displayed).map((s) => s.line)).toEqual(Array.from({ length: 256 }, (_, i) => i));
    // The next field's line 0 is displayed again.
    expect(seen.at(-1)?.displayed).toBe(true);
  });

  test('connectScanline(undefined) disconnects the listener', () => {
    const { crtc, seen } = watched();
    crtc.connectScanline(undefined);
    seen.length = 0;
    toNextField(crtc);
    expect(seen).toEqual([]);
  });
});
