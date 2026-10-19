import { describeFdcEntry } from '../devices/fdc-log';
import { FDC_STATUS_COMMAND_BUSY, FDC_STATUS_RESULT_FULL } from '../devices/fdc8271';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7StartAddress, mode7Text } from '../video/mode7-text';
import { BbcModelB } from './bbc-model-b';
import { tapKeys, typeText } from './type-text';

/** The ESCAPE key's matrix number (Advanced User Guide, keyboard). */
const ESCAPE = 0x70;

function screen(m: BbcModelB): string[] {
  return mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13))).map((r) => r.trimEnd());
}

/** The log as "bytes ×repeats", for comparing sequences. */
function commands(m: BbcModelB): string[] {
  return m.fdcLog.recent().map((e) => {
    const bytes = e.kind === 'reset' ? 'reset' : describeFdcEntry(e).bytes;
    return e.repeats > 1 ? `${bytes} ×many` : bytes;
  });
}

describe('BbcModelB: the 8271 on the bus', () => {
  it('answers &FE80-&FE87, and again every 8 bytes up to &FE9F', () => {
    const m = new BbcModelB();
    m.map.write(0xfe80, 0x6c); // Read Drive Status
    expect(m.map.read(0xfe98)).toBe(FDC_STATUS_RESULT_FULL);
    expect(m.map.read(0xfe89)).toBe(0x02); // the result, through a mirror: drive 0 is empty, its head on track 0 (TRK0)
    expect(m.fdc.status).toBe(0x00);
  });

  it('power-on resets it; BREAK does not (its RESET pin is not on /RES)', () => {
    const m = new BbcModelB();
    m.map.write(0xfe80, 0x7a); // waiting for 2 parameters
    m.reset();
    expect(m.fdc.status).toBe(FDC_STATUS_COMMAND_BUSY);
    m.powerOn();
    expect(m.fdc.status).toBe(0x00);
  });

  it('logs each command with the CPU cycle it ran on', () => {
    const m = new BbcModelB();
    m.cpu.cycles = 5000;
    m.map.write(0xfe80, 0x6c);
    expect(m.fdcLog.recent()[0]).toMatchObject({ command: 0x6c, cycles: 5000, result: 0x02 });
  });
});

describe('BbcModelB: DFS 0.98 talks to the 8271', () => {
  const ALL = ['roms/os12.rom', 'roms/basic2.rom', 'roms/dfs.rom'] as const;

  function booted(): BbcModelB {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    m.powerOn();
    for (let i = 0; i < 100; i++) m.runFrame();
    return m;
  }

  withRoms(...ALL)('at power-on it sends three Specifies and sets non-DMA mode, then BASIC starts below "Acorn DFS"', () => {
    const m = booted();
    expect(commands(m)).toEqual(['35 0D 0C 0A C8', '35 10 FF FF 00', '35 18 FF FF 00', '3A 17 C1']);
    expect(m.fdc.special(0x17)).toBe(0xc1);
    expect(screen(m).slice(1, 8)).toEqual(['BBC Computer 32K', '', 'Acorn DFS', '', 'BASIC', '', '>']);
  });

  withRoms(...ALL)('*CAT selects drive 0 (&23 = &48) and polls Read Drive Status, because RDY0 never comes up', () => {
    const m = booted();
    typeText(m, '*CAT\r');
    for (let i = 0; i < 50; i++) m.runFrame();
    expect(commands(m).slice(4)).toEqual(['6C', '3A 23 48', '6C ×many']);
    expect(m.fdc.special(0x23)).toBe(0x48);
    expect(screen(m)[7]).toBe('>*CAT');
    expect(screen(m)[8]).toBe(''); // no catalogue, no error: still waiting
  });

  withRoms(...ALL)('Escape makes the DFS reset the 8271 through &FE82, set it up again, and report Escape', () => {
    const m = booted();
    typeText(m, '*CAT\r');
    for (let i = 0; i < 50; i++) m.runFrame();
    tapKeys(m, [ESCAPE]);
    for (let i = 0; i < 20; i++) m.runFrame();
    expect(commands(m).slice(7)).toEqual(['reset', '35 0D 0C 0A C8', '35 10 FF FF 00', '35 18 FF FF 00', '3A 17 C1']);
    expect(m.fdc.inReset).toBe(false);
    expect(screen(m).slice(9, 11)).toEqual(['Escape', '>']);
  });
});
