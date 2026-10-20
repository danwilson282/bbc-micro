import { SN_CPU_CYCLES_PER_TICK, SN_TICK_RATE_HZ, Sn76489 } from '../devices/sn76489';
import { BoxResampler } from './resampler';
import { SampleRecorder } from './sample-recorder';

// Stage 45: the chip makes 250,000 values a second; a sound card wants 44,100.
// The resampler averages the chip ticks that fall in each output sample.

function recorderAt(rate: number, capacity: number): { rec: SampleRecorder; rs: BoxResampler } {
  const rec = new SampleRecorder(capacity);
  return { rec, rs: new BoxResampler(rec, rate) };
}

/** Rising zero crossings per second: a square wave's frequency. */
function frequency(samples: Float32Array, rate: number): number {
  let rises = 0;
  for (let i = 1; i < samples.length; i++) if ((samples[i - 1] ?? 0) <= 0 && (samples[i] ?? 0) > 0) rises++;
  return (rises * rate) / samples.length;
}

describe('BoxResampler: 250 kHz chip ticks → 44.1 kHz samples', () => {
  it('one second of chip ticks (250,000) makes exactly 44,100 samples: the phase accumulator never drifts', () => {
    const { rec, rs } = recorderAt(44_100, 50_000);
    for (let i = 0; i < SN_TICK_RATE_HZ; i++) rs.input(0);
    expect(rec.samples).toHaveLength(44_100);
  });

  it('each sample averages 5 or 6 chip ticks (250,000 ÷ 44,100 ≈ 5.67)', () => {
    const counts: number[] = [];
    let n = 0;
    const rs = new BoxResampler({ write: () => { counts.push(n); n = 0; } }, 44_100);
    for (let i = 0; i < 2_500; i++) {
      n++;
      rs.input(0);
    }
    expect(new Set(counts)).toEqual(new Set([5, 6]));
  });

  it('a steady level comes out unchanged', () => {
    const { rec, rs } = recorderAt(44_100, 100);
    for (let i = 0; i < 500; i++) rs.input(0.25);
    expect(Array.from(rec.samples).every((s) => s === 0.25)).toBe(true);
  });

  it('a level flipping every tick (a 125 kHz square wave) averages to almost nothing, as the ear hears it', () => {
    const { rec, rs } = recorderAt(44_100, 1_000);
    for (let i = 0; i < 5_000; i++) rs.input(i % 2 === 0 ? 1 : -1);
    expect(Math.max(...Array.from(rec.samples).map(Math.abs))).toBeLessThan(0.21); // at most 1 of 5 ticks left over: 0.2 (as a Float32)
  });

  it('an output rate above the chip rate is refused', () => {
    expect(() => new BoxResampler(new SampleRecorder(1), 300_000)).toThrow(RangeError);
  });
});

describe('the chip through the resampler', () => {
  function play(bytes: readonly number[], seconds: number): Float32Array {
    const sn = new Sn76489();
    sn.powerOn();
    for (const b of bytes) sn.write(b);
    const { rec, rs } = recorderAt(44_100, 44_100 * seconds);
    sn.connectOutput(rs);
    sn.tick(SN_TICK_RATE_HZ * SN_CPU_CYCLES_PER_TICK * seconds);
    return rec.samples;
  }

  it('N = 125 plays 1,000 Hz (4 MHz ÷ (32 × 125)) at 44.1 kHz', () => {
    expect(frequency(play([0x90, 0x8d, 0x07], 1), 44_100)).toBeCloseTo(1000, -1);
  });

  it('N = &0EF plays the start-up bleep\'s 523 Hz', () => {
    expect(frequency(play([0x92, 0x8f, 0x0e], 1), 44_100)).toBeCloseTo(4_000_000 / (32 * 0xef), -1);
  });

  it('periodic noise at NF = 0 is a 1-in-15 pulse: 7,812.5 ÷ 15 = 520.8 Hz', () => {
    expect(frequency(play([0xf0, 0xe0], 1), 44_100)).toBeCloseTo(520.8, -1);
  });
});
