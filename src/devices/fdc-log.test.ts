import { FdcLog, describeDriveInput, describeFdcEntry, describeOutputPort, type FdcLogEntry } from './fdc-log';

function clockAt(): { cycles: number } {
  return { cycles: 0 };
}

const PARAMS = new Uint8Array(5);

/** Records command with params (and a result unless undefined), at the clock's time. */
function record(log: FdcLog, command: number, params: readonly number[], result?: number): void {
  PARAMS.set(params);
  log.recordCommand(command, PARAMS, params.length, result ?? 0, result !== undefined);
}

function entry(command: number, params: readonly number[], result?: number): FdcLogEntry {
  return { index: 1, cycles: 0, lastCycles: 0, kind: 'command', command, params, result, repeats: 1 };
}

describe('FdcLog: recording', () => {
  it('keeps the command byte, its parameters, the result and the time', () => {
    const clock = clockAt();
    const log = new FdcLog(clock, 8);
    clock.cycles = 1234;
    record(log, 0x69, [0x05], 0x10);
    expect(log.recent()).toEqual([
      { index: 1, cycles: 1234, lastCycles: 1234, kind: 'command', command: 0x69, params: [0x05], result: 0x10, repeats: 1 },
    ]);
  });

  it('the same command, parameters and result again adds to the last entry: polling is one line', () => {
    const clock = clockAt();
    const log = new FdcLog(clock, 8);
    for (let i = 0; i < 1000; i++) {
      clock.cycles = 100 + i * 50;
      record(log, 0x6c, [], 0x00);
    }
    const [polls] = log.recent();
    expect(log.count).toBe(1);
    expect(polls).toMatchObject({ command: 0x6c, repeats: 1000, cycles: 100, lastCycles: 100 + 999 * 50 });
  });

  it('a different result starts a new entry', () => {
    const log = new FdcLog(clockAt(), 8);
    record(log, 0x6c, [], 0x00);
    record(log, 0x6c, [], 0x04);
    expect(log.recent().map((e) => e.result)).toEqual([0x00, 0x04]);
  });

  it('a reset is an entry of its own, and two in a row are counted', () => {
    const log = new FdcLog(clockAt(), 8);
    record(log, 0x6c, [], 0x00);
    log.recordReset();
    log.recordReset();
    expect(log.recent().map((e) => [e.kind, e.repeats])).toEqual([
      ['command', 1],
      ['reset', 2],
    ]);
  });

  it('is a ring: past capacity the oldest entries go, and index keeps counting', () => {
    const log = new FdcLog(clockAt(), 4);
    for (let t = 0; t < 6; t++) record(log, 0x69, [t], 0x10);
    expect(log.recent().map((e) => [e.index, e.params[0]])).toEqual([
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
  });

  it('capacity must be a power of two', () => {
    expect(() => new FdcLog(clockAt(), 6)).toThrow(RangeError);
  });

  it('clear() empties it', () => {
    const log = new FdcLog(clockAt(), 4);
    record(log, 0x69, [0], 0x10);
    log.clear();
    expect(log.recent()).toEqual([]);
  });
});

describe('describeFdcEntry: what each command meant', () => {
  it('Specify &0D: the three timing registers', () => {
    expect(describeFdcEntry(entry(0x75, [0x0d, 0x02, 0x08, 0xc0]))).toEqual({
      bytes: '75 0D 02 08 C0',
      drive: '0',
      text: 'Specify &0D: step rate &02, head settle &08, index count &C, head load &0',
    });
  });

  it('Specify &10 and &18: bad tracks &FF (none) and the current track, for each surface', () => {
    expect(describeFdcEntry(entry(0x75, [0x10, 0xff, 0xff, 0x00])).text).toBe('Specify &10: surface 0 bad tracks none, current track &00');
    expect(describeFdcEntry(entry(0x75, [0x18, 0x05, 0xff, 0x27])).text).toBe('Specify &18: surface 1 bad tracks &05, current track &27');
  });

  it('Write Special Register names the register and decodes the mode and output port', () => {
    expect(describeFdcEntry(entry(0x7a, [0x17, 0xc1])).text).toBe('Write Special Register &17 (mode) = &C1: non-DMA');
    expect(describeFdcEntry(entry(0x7a, [0x23, 0x48])).text).toBe(
      'Write Special Register &23 (drive control output) = &48: SELECT 0, LOAD HEAD',
    );
  });

  it('Read Special Register and Read Drive Status show their result', () => {
    expect(describeFdcEntry(entry(0x7d, [0x12], 0x00)).text).toBe('Read Special Register &12 (surface 0 current track) → &00');
    expect(describeFdcEntry(entry(0x6c, [], 0x00)).text).toBe('Read Drive Status → &00: not ready');
  });

  it('Seek and the data commands show the track, sector, size and the completion code', () => {
    expect(describeFdcEntry(entry(0x69, [0x05], 0x10)).text).toBe('Seek to track 5 → &10 drive not ready');
    expect(describeFdcEntry(entry(0x53, [0x00, 0x00, 0x22], 0x10)).text).toBe(
      'Read Data, track 0 sector 0, 2 × 256 bytes → &10 drive not ready',
    );
    expect(describeFdcEntry(entry(0x52, [0x01, 0x03], 0x18)).text).toBe('Read Data (one 128-byte record), track 1 sector 3 → &18 sector not found');
  });

  it('bits 7-6 pick the drive: &AC is drive 1, &2C neither, &EC both', () => {
    expect(describeFdcEntry(entry(0xac, [], 0x00)).drive).toBe('1');
    expect(describeFdcEntry(entry(0x2c, [], 0x00)).drive).toBe('none');
    expect(describeFdcEntry(entry(0xec, [], 0x00)).drive).toBe('both');
  });

  it('a code with no command, and a reset', () => {
    expect(describeFdcEntry(entry(0x41, [])).text).toBe('&01: no such command');
    expect(describeFdcEntry({ ...entry(0, []), kind: 'reset' })).toEqual({ bytes: '', drive: '', text: 'Reset (&FE82 bit 0 = 1)' });
  });
});

describe('the drive lines', () => {
  it('output port &48 is SELECT 0 + LOAD HEAD; &68 adds side 1 (bit 5), as DFS 0.98 uses for drive 2', () => {
    expect(describeOutputPort(0x48)).toBe('SELECT 0, LOAD HEAD');
    expect(describeOutputPort(0x68)).toBe('SELECT 0, SIDE 1, LOAD HEAD');
    expect(describeOutputPort(0x00)).toBe('nothing');
  });

  it('input lines &46 are RDY0, RDY1 and TRK0', () => {
    expect(describeDriveInput(0x46)).toBe('TRK0, RDY0, RDY1');
    expect(describeDriveInput(0x00)).toBe('not ready');
  });
});
