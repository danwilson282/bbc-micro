// From the chip's rate to a sound card's (Stage 45).
//
// The SN76489 changes its output 250,000 times a second; audio hardware
// wants 44,100 (or 48,000) samples. Taking every 5.67th value would alias:
// anything above half the output rate (a square wave's harmonics, or a tone
// with a tiny N) folds back down as a false lower note. Instead each output
// sample is the average of the chip ticks in its slot: a box filter, the
// simplest low-pass filter there is.
//
// Which ticks belong to which slot is decided by a phase accumulator: every
// tick adds the output rate, and each time the total passes the input rate a
// sample is finished and the input rate is taken off. Whole numbers only, so
// one second of ticks gives exactly one second of samples, with no drift.

import { SN_TICK_RATE_HZ, type ChipOutput } from '../devices/sn76489';
import type { SampleSink } from './sample-sink';

/** CD rate: what the CLI's WAV files use. */
export const DEFAULT_SAMPLE_RATE = 44_100;

export class BoxResampler implements ChipOutput {
  private sum = 0;
  private count = 0;
  private phase = 0;

  constructor(
    private readonly sink: SampleSink,
    private readonly outputRate: number = DEFAULT_SAMPLE_RATE,
    private readonly inputRate: number = SN_TICK_RATE_HZ,
  ) {
    if (!Number.isInteger(outputRate) || !Number.isInteger(inputRate) || outputRate <= 0 || outputRate > inputRate) {
      throw new RangeError(`can't resample ${String(inputRate)} Hz to ${String(outputRate)} Hz: the output rate must be a whole number no higher than the input's`);
    }
  }

  /** One chip tick's level. Finishes a sample when this tick completes its slot. */
  input(level: number): void {
    this.sum += level;
    this.count++;
    this.phase += this.outputRate;
    if (this.phase >= this.inputRate) {
      this.phase -= this.inputRate;
      this.sink.write(this.sum / this.count);
      this.sum = 0;
      this.count = 0;
    }
  }
}
