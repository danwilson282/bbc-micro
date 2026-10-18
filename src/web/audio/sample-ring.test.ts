import { SampleRing } from './sample-ring';

// Stage 46: the FIFO between the emulator's bursts and the audio thread's
// steady 128-sample reads. A fixed array, a read index and a write index.

const f32 = (...values: number[]): Float32Array => new Float32Array(values);

function pullAll(ring: SampleRing, count: number): number[] {
  const out = new Float32Array(count);
  const n = ring.pull(out, count);
  return Array.from(out.subarray(0, n));
}

describe('SampleRing: a fixed-size first-in, first-out queue of samples', () => {
  it('starts empty, with the capacity it was made with', () => {
    const ring = new SampleRing(8);
    expect(ring.length).toBe(0);
    expect(ring.capacity).toBe(8);
  });

  it('gives samples back in the order they went in', () => {
    const ring = new SampleRing(8);
    ring.push(f32(0.5, -0.25, 0.125));
    expect(pullAll(ring, 3)).toEqual([0.5, -0.25, 0.125]);
    expect(ring.length).toBe(0);
  });

  it('a pull asking for more than is there gives what there is, and says how many', () => {
    const ring = new SampleRing(8);
    ring.push(f32(1, 2));
    const out = new Float32Array(4);
    expect(ring.pull(out, 4)).toBe(2);
    expect(Array.from(out)).toEqual([1, 2, 0, 0]);
  });

  it('wraps round the end of its array: indices chase each other, nothing is shifted', () => {
    const ring = new SampleRing(4);
    ring.push(f32(1, 2, 3));
    expect(pullAll(ring, 2)).toEqual([1, 2]); // read index now 2, write index 3
    ring.push(f32(4, 5, 6)); // 4 at index 3, then 5 and 6 wrap to 0 and 1
    expect(ring.length).toBe(4);
    expect(pullAll(ring, 4)).toEqual([3, 4, 5, 6]);
  });

  it('when full, a push drops the oldest samples to make room, and returns how many it dropped', () => {
    const ring = new SampleRing(4);
    ring.push(f32(1, 2, 3));
    expect(ring.push(f32(4, 5, 6))).toBe(2);
    expect(pullAll(ring, 4)).toEqual([3, 4, 5, 6]);
  });

  it('a push bigger than the whole ring keeps only its newest samples', () => {
    const ring = new SampleRing(3);
    ring.push(f32(1));
    expect(ring.push(f32(2, 3, 4, 5, 6))).toBe(3); // the old 1, plus 2 and 3 from the new batch
    expect(pullAll(ring, 3)).toEqual([4, 5, 6]);
  });

  it('skip(n) throws away the n oldest, and no more than there are', () => {
    const ring = new SampleRing(8);
    ring.push(f32(1, 2, 3, 4));
    expect(ring.skip(3)).toBe(3);
    expect(pullAll(ring, 8)).toEqual([4]);
    expect(ring.skip(5)).toBe(0);
  });

  it('pull can fill part of an array, starting at an offset', () => {
    const ring = new SampleRing(4);
    ring.push(f32(7, 8));
    const out = new Float32Array(4);
    expect(ring.pull(out, 2, 1)).toBe(2);
    expect(Array.from(out)).toEqual([0, 7, 8, 0]);
  });

  it('clear() empties it', () => {
    const ring = new SampleRing(4);
    ring.push(f32(1, 2));
    ring.clear();
    expect(ring.length).toBe(0);
    expect(pullAll(ring, 4)).toEqual([]);
  });

  it('a capacity that is not a positive whole number is refused', () => {
    expect(() => new SampleRing(0)).toThrow(RangeError);
    expect(() => new SampleRing(2.5)).toThrow(RangeError);
  });
});
