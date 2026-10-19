// Stage 39 with the real ROMs: what MOS 1.20 does with the 6845's start
// address and cursor, seen through the counters and mode7ScreenFrom.

import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7ScreenFrom } from '../video/mode7-renderer';
import { mode7Text } from '../video/mode7-text';
import { teletextAddress } from '../video/screen-address';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

const BOTH_ROMS = ['roms/os12.rom', 'roms/basic2.rom'] as const;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function booted(): BbcModelB {
  const m = new BbcModelB();
  loadStandardRoms(m.map, ['mos', 'basic']);
  m.powerOn();
  run(m, 50);
  return m;
}

/** The cursor's cell as (row, column) from the top left of what's displayed: (cursor MA - start) ÷ R1. */
function cursorCell(m: BbcModelB): [number, number] {
  const offset = (m.crtc.cursorAddress - m.crtc.displayStart) & 0x3fff;
  const r1 = m.crtc.register(1);
  return [Math.floor(offset / r1), offset % r1];
}

/** The screen as text, from the start the CRTC latched (what the renderer draws). */
function screen(m: BbcModelB): string[] {
  return mode7Text((a) => m.peek(a), teletextAddress(m.crtc.displayStart));
}

/** Of the next n fields, how many draw the cursor. */
function fieldsWithCursor(m: BbcModelB, n: number): number {
  let shown = 0;
  for (let i = 0; i < n; i++) {
    const field = m.crtc.fieldsSinceReset;
    while (m.crtc.fieldsSinceReset === field) m.step();
    if (mode7ScreenFrom(m.crtc).cursor >= 0) shown++;
  }
  return shown;
}

describe('MOS 1.20, the start address and the cursor', () => {
  withRoms(...BOTH_ROMS)('at the > prompt the cursor is at MA &28C9: row 5, column 1, just after the >', () => {
    const m = booted();
    expect(m.crtc.displayStart).toBe(0x2800);
    expect(m.crtc.cursorAddress).toBe(0x28c9);
    expect(cursorCell(m)).toEqual([5, 1]);
    expect(screen(m)[5]?.startsWith('>')).toBe(true);
  });

  withRoms(...BOTH_ROMS)('the cursor blinks by itself: 32 of every 64 fields, with no CPU writes to the CRTC', () => {
    const m = booted();
    let crtcWrites = 0;
    const write = m.crtc.write.bind(m.crtc);
    m.crtc.write = (offset: number, value: number): void => {
      crtcWrites++;
      write(offset, value);
    };
    expect(fieldsWithCursor(m, 64)).toBe(32);
    expect(crtcWrites).toBe(0);
  });

  withRoms(...BOTH_ROMS)('VDU 23,1,0 turns the cursor off (R10 = &20) and VDU 23,1,1 turns it back on (&72)', () => {
    const m = booted();
    typeText(m, 'VDU 23,1,0;0;0;0;\r');
    run(m, 5);
    expect(m.crtc.register(10)).toBe(0x20);
    expect(fieldsWithCursor(m, 64)).toBe(0);
    typeText(m, 'VDU 23,1,1;0;0;0;\r');
    run(m, 5);
    expect(m.crtc.register(10)).toBe(0x72);
    expect(fieldsWithCursor(m, 64)).toBe(32);
  });

  withRoms(...BOTH_ROMS)('printing past the bottom scrolls by moving the start a row (&28) a line; the cursor stays on the bottom row', () => {
    const m = booted();
    typeText(m, 'FOR I=1 TO 40:PRINT "LINE ";I:NEXT\r');
    run(m, 50);
    const moved = (m.crtc.displayStart - 0x2800) & 0x3ff;
    expect(moved).toBeGreaterThan(0);
    expect(moved % 0x28).toBe(0);
    const rows = screen(m);
    expect(rows[23]?.trimEnd()).toBe('LINE 40');
    expect(rows[24]?.trimEnd()).toBe('>');
    expect(cursorCell(m)).toEqual([24, 1]);
  });

  withRoms(...BOTH_ROMS)('while scrolling, the start the screen is drawn from only ever changes at the top of a field', () => {
    const m = booted();
    typeText(m, 'FOR I=1 TO 40:PRINT I:NEXT\r', { holdFrames: 2, gapFrames: 2 });
    let changes = 0;
    let midField = 0;
    let r13Writes = 0;
    let last = m.crtc.displayStart;
    let lastR13 = m.crtc.register(13);
    for (let cycles = 0; cycles < 40_000 * 100; ) {
      cycles += m.step();
      if (m.crtc.register(13) !== lastR13) {
        lastR13 = m.crtc.register(13);
        r13Writes++;
      }
      if (m.crtc.displayStart !== last) {
        last = m.crtc.displayStart;
        changes++;
        if (m.crtc.fieldLine !== 0) midField++;
      }
    }
    expect(r13Writes).toBeGreaterThan(10);
    expect(changes).toBeGreaterThan(10);
    expect(midField).toBe(0);
  });
});
