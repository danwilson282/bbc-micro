import { IoLog } from './io-log';

describe('IoLog', () => {
  it('keeps accesses in order, numbered from 1', () => {
    const log = new IoLog();
    log.record(0xfe4e, 0x7f, true);
    log.record(0xfe44, 0xfe, false);
    expect(log.recent()).toEqual([
      { index: 1, address: 0xfe4e, value: 0x7f, write: true },
      { index: 2, address: 0xfe44, value: 0xfe, write: false },
    ]);
  });

  it('recent(n) gives the newest n, oldest first', () => {
    const log = new IoLog();
    for (let i = 0; i < 5; i++) log.record(0xfe40 + i, i, false);
    expect(log.recent(2).map((e) => e.address)).toEqual([0xfe43, 0xfe44]);
  });

  it('is a ring: once full, the newest access overwrites the oldest, and count keeps counting', () => {
    const log = new IoLog(4);
    for (let i = 0; i < 6; i++) log.record(0xfe00 + i, i, true);
    expect(log.count).toBe(6);
    expect(log.recent().map((e) => [e.index, e.address])).toEqual([
      [3, 0xfe02],
      [4, 0xfe03],
      [5, 0xfe04],
      [6, 0xfe05],
    ]);
  });

  it('clear() starts again from index 1', () => {
    const log = new IoLog();
    log.record(0xfe40, 0, false);
    log.clear();
    expect(log.recent()).toEqual([]);
    log.record(0xfe41, 0, false);
    expect(log.recent()[0]?.index).toBe(1);
  });

  it.each([0, 3, 100])('rejects a capacity of %p (must be a power of two)', (capacity) => {
    expect(() => new IoLog(capacity)).toThrow(RangeError);
  });
});
