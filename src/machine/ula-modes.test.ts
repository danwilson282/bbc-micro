// Stage 40 with the real ROMs: what MOS 1.20 writes to the Video ULA for each
// MODE, typed into BASIC. The palette is shown as 16 hex digits, entry 0
// first, each the nibble as stored (the colour EOR 7). All measured.

import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { MOS_DEFAULT_PALETTE, type MosBitmapMode } from '../mos/mos-video-ula';
import { hex8 } from '../util/bits';
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

function stored(m: BbcModelB): string {
  return Array.from({ length: 16 }, (_, e) => m.videoUla.paletteEntry(e).toString(16).toUpperCase()).join('');
}

function colours(m: BbcModelB): number[] {
  return Array.from({ length: 16 }, (_, e) => m.videoUla.physicalColour(e));
}

function mode(m: BbcModelB, n: number): void {
  typeText(m, `MODE ${String(n)}\r`);
  run(m, 5);
}

describe('MOS 1.20 programs the Video ULA for each MODE', () => {
  withRoms('roms/os12.rom')('power-on: MODE 7\'s &4B (teletext, 1 MHz), and the palette is never written', () => {
    const m = booted();
    expect(m.videoUla.control & 0xfe).toBe(0x4a);
    expect(m.videoUla.teletext).toBe(true);
    expect(m.hardwareLog.recent().filter((w) => w.device === 'ulaPalette')).toEqual([]);
  });

  withRoms(...BOTH_ROMS)('MODE 0-7: the control byte from &C3F7, and all 16 palette entries written for each bitmap MODE', () => {
    const m = booted();
    const seen: string[] = [];
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
      m.hardwareLog.clear();
      mode(m, n);
      const writes = m.hardwareLog.recent().filter((w) => w.device === 'ulaPalette').length;
      // Bit 0 is the flash phase, which the vsync interrupt flips every 25 fields: leave it out.
      seen.push(`${String(n)}: &${hex8(m.videoUla.control & 0xfe)} ${stored(m)} (${String(writes)} writes)`);
    }
    expect(seen).toEqual([
      '0: &9C 7777777700000000 (16 writes)',
      '1: &D8 7766776644004400 (16 writes)',
      '2: &F4 76543210FEDCBA98 (16 writes)',
      '3: &9C 7777777700000000 (16 writes)',
      '4: &88 7777777700000000 (16 writes)',
      '5: &C4 7766776644004400 (16 writes)',
      '6: &88 7777777700000000 (16 writes)',
      // MODE 7 writes no palette: the SAA5050 colours teletext. MODE 6's entries stay.
      '7: &4A 7777777700000000 (0 writes)',
    ]);
  });

  withRoms(...BOTH_ROMS)('Stage 41: MOS_DEFAULT_PALETTE matches what the MOS writes for MODE 0-6', () => {
    const m = booted();
    for (const n of [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly MosBitmapMode[]) {
      mode(m, n);
      expect(stored(m)).toBe(MOS_DEFAULT_PALETTE[n].map((e) => e.toString(16).toUpperCase()).join(''));
    }
  });

  withRoms(...BOTH_ROMS)('MODE 0: entries 0-7 are black and 8-F white, so only index bit 3 matters', () => {
    const m = booted();
    mode(m, 0);
    expect(colours(m)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 7, 7, 7, 7, 7]);
  });

  withRoms(...BOTH_ROMS)('MODE 1: black, red, yellow, white, each in four entries: logical colour = index bits 3 and 1', () => {
    const m = booted();
    mode(m, 1);
    expect(colours(m)).toEqual([0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 7, 7, 3, 3, 7, 7]);
  });

  withRoms(...BOTH_ROMS)('MODE 2: entry n is colour n; 8-15 flash between n and its complement as the MOS flips control bit 0', () => {
    const m = booted();
    mode(m, 2);
    // The MOS writes &F4 with bit 0 clear and resets the flash counter, so this is the first phase.
    expect(m.videoUla.flash).toBe(false);
    expect(colours(m)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]);
    run(m, 25);
    expect(m.videoUla.flash).toBe(true);
    expect(colours(m)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  withRoms(...BOTH_ROMS)('VDU 19,1,4,0,0,0 in MODE 1 rewrites four entries (2, 3, 6 and 7) to blue, stored as 4 EOR 7 = &3', () => {
    const m = booted();
    mode(m, 1);
    m.hardwareLog.clear();
    typeText(m, 'VDU 19,1,4,0,0,0\r');
    run(m, 5);
    const writes = m.hardwareLog.recent().filter((w) => w.device === 'ulaPalette').map((w) => hex8(w.value));
    expect(writes).toEqual(['23', '33', '63', '73']);
    expect(colours(m)).toEqual([0, 0, 4, 4, 0, 0, 4, 4, 3, 3, 7, 7, 3, 3, 7, 7]);
  });
});
