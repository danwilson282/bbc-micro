import { BoxResampler } from '../../sound/resampler';
import { FrameBatcher } from './frame-batcher';

// Stage 46: the main thread collects a frame's samples, then sends them to
// the audio thread in one message.

describe('FrameBatcher: one frame of samples, handed over as one array', () => {
  it('take() returns the samples written since the last take, in order, and empties the batch', () => {
    const batch = new FrameBatcher(8);
    batch.write(0.5);
    batch.write(-0.5);
    const taken = batch.take();
    expect(taken && Array.from(taken)).toEqual([0.5, -0.5]);
    expect(batch.length).toBe(0);
  });

  it('take() returns a new array each time, so it can be transferred to the audio thread', () => {
    const batch = new FrameBatcher(8);
    batch.write(1);
    const first = batch.take();
    batch.write(2);
    const second = batch.take();
    expect(first && Array.from(first)).toEqual([1]);
    expect(second && Array.from(second)).toEqual([2]);
    expect(first?.buffer).not.toBe(second?.buffer);
  });

  it('take() with nothing written returns undefined: no empty messages', () => {
    expect(new FrameBatcher(8).take()).toBeUndefined();
  });

  it('when full it drops new samples and counts them, rather than growing (no allocation in the hot path)', () => {
    const batch = new FrameBatcher(2);
    for (let i = 0; i < 5; i++) batch.write(i);
    expect(batch.length).toBe(2);
    expect(batch.dropped).toBe(3);
    const taken = batch.take();
    expect(taken && Array.from(taken)).toEqual([0, 1]);
  });

  it('one BBC frame (5,000 chip ticks) through the resampler at 48 kHz is exactly 960 samples', () => {
    const batch = new FrameBatcher(2_000);
    const rs = new BoxResampler(batch, 48_000);
    for (let i = 0; i < 5_000; i++) rs.input(0);
    expect(batch.length).toBe(960);
  });
});
