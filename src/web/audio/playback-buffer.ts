// The jitter buffer (Stage 46): how the audio thread copes with samples that
// arrive in bursts, on a clock that isn't its own.
//
// The emulator sends a BBC frame's worth (960 samples at 48 kHz) whenever
// requestAnimationFrame runs one; the sound card takes 128 every 2.67 ms by
// its own crystal. So:
//
//   waiting   output the (fading) hold until `start` samples are buffered:
//             a cushion against the gaps between deliveries
//   playing   output samples in order. If fewer than a quantum are left, that's
//             an underrun: count it, hold the last level, and wait again
//   too full  above `highWater` the delay is noticeable: drop the oldest
//             down to `start` (the two clocks drift, so this happens now
//             and then even when nothing is wrong)
//
// On running dry it holds the last sample and lets it fade (×0.999 a
// sample), because a jump straight to 0 is a click.
//
// It also measures what it plays (peak level, and pitch from rising zero
// crossings) for the status line. Pure, so Jest can test it; the worklet is a thin shell.

import { SampleRing } from './sample-ring';

/** Web Audio renders in blocks of 128 sample frames (W3C Web Audio API, "render quantum"). */
export const QUANTUM = 128;

/** The held level is multiplied by this each sample: falls to 1/e in 1,000 samples (21 ms at 48 kHz). */
export const HOLD_DECAY = 0.999;

/** Buffer levels in samples. */
export interface PlaybackLevels {
  /** Start playing (again) once this many are buffered. */
  readonly start: number;
  /** Above this, trim back down to start. */
  readonly highWater: number;
  /** The ring's size. */
  readonly capacity: number;
}

/** 60 ms: three BBC frames, enough to ride a 60 Hz display's 33 ms gaps. */
const START_SECONDS = 0.06;
/** 120 ms: more delay than that and keys start to feel late. */
const HIGH_WATER_SECONDS = 0.12;
/** 500 ms: room for a 5-frame burst on top of high water. */
const CAPACITY_SECONDS = 0.5;

export function levelsFor(sampleRate: number): PlaybackLevels {
  return {
    start: Math.round(sampleRate * START_SECONDS),
    highWater: Math.round(sampleRate * HIGH_WATER_SECONDS),
    capacity: Math.round(sampleRate * CAPACITY_SECONDS),
  };
}

export class PlaybackBuffer {
  private readonly ring: SampleRing;
  private readonly start: number;
  private readonly highWater: number;
  private isPlaying = false;
  /** The level held (and fading) while there's nothing to play. */
  private hold = 0;
  /** The last sample output, for spotting zero crossings across quanta. */
  private last = 0;

  /** Times it ran dry while playing. */
  underruns = 0;
  /** Samples thrown away: a full ring, or trimmed above high water. */
  dropped = 0;
  /** Loudest |sample| output since startWindow(). */
  peak = 0;
  /** Rising zero crossings output since startWindow(): one per cycle of a tone. */
  crossings = 0;
  /** Samples output since startWindow(). */
  rendered = 0;
  /** Where in the window (samples) the first and the latest rising crossing were. */
  private firstCrossing = 0;
  private lastCrossing = 0;

  constructor(levels: PlaybackLevels) {
    if (!(levels.start <= levels.highWater && levels.highWater <= levels.capacity)) {
      throw new RangeError(`buffer levels must rise: start ${String(levels.start)} ≤ high water ${String(levels.highWater)} ≤ capacity ${String(levels.capacity)}`);
    }
    this.ring = new SampleRing(levels.capacity);
    this.start = levels.start;
    this.highWater = levels.highWater;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  /** Samples waiting. */
  get buffered(): number {
    return this.ring.length;
  }

  /** A batch from the emulator. */
  receive(samples: Float32Array): void {
    this.dropped += this.ring.push(samples);
    if (this.ring.length > this.highWater) this.dropped += this.ring.skip(this.ring.length - this.start);
  }

  /** Fills every sample of out: buffered samples if playing, else the fading hold. */
  render(out: Float32Array): void {
    if (!this.isPlaying && this.ring.length >= this.start) this.isPlaying = true;
    let filled = 0;
    if (this.isPlaying) {
      filled = this.ring.pull(out, out.length);
      if (filled > 0) this.hold = out[filled - 1] ?? 0;
      if (filled < out.length) {
        this.underruns++;
        this.isPlaying = false;
      }
    }
    for (let i = filled; i < out.length; i++) {
      this.hold *= HOLD_DECAY;
      out[i] = this.hold;
    }
    this.measure(out);
  }

  /** Starts a new measuring window for peak, crossings and rendered. */
  startWindow(): void {
    this.peak = 0;
    this.crossings = 0;
    this.rendered = 0;
    this.firstCrossing = 0;
    this.lastCrossing = 0;
  }

  /**
   * A single tone's frequency in Hz over this window, or 0 with fewer than
   * two crossings. It measures from the first crossing to the last, not
   * over the whole window, so a note that starts or stops mid-window (the
   * boot bleep is 0.28 s, a window 0.25 s) still reads its true pitch.
   */
  pitch(sampleRate: number): number {
    if (this.crossings < 2) return 0;
    return ((this.crossings - 1) * sampleRate) / (this.lastCrossing - this.firstCrossing);
  }

  /** Empties the ring and forgets the hold: as if just made (the counters are kept). */
  reset(): void {
    this.ring.clear();
    this.isPlaying = false;
    this.hold = 0;
    this.last = 0;
  }

  private measure(out: Float32Array): void {
    let last = this.last;
    for (let i = 0; i < out.length; i++) {
      const s = out[i] ?? 0;
      const size = Math.abs(s);
      if (size > this.peak) this.peak = size;
      if (last <= 0 && s > 0) {
        if (this.crossings === 0) this.firstCrossing = this.rendered + i;
        this.lastCrossing = this.rendered + i;
        this.crossings++;
      }
      last = s;
    }
    this.last = last;
    this.rendered += out.length;
  }
}
