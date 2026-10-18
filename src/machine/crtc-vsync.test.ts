// Stage 38 with the real ROMs: the 6845 counts, and its VSYNC is the MOS's
// 50 Hz interrupt. The rate is measured from the counters (the cycles
// between two VSYNC rising edges), then compared with Stage 37's geometry.

import { characterClockHz, crtcGeometry } from '../devices/crtc-geometry';
import { IFR_CA1 } from '../devices/via6522';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7Text } from '../video/mode7-text';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

const BOTH_ROMS = ['roms/os12.rom', 'roms/basic2.rom'] as const;
const SYSTEM_VIA_IFR = 0xfe4d;

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

/** The field rate the counters produce, and the one Stage 37's formula predicts. */
function rates(m: BbcModelB): [string, string] {
  const measured = 2_000_000 / m.crtc.vsyncPeriodCycles;
  const predicted = crtcGeometry(m.crtc.registers(), characterClockHz(m.videoUla.control)).fieldRateHz;
  return [measured.toFixed(2), predicted.toFixed(2)];
}

describe('the CRTC\'s VSYNC drives the MOS', () => {
  withRoms(...BOTH_ROMS)('after boot (MODE 7) the VSYNCs are 40,000 cycles apart: 50.00 Hz, as the geometry predicts', () => {
    const m = booted();
    expect(m.crtc.vsyncPeriodCycles).toBe(40_000);
    expect(rates(m)).toEqual(['50.00', '50.00']);
  });

  withRoms(...BOTH_ROMS)('every MODE measures 50.00 Hz; after *TV 0,1 the next MODE change measures 50.08 Hz (312 lines, 39,936 cycles)', () => {
    const m = booted();
    const seen: string[] = [];
    for (const mode of [0, 3, 4, 6, 7]) {
      typeText(m, `MODE ${String(mode)}\r`);
      run(m, 5);
      seen.push(`${String(mode)}: ${String(m.crtc.vsyncPeriodCycles)} ${rates(m).join(' = ')}`);
    }
    typeText(m, '*TV 0,1\r');
    typeText(m, 'MODE 0\r');
    run(m, 5);
    seen.push(`TV 0,1 then 0: ${String(m.crtc.vsyncPeriodCycles)} ${rates(m).join(' = ')}`);
    expect(seen).toEqual([
      '0: 40000 50.00 = 50.00',
      '3: 40000 50.00 = 50.00',
      '4: 40000 50.00 = 50.00',
      '6: 40000 50.00 = 50.00',
      '7: 40000 50.00 = 50.00',
      'TV 0,1 then 0: 39936 50.08 = 50.08',
    ]);
  });

  withRoms(...BOTH_ROMS)('50 VSYNCs a second, each counted down at &0240 by the MOS', () => {
    const m = booted();
    const count = m.crtc.vsyncCount;
    const before = m.peek(0x0240);
    run(m, 50);
    expect(m.crtc.vsyncCount - count).toBe(50);
    expect((before - m.peek(0x0240)) & 0xff).toBe(50);
  });

  withRoms(...BOTH_ROMS)('CA1 follows VSYNC, and with PCR = &04 (falling edge) the interrupt comes at the END of the 2-line pulse', () => {
    const m = booted();
    expect(m.peek(0xfe4c)).toBe(0x04);
    // Step to VSYNC's rising edge: CA1 goes high, which a falling-edge CA1 ignores.
    // A function, so TypeScript doesn't take the first loop's exit as proof VSYNC stays high.
    const vsync = (): boolean => m.crtc.vsync;
    while (!vsync()) m.step();
    expect(m.systemVia.controlLine('ca1')).toBe(1);
    expect(m.peek(SYSTEM_VIA_IFR) & IFR_CA1).toBe(0);
    const rose = m.cycles;
    // Step to the falling edge, 2 lines (256 cycles) later: now IFR bit 1 is set and /IRQ is low.
    while (vsync()) m.step();
    expect(m.systemVia.controlLine('ca1')).toBe(0);
    expect(m.peek(SYSTEM_VIA_IFR) & IFR_CA1).toBe(IFR_CA1);
    expect(m.irqHolders).toContain('System VIA');
    // 2 × 64 µs = 256 cycles, give or take an instruction: both edges are seen at the end of a step.
    expect(Math.abs(m.cycles - rose - 256)).toBeLessThan(8);
  });

  withRoms(...BOTH_ROMS)('typing still works, and the prompt is still on row 5 after boot', () => {
    const m = booted();
    expect(mode7Text((a) => m.peek(a))[5]?.startsWith('>')).toBe(true);
    typeText(m, 'PRINT 6*7\r');
    run(m, 5);
    expect(mode7Text((a) => m.peek(a)).some((row) => row.trim() === '42')).toBe(true);
  });

  withRoms(...BOTH_ROMS)('cut the VSYNC wire and the CRTC still counts fields, but the MOS hears none of them; joining it again is itself one falling edge', () => {
    const m = booted();
    m.vsyncWired = false;
    const count = m.crtc.vsyncCount;
    const before = m.peek(0x0240);
    run(m, 10);
    expect(m.crtc.vsyncCount - count).toBe(10);
    expect(m.peek(0x0240)).toBe(before);
    // The cut wire floated high; VSYNC is low, so joining it pulls CA1 down: one edge, then 10 real ones.
    m.vsyncWired = true;
    run(m, 10);
    expect((before - m.peek(0x0240)) & 0xff).toBe(11);
  });
});
