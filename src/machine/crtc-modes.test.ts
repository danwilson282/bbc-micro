// Stage 37 with the real ROMs: what MOS 1.20 writes to the 6845 (and the
// one ULA bit that clocks it) for each MODE, typed into BASIC, and the
// geometry that falls out. The tables are the MOS's own, at &C46E, except
// R7: the MOS's CRTC writer (&C95E) adds the *TV offset (&0290) and the
// carry left by CPY #&07, so R7 = table + offset + 1.

import { characterClockHz, crtcGeometry, describeCrtcGeometry } from '../devices/crtc-geometry';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { hex8 } from '../util/bits';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

const BOTH_ROMS = ['roms/os12.rom', 'roms/basic2.rom'] as const;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function booted(): BbcModelB {
  const m = new BbcModelB();
  loadStandardRoms(m.map);
  m.powerOn();
  run(m, 50);
  return m;
}

/** R0-R11 as the doc's table prints them. */
function table(m: BbcModelB): string {
  return m.crtc.registers().slice(0, 12).map(hex8).join(' ');
}

describe('MOS 1.20 programs the 6845 for each MODE', () => {
  withRoms(...BOTH_ROMS)('typing MODE 0-7 into BASIC writes R0-R11 from the MOS\'s five tables (R7 one more), and the geometry follows', () => {
    const m = booted();
    // Power-on leaves MODE 7: check it before changing anything.
    const seen: string[] = [`7: ${table(m)} | ${describeCrtcGeometry(crtcGeometry(m.crtc.registers(), characterClockHz(m.videoUla.control)))}`];
    for (const mode of [0, 1, 2, 3, 4, 5, 6, 7]) {
      typeText(m, `MODE ${String(mode)}\r`);
      run(m, 5);
      const g = crtcGeometry(m.crtc.registers(), characterClockHz(m.videoUla.control));
      seen.push(`${String(mode)}: ${table(m)} | ${describeCrtcGeometry(g)}`);
    }
    expect(seen).toEqual([
      '7: 3F 28 33 24 1E 02 19 1C 93 12 72 13 | 40×25 characters, 50.00 Hz, interlaced (sync and video)',
      '0: 7F 50 62 28 26 00 20 23 01 07 67 08 | 80×32 characters, 50.00 Hz, interlaced',
      '1: 7F 50 62 28 26 00 20 23 01 07 67 08 | 80×32 characters, 50.00 Hz, interlaced',
      '2: 7F 50 62 28 26 00 20 23 01 07 67 08 | 80×32 characters, 50.00 Hz, interlaced',
      '3: 7F 50 62 28 1E 02 19 1C 01 09 67 09 | 80×25 characters, 50.00 Hz, interlaced',
      '4: 3F 28 31 24 26 00 20 23 01 07 67 08 | 40×32 characters, 50.00 Hz, interlaced',
      '5: 3F 28 31 24 26 00 20 23 01 07 67 08 | 40×32 characters, 50.00 Hz, interlaced',
      '6: 3F 28 31 24 1E 02 19 1C 01 09 67 09 | 40×25 characters, 50.00 Hz, interlaced',
      '7: 3F 28 33 24 1E 02 19 1C 93 12 72 13 | 40×25 characters, 50.00 Hz, interlaced (sync and video)',
    ]);
  });

  withRoms(...BOTH_ROMS)('every MODE\'s scanline is 64 µs: the ULA\'s clock bit and R0 change together', () => {
    const m = booted();
    const lines: number[] = [];
    for (const mode of [0, 3, 4, 6, 7]) {
      typeText(m, `MODE ${String(mode)}\r`);
      run(m, 5);
      lines.push(crtcGeometry(m.crtc.registers(), characterClockHz(m.videoUla.control)).lineMicroseconds);
    }
    expect(lines).toEqual([64, 64, 64, 64, 64]);
  });

  withRoms(...BOTH_ROMS)('R7 is the table plus the *TV offset plus 1: *TV 255 gives the table\'s &22, *TV 2 gives &25', () => {
    const m = booted();
    const r7 = (tv: number): number => {
      typeText(m, `*TV ${String(tv)}\r`);
      typeText(m, 'MODE 0\r');
      run(m, 5);
      return m.crtc.register(7);
    };
    expect([r7(0), r7(255), r7(2)]).toEqual([0x23, 0x22, 0x25]);
  });

  withRoms(...BOTH_ROMS)('*TV 0,1 then MODE 0 turns interlace off: R8 = &00, 312 lines, 50.08 Hz', () => {
    const m = booted();
    typeText(m, '*TV 0,1\r');
    typeText(m, 'MODE 0\r');
    run(m, 5);
    const g = crtcGeometry(m.crtc.registers(), characterClockHz(m.videoUla.control));
    expect([m.crtc.register(8), g.linesPerField, describeCrtcGeometry(g)]).toEqual([0x00, 312, '80×32 characters, 50.08 Hz, non-interlaced']);
  });

  withRoms(...BOTH_ROMS)('the cursor address is readable at &FE01 (R14/R15) but the start address (R12/R13) reads &00', () => {
    const m = booted();
    const read = (n: number): number => {
      m.map.write(0xfe00, n);
      return m.map.read(0xfe01);
    };
    expect([read(12), read(13)]).toEqual([0x00, 0x00]);
    expect([read(14), read(15)]).toEqual([m.crtc.register(14), m.crtc.register(15)]);
    expect(m.crtc.register(14)).not.toBe(0);
  });
});
