import type { FdcLogEntry } from '../../devices/fdc-log';
import { FDC_ENTRIES_SHOWN, buildFdcView, formatSeconds, type FdcViewInput } from './fdc-view-model';

function entry(command: number, params: readonly number[], result: number | undefined, cycles = 0, repeats = 1): FdcLogEntry {
  return { index: 1, cycles, lastCycles: cycles, kind: 'command', command, params, result, repeats };
}

/** The special registers after DFS 0.98's power-on and *CAT. */
const AFTER_CAT: Readonly<Record<number, number>> = { 0x0d: 0x0c, 0x0e: 0x0a, 0x0f: 0xc8, 0x17: 0xc1, 0x23: 0x48 };

function input(overrides: Partial<FdcViewInput> = {}): FdcViewInput {
  return {
    status: 0,
    result: 0,
    inReset: false,
    driveLines: 0,
    special: (a) => AFTER_CAT[a] ?? 0,
    entries: [],
    phase: 'idle',
    drives: [],
    bytesTransferred: 0,
    lateBytes: 0,
    ...overrides,
  };
}

describe('FDC panel view-model: the status register', () => {
  it('&00 is idle, with every bit off', () => {
    const view = buildFdcView(input());
    expect(view.summary).toBe('Status &00: idle');
    expect(view.bits.map((b) => b.on)).toEqual([false, false, false, false, false, false]);
    expect(view.bits.map((b) => b.name)).toEqual(['BUSY', 'CMD FULL', 'PARAM FULL', 'RESULT', 'INT', 'DATA']);
  });

  it('&80 is busy: the chip is waiting for parameters', () => {
    const view = buildFdcView(input({ status: 0x80 }));
    expect(view.summary).toBe('Status &80: busy, waiting for parameters');
    expect(view.bits[0]?.on).toBe(true);
  });

  it('&18 is a result waiting, with the interrupt bit lit too', () => {
    const view = buildFdcView(input({ status: 0x18, result: 0x10 }));
    expect(view.summary).toBe('Status &18: result waiting (&10)');
    expect(view.bits.filter((b) => b.on).map((b) => b.name)).toEqual(['RESULT', 'INT']);
  });

  it('held in reset says so', () => {
    expect(buildFdcView(input({ inReset: true })).summary).toBe('Status &00: held in reset (&FE82 bit 0 = 1)');
  });
});

describe('FDC panel view-model: what a busy chip is doing (Stage 50)', () => {
  it.each([
    ['seeking', 'stepping the head'],
    ['settling', 'letting the head settle'],
    ['searching', 'waiting for the sector to come round'],
    ['data', 'reading data'],
    ['id', 'reading an ID'],
    ['crc', 'checking the CRC'],
  ] as const)('busy while %s says "%s"', (phase, text) => {
    expect(buildFdcView(input({ status: 0x80, phase })).summary).toBe(`Status &80: busy, ${text}`);
  });

  it('&8C is busy with a data byte waiting: BUSY, INT and DATA lit', () => {
    const view = buildFdcView(input({ status: 0x8c, phase: 'data' }));
    expect(view.summary).toBe('Status &8C: busy, reading data');
    expect(view.bits.filter((b) => b.on).map((b) => b.name)).toEqual(['BUSY', 'INT', 'DATA']);
  });
});

describe('FDC panel view-model: the drives (Stage 50)', () => {
  it('each drive shows its disc (or empty) and where its head is', () => {
    const view = buildFdcView(input({ drives: [{ disc: 'test.ssd', headTrack: 0 }, { disc: undefined, headTrack: 3 }] }));
    expect(view.drives).toEqual([
      { label: 'Drive 0', text: 'test.ssd · head on track 0 · ready' },
      { label: 'Drive 1', text: 'empty · head on track 3' },
    ]);
  });

  it('counts the bytes that came by NMI, and the late ones', () => {
    expect(buildFdcView(input({ bytesTransferred: 1536, lateBytes: 1 })).transfer).toBe('1,536 bytes by NMI · 1 late');
  });
});

describe('FDC panel view-model: the special registers', () => {
  it('decodes the mode, the drive lines and the timings DFS 0.98 sets', () => {
    const rows = buildFdcView(input()).registers.map((r) => [r.label, r.value, r.meaning]);
    expect(rows).toEqual([
      ['Mode (&17)', '&C1', 'non-DMA'],
      ['Drive output (&23)', '&48', 'SELECT 0, LOAD HEAD'],
      ['Drive input (&22)', '&00', 'not ready'],
      ['Step rate (&0D)', '&0C', ''],
      ['Head settle (&0E)', '&0A', ''],
      ['Index count / head load (&0F)', '&C8', 'index count &C, head load &8'],
      ['Surface 0 track (&12)', '&00', ''],
      ['Surface 1 track (&1A)', '&00', ''],
    ]);
  });
});

describe('FDC panel view-model: the command log', () => {
  it('says how to get commands when there are none', () => {
    expect(buildFdcView(input()).empty).toMatch(/dfs\.rom/);
    expect(buildFdcView(input({ entries: [entry(0x6c, [], 0)] })).empty).toBe('');
  });

  it('each row has the time, the bytes, the drive, the meaning and how many times it ran', () => {
    const view = buildFdcView(input({ entries: [entry(0x3a, [0x17, 0xc1], undefined, 569_254), entry(0x6c, [], 0x00, 4_677_960, 37_215)] }));
    expect(view.entries).toEqual([
      { time: '0.285 s', bytes: '3A 17 C1', drive: 'none', text: 'Write Special Register &17 (mode) = &C1: non-DMA', repeats: '' },
      { time: '2.339 s', bytes: '6C', drive: '0', text: 'Read Drive Status → &00: not ready', repeats: '×37,215' },
    ]);
  });

  it(`lists only the last ${String(FDC_ENTRIES_SHOWN)}, newest last`, () => {
    const entries = Array.from({ length: 20 }, (_, t) => entry(0x69, [t], 0x10));
    const view = buildFdcView(input({ entries }));
    expect(view.entries).toHaveLength(FDC_ENTRIES_SHOWN);
    expect(view.entries.at(-1)?.text).toBe('Seek to track 19 → &10 drive not ready');
  });

  it('times are seconds of the 2 MHz CPU', () => {
    expect(formatSeconds(2_000_000)).toBe('1.000 s');
  });
});
