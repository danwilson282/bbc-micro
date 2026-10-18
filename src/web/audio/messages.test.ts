import { isToWorklet, isWorkletStats } from './messages';

// Stage 46: whatever arrives on a MessagePort is `unknown` until checked.

describe('messages between the main thread and the worklet', () => {
  it('a batch of samples, and a reset, are recognised as messages to the worklet', () => {
    expect(isToWorklet({ type: 'samples', samples: new Float32Array(4) })).toBe(true);
    expect(isToWorklet({ type: 'reset' })).toBe(true);
  });

  it('anything else is not: wrong type, samples not a Float32Array, not an object', () => {
    expect(isToWorklet({ type: 'samples', samples: [0, 1] })).toBe(false);
    expect(isToWorklet({ type: 'play' })).toBe(false);
    expect(isToWorklet(null)).toBe(false);
    expect(isToWorklet('reset')).toBe(false);
  });

  it('stats from the worklet need every number and the playing flag', () => {
    const stats = { type: 'stats', sampleRate: 48_000, buffered: 2_880, underruns: 0, dropped: 0, peak: 0.158, pitch: 523, playing: true };
    expect(isWorkletStats(stats)).toBe(true);
    expect(isWorkletStats({ ...stats, peak: '0.158' })).toBe(false);
    expect(isWorkletStats({ ...stats, playing: undefined })).toBe(false);
    expect(isWorkletStats({ type: 'reset' })).toBe(false);
  });
});
