import { HOLD_DECAY, PlaybackBuffer, QUANTUM, levelsFor } from './playback-buffer';

// Stage 46: the jitter buffer's policy. Wait until there's a cushion (start),
// play, and when the cushion runs out, hold the last level and fade it
// rather than clicking to zero. Too much cushion (high water) is latency, so
// it's trimmed back to start.

/** A small buffer for tests: start 4 quanta, high water 8, capacity 16. */
const small = (): PlaybackBuffer => new PlaybackBuffer({ start: 4 * QUANTUM, highWater: 8 * QUANTUM, capacity: 16 * QUANTUM });

const block = (n: number, value: number): Float32Array => new Float32Array(n).fill(value);

describe('levelsFor: the buffer levels at a sample rate', () => {
  it('at 48 kHz: start 60 ms = 2,880 samples, high water 120 ms = 5,760, capacity 500 ms = 24,000', () => {
    expect(levelsFor(48_000)).toEqual({ start: 2_880, highWater: 5_760, capacity: 24_000 });
  });

  it('at 44.1 kHz: start 2,646, high water 5,292, capacity 22,050', () => {
    expect(levelsFor(44_100)).toEqual({ start: 2_646, highWater: 5_292, capacity: 22_050 });
  });

  it('the start is three BBC frames: 3 × 960 samples at 48 kHz', () => {
    expect(levelsFor(48_000).start).toBe(3 * (48_000 / 50));
  });
});

describe('PlaybackBuffer: the jitter buffer between the emulator and the sound card', () => {
  it('a quantum is 128 samples (Web Audio render quantum)', () => {
    expect(QUANTUM).toBe(128);
  });

  it('outputs silence and does not start playing until it holds the start level', () => {
    const pb = small();
    pb.receive(block(4 * QUANTUM - 1, 0.5));
    const out = block(QUANTUM, 9);
    pb.render(out);
    expect(pb.playing).toBe(false);
    expect(Array.from(out).every((s) => s === 0)).toBe(true);
    expect(pb.buffered).toBe(4 * QUANTUM - 1); // nothing taken while waiting
  });

  it('once it holds the start level it plays, in order', () => {
    const pb = small();
    const ramp = new Float32Array(4 * QUANTUM).map((_, i) => i / 1000);
    pb.receive(ramp);
    const out = new Float32Array(QUANTUM);
    pb.render(out);
    expect(pb.playing).toBe(true);
    expect(out[0]).toBeCloseTo(0);
    expect(out[127]).toBeCloseTo(0.127);
    expect(pb.buffered).toBe(3 * QUANTUM);
  });

  it('an underrun (fewer than a quantum left) is counted, holds the last sample decaying, and waits for the start level again', () => {
    const pb = small();
    pb.receive(block(4 * QUANTUM + 10, 0.5));
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i++) pb.render(out); // 10 left
    pb.render(out);
    expect(pb.underruns).toBe(1);
    expect(pb.playing).toBe(false);
    expect(out[9]).toBe(0.5); // the last real sample
    expect(out[10]).toBeCloseTo(0.5 * HOLD_DECAY); // then the hold, fading
    expect(out[127]).toBeCloseTo(0.5 * HOLD_DECAY ** 118, 5);
    // A little more arriving isn't enough to restart: it waits for the cushion.
    pb.receive(block(QUANTUM, 0.25));
    pb.render(out);
    expect(pb.playing).toBe(false);
    expect(pb.underruns).toBe(1); // waiting isn't another underrun
  });

  it('the hold fades about 63% in 1,000 samples (21 ms at 48 kHz), so a paused machine goes quiet without a click', () => {
    expect(HOLD_DECAY ** 1000).toBeCloseTo(Math.exp(-1), 3);
  });

  it('above the high-water level, the oldest samples are dropped down to the start level and counted', () => {
    const pb = small();
    pb.receive(block(8 * QUANTUM, 0.1));
    expect(pb.buffered).toBe(8 * QUANTUM); // at high water: kept
    pb.receive(block(1, 0.2));
    expect(pb.buffered).toBe(4 * QUANTUM);
    expect(pb.dropped).toBe(4 * QUANTUM + 1);
  });

  it('a burst past the capacity loses its oldest samples, then is trimmed to the start level', () => {
    const pb = small();
    pb.receive(block(20 * QUANTUM, 0.1));
    expect(pb.buffered).toBe(4 * QUANTUM);
    expect(pb.dropped).toBe(16 * QUANTUM);
  });

  it('peak is the loudest sample played since the window began, and crossings counts rising zero crossings: a pitch meter', () => {
    const pb = small();
    // A square wave of period 8 samples: 4 at +0.25, 4 at -0.25.
    const wave = new Float32Array(4 * QUANTUM).map((_, i) => ((i >> 2) & 1) === 0 ? -0.25 : 0.25);
    pb.receive(wave);
    pb.startWindow();
    const out = new Float32Array(QUANTUM);
    pb.render(out);
    expect(pb.peak).toBe(0.25);
    expect(pb.crossings).toBe(16); // 128 ÷ 8
    expect(pb.rendered).toBe(QUANTUM);
    expect(pb.pitch(48_000)).toBe(6_000); // a period of 8 samples at 48 kHz
    pb.startWindow();
    expect([pb.peak, pb.crossings, pb.rendered, pb.pitch(48_000)]).toEqual([0, 0, 0, 0]);
  });

  it('pitch is measured between the first and last crossing, so a tone filling only part of the window still reads true', () => {
    const pb = small();
    // 64 samples of a period-8 wave, then 3 quanta of silence (the tone has ended).
    const wave = new Float32Array(4 * QUANTUM).map((_, i) => (i < 64 ? (((i >> 2) & 1) === 0 ? -0.25 : 0.25) : 0));
    pb.receive(wave);
    pb.startWindow();
    const out = new Float32Array(QUANTUM);
    for (let i = 0; i < 4; i++) pb.render(out);
    expect(pb.crossings).toBe(8);
    expect(pb.pitch(48_000)).toBe(6_000); // not 8 crossings ÷ 512 samples = 750 Hz
  });

  it('reset() empties it and forgets the hold: it waits for the start level again', () => {
    const pb = small();
    pb.receive(block(4 * QUANTUM, 0.5));
    const out = new Float32Array(QUANTUM);
    pb.render(out);
    pb.reset();
    pb.render(out);
    expect(pb.playing).toBe(false);
    expect(pb.buffered).toBe(0);
    expect(Array.from(out).every((s) => s === 0)).toBe(true);
  });

  it('levels out of order (start above high water, or high water above capacity) are refused', () => {
    expect(() => new PlaybackBuffer({ start: 10, highWater: 5, capacity: 20 })).toThrow(RangeError);
    expect(() => new PlaybackBuffer({ start: 5, highWater: 30, capacity: 20 })).toThrow(RangeError);
  });
});
