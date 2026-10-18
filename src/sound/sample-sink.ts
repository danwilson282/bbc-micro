// Where finished audio samples go (Stage 45): a recorder for the CLI's WAV
// files now, a ring buffer feeding Web Audio in Stage 46.

export interface SampleSink {
  /** One sample at the sink's rate, -1 to +1. Called from the hot path, so no allocation. */
  write(sample: number): void;
}
