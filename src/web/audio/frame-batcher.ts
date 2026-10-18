// One frame's samples, on the main thread (Stage 46).
//
// The resampler calls write() 48,000 times a second from inside the
// emulator's hot path, so this only stores into a fixed array. After each
// BBC frame, take() copies the batch into a new array (960 samples at
// 48 kHz) whose buffer is *transferred* to the audio thread: one small
// allocation per frame, not per sample.

import type { SampleSink } from '../../sound/sample-sink';

export class FrameBatcher implements SampleSink {
  private readonly buffer: Float32Array;
  private count = 0;
  private droppedCount = 0;

  constructor(capacity: number) {
    this.buffer = new Float32Array(capacity);
  }

  write(sample: number): void {
    if (this.count < this.buffer.length) this.buffer[this.count++] = sample;
    else this.droppedCount++;
  }

  /** Samples waiting to be taken. */
  get length(): number {
    return this.count;
  }

  /** Samples that arrived while the batch was full (nobody took it in time). */
  get dropped(): number {
    return this.droppedCount;
  }

  /** The batch as a new array, and the batcher emptied; undefined if there's nothing. */
  take(): Float32Array | undefined {
    if (this.count === 0) return undefined;
    const batch = this.buffer.slice(0, this.count);
    this.count = 0;
    return batch;
  }
}
