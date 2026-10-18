import { SampleRecorder } from './sample-recorder';

describe('SampleRecorder: a fixed-size buffer of samples', () => {
  it('keeps samples in order, and samples is just the part written', () => {
    const rec = new SampleRecorder(4);
    rec.write(0.5);
    rec.write(-0.25);
    expect(Array.from(rec.samples)).toEqual([0.5, -0.25]);
  });

  it('when full, it drops samples and counts them instead of growing (no allocation while running)', () => {
    const rec = new SampleRecorder(2);
    for (let i = 0; i < 5; i++) rec.write(0.1 * i);
    expect(rec.samples).toHaveLength(2);
    expect(rec.dropped).toBe(3);
  });

  it('clear() starts again from empty', () => {
    const rec = new SampleRecorder(2);
    rec.write(1);
    rec.write(1);
    rec.write(1);
    rec.clear();
    expect(rec.samples).toHaveLength(0);
    expect(rec.dropped).toBe(0);
  });
});
