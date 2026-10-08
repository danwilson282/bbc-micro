import { CYCLES_PER_FRAME, effectiveMhz, formatSpeed, frameShare, realSpeedMultiple } from './speed';

describe('speed arithmetic', () => {
  test('the real Model B does 40,000 CPU cycles in one 20 ms PAL frame', () => {
    expect(CYCLES_PER_FRAME).toBe(40_000);
  });

  test('2,000,000 cycles in 1000 ms is 2 MHz: exactly real speed, the whole frame', () => {
    expect(effectiveMhz(2_000_000, 1000)).toBe(2);
    expect(realSpeedMultiple(2_000_000, 1000)).toBe(1);
    expect(frameShare(2_000_000, 1000)).toBe(1);
  });

  test("Dormann's 96,241,367 cycles in 1050 ms is about 91.7 MHz, 45.8× real speed", () => {
    expect(formatSpeed(96_241_367, 1050)).toBe('91.7 MHz (45.8× real speed)');
    expect(frameShare(96_241_367, 1050)).toBeCloseTo(0.0218, 4);
  });

  test('a time of zero or less is an error, not Infinity', () => {
    expect(() => effectiveMhz(100, 0)).toThrow(RangeError);
  });
});
