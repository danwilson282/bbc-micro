// A ring buffer of samples (Stage 46): a first-in, first-out queue in a
// fixed Float32Array, so it never allocates once made. That matters because
// it lives on the browser's audio thread, which must never stall.
//
// Two indices chase each other round the array, wrapping at the end:
//
//   index:   0   1   2   3   4   5   6   7
//          [ c | d | e | . | . | . | a | b ]      a b c d e waiting
//                        ^           ^
//                      write        read
//
// The count is kept separately: with only the indices, read === write could
// mean empty or full.
//
// When it's full, a push drops the *oldest* samples: for audio, the newest
// are the ones worth keeping (they're closest to "now").
//
// It's pure (no Web Audio here), so the worklet uses it and Jest tests it.

export class SampleRing {
  private readonly buffer: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError(`a ring needs a whole number of slots, not ${String(capacity)}`);
    this.buffer = new Float32Array(capacity);
  }

  get capacity(): number {
    return this.buffer.length;
  }

  /** Samples waiting to be pulled. */
  get length(): number {
    return this.count;
  }

  /** Adds the samples at the back. Returns how many of the oldest were dropped to make room. */
  push(samples: Float32Array): number {
    const capacity = this.buffer.length;
    let dropped = 0;
    let from = 0;
    // More than the whole ring: only the newest `capacity` can survive.
    if (samples.length > capacity) {
      from = samples.length - capacity;
      dropped += from;
    }
    const incoming = samples.length - from;
    const overflow = this.count + incoming - capacity;
    if (overflow > 0) dropped += this.skip(overflow);
    for (let i = from; i < samples.length; i++) {
      this.buffer[this.writeIndex] = samples[i] ?? 0;
      this.writeIndex = this.writeIndex + 1 === capacity ? 0 : this.writeIndex + 1;
    }
    this.count += incoming;
    return dropped;
  }

  /**
   * Takes up to `count` samples from the front into out[start…]. Returns how
   * many it took: fewer than asked means the ring ran dry.
   */
  pull(out: Float32Array, count: number, start = 0): number {
    const capacity = this.buffer.length;
    const n = Math.min(count, this.count);
    for (let i = 0; i < n; i++) {
      out[start + i] = this.buffer[this.readIndex] ?? 0;
      this.readIndex = this.readIndex + 1 === capacity ? 0 : this.readIndex + 1;
    }
    this.count -= n;
    return n;
  }

  /** Throws away up to n of the oldest samples. Returns how many went. */
  skip(n: number): number {
    const k = Math.min(Math.max(n, 0), this.count);
    this.readIndex = (this.readIndex + k) % this.buffer.length;
    this.count -= k;
    return k;
  }

  clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.count = 0;
  }
}
