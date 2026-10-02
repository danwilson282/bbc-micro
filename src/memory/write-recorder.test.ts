import { TestBus } from './test-bus';
import { WRITE_RECORDER_CAPACITY, WriteRecorder } from './write-recorder';

function recorder(): { bus: TestBus; rec: WriteRecorder } {
  const bus = new TestBus();
  return { bus, rec: new WriteRecorder(bus) };
}

describe('WriteRecorder', () => {
  it('passes reads straight through to the bus it wraps, and records nothing for them', () => {
    const { bus, rec } = recorder();
    bus.write(0x7c00, 0x48);
    expect(rec.read(0x7c00)).toBe(0x48);
    expect(rec.count).toBe(0);
  });

  it('passes writes through to the bus it wraps', () => {
    const { bus, rec } = recorder();
    rec.write(0x7c28, 0x48);
    expect(bus.read(0x7c28)).toBe(0x48);
  });

  it('records each write as address and value, in order', () => {
    const { rec } = recorder();
    rec.write(0x7c28, 0x48);
    rec.write(0x0070, 0x00);
    expect(rec.count).toBe(2);
    expect(rec.recorded()).toEqual([
      { address: 0x7c28, value: 0x48 },
      { address: 0x0070, value: 0x00 },
    ]);
  });

  it('records a write of the value the byte already held: a write is not the same as a change', () => {
    const { bus, rec } = recorder();
    bus.write(0x7c04, 0x4f);
    rec.write(0x7c04, 0x4f);
    expect(rec.recorded()).toEqual([{ address: 0x7c04, value: 0x4f }]);
  });

  it('masks to 16 address lines and 8 data lines', () => {
    const { rec } = recorder();
    rec.write(0x17c28, 0x148);
    expect(rec.recorded()).toEqual([{ address: 0x7c28, value: 0x48 }]);
  });

  it('clear() forgets what was recorded, but not what was written', () => {
    const { bus, rec } = recorder();
    rec.write(0x7c28, 0x48);
    rec.clear();
    expect(rec.count).toBe(0);
    expect(rec.recorded()).toEqual([]);
    expect(bus.read(0x7c28)).toBe(0x48);
  });

  it(`keeps the first ${String(WRITE_RECORDER_CAPACITY)} writes and still counts the rest`, () => {
    const { bus, rec } = recorder();
    for (let i = 0; i < WRITE_RECORDER_CAPACITY + 3; i++) rec.write(0x3000 + i, i);
    expect(rec.count).toBe(WRITE_RECORDER_CAPACITY + 3);
    expect(rec.recorded()).toHaveLength(WRITE_RECORDER_CAPACITY);
    expect(rec.recorded().at(-1)).toEqual({ address: 0x3000 + WRITE_RECORDER_CAPACITY - 1, value: WRITE_RECORDER_CAPACITY - 1 });
    // The writes beyond capacity still reached memory.
    expect(bus.read(0x3000 + WRITE_RECORDER_CAPACITY + 2)).toBe(WRITE_RECORDER_CAPACITY + 2);
  });
});
