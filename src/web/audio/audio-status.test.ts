import { audioStatusText } from './audio-status';
import type { WorkletStats } from './messages';

// Stage 46: the line under the screen that says what the audio thread is doing.

const stats = (over: Partial<WorkletStats> = {}): WorkletStats => ({
  type: 'stats',
  sampleRate: 48_000,
  buffered: 2_880,
  underruns: 0,
  dropped: 0,
  peak: 0,
  pitch: 0,
  playing: true,
  ...over,
});

describe('audioStatusText', () => {
  it('before the first report: starting', () => {
    expect(audioStatusText(undefined)).toBe('starting…');
  });

  it('shows the rate, the buffer in ms (2,880 samples at 48 kHz = 60 ms) and the underruns', () => {
    expect(audioStatusText(stats())).toBe('48 kHz · 60 ms buffered · 0 underruns · silent');
  });

  it('a tone: its pitch from the zero crossings, and its peak level (the boot bleep: 523 Hz at 0.16)', () => {
    expect(audioStatusText(stats({ peak: 0.158, pitch: 523.4 }))).toBe('48 kHz · 60 ms buffered · 0 underruns · ≈523 Hz, peak 0.16');
  });

  it('waiting for the cushion to fill: buffering, and samples dropped when there are some', () => {
    expect(audioStatusText(stats({ playing: false, buffered: 960, underruns: 1, dropped: 2_881, sampleRate: 44_100 }))).toBe(
      '44.1 kHz · 22 ms buffered · 1 underrun · 2,881 dropped · buffering',
    );
  });
});
