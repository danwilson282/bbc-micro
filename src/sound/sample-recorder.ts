// Samples kept in memory for the CLI to save (Stage 45). The buffer is
// sized up front, so writing never allocates: samples past the end are
// dropped and counted rather than growing an array mid-emulation.

import type { SampleSink } from './sample-sink';

export class SampleRecorder implements SampleSink {
  private readonly buffer: Float32Array;
  private length = 0;
  private droppedCount = 0;

  constructor(capacity: number) {
    this.buffer = new Float32Array(capacity);
  }

  write(sample: number): void {
    if (this.length < this.buffer.length) this.buffer[this.length++] = sample;
    else this.droppedCount++;
  }

  /** The samples written so far: a view, not a copy. */
  get samples(): Float32Array {
    return this.buffer.subarray(0, this.length);
  }

  /** Samples that arrived after the buffer was full. */
  get dropped(): number {
    return this.droppedCount;
  }

  clear(): void {
    this.length = 0;
    this.droppedCount = 0;
  }
}
