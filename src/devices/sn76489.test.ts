import { HardwareLog, describeHardwareWrite } from './hardware-log';
import {
  NOISE_RATE_NAMES,
  SN76489_CLOCK_HZ,
  Sn76489,
  chipChannelForSound,
  describeSoundByte,
  noiseShiftRate,
  toneFrequency,
} from './sn76489';

/** Every byte through the chip, in order. */
function written(...bytes: number[]): Sn76489 {
  const sn = new Sn76489();
  sn.powerOn();
  for (const b of bytes) sn.write(b);
  return sn;
}

describe('SN76489: latch bytes (bit 7 = 1)', () => {
  it('a volume latch byte &D0 sets channel 2 attenuation to 0 and latches R5', () => {
    const sn = written(0xd0);
    expect(sn.attenuation(2)).toBe(0);
    expect(sn.latched).toBe(5);
  });

  it('bits 6-5 pick the channel: &9F, &BF, &DF, &FF turn channels 0-3 off (attenuation &F)', () => {
    const sn = written(0x90, 0xb0, 0xd0, 0xf0);
    expect([0, 1, 2, 3].map((c) => sn.attenuation(c))).toEqual([0, 0, 0, 0]);
    sn.write(0x9f);
    sn.write(0xbf);
    sn.write(0xdf);
    sn.write(0xff);
    expect([0, 1, 2, 3].map((c) => sn.attenuation(c))).toEqual([15, 15, 15, 15]);
  });

  it('a tone latch byte writes only the low 4 bits of N and keeps the high 6', () => {
    const sn = written(0xc5, 0x1d); // N = &1D5
    sn.write(0xca);
    expect(sn.tone(2)).toBe(0x1da);
    expect(sn.latched).toBe(4);
  });

  it('a noise latch byte &E6 sets the 3-bit noise control (white, ÷ 2048) and latches R6', () => {
    const sn = written(0xe6);
    expect(sn.noise).toBe(6);
    expect(sn.latched).toBe(6);
  });

  it('the noise control keeps only bits 2-0: &EF stores 7', () => {
    expect(written(0xef).noise).toBe(7);
  });

  it('a latch byte for one register leaves the other seven alone', () => {
    const sn = written(0x82, 0x3f, 0xa1, 0x3f, 0x95, 0xe3);
    sn.write(0xb7);
    expect(sn.tone(0)).toBe(0x3f2);
    expect(sn.tone(1)).toBe(0x3f1);
    expect(sn.attenuation(0)).toBe(5);
    expect(sn.attenuation(1)).toBe(7);
    expect(sn.noise).toBe(3);
  });
});

describe('SN76489: data bytes (bit 7 = 0)', () => {
  it("SOUND 1,-15,53,20's bytes &D0 &C5 &1D give channel 2 tone &1D5 (469) at attenuation 0", () => {
    const sn = written(0xd0, 0xc5, 0x1d);
    expect(sn.tone(2)).toBe(0x1d5);
    expect(sn.attenuation(2)).toBe(0);
  });

  it('a data byte after a tone latch writes the high 6 bits of N, ignoring bit 6', () => {
    const sn = written(0x8f, 0x4e); // bit 6 set: still &0E
    expect(sn.tone(0)).toBe(0x0ef);
  });

  it('a data byte keeps the low 4 bits, so a second data byte changes only the high bits', () => {
    const sn = written(0xa3, 0x01);
    expect(sn.tone(1)).toBe(0x013);
    sn.write(0x3f);
    expect(sn.tone(1)).toBe(0x3f3);
  });

  it('a data byte goes to the register latched last, not always channel 0', () => {
    const sn = written(0x8f, 0x0e, 0xc0, 0x2a);
    expect(sn.tone(0)).toBe(0x0ef);
    expect(sn.tone(2)).toBe(0x2a0);
  });

  it('a data byte after a volume latch writes its low 4 bits into the attenuation (the common reading, unconfirmed on TI parts)', () => {
    const sn = written(0xb0, 0x0c);
    expect(sn.attenuation(1)).toBe(0x0c);
    expect(sn.latched).toBe(3);
  });

  it('a data byte after a noise latch writes its low 3 bits into the noise control', () => {
    expect(written(0xe0, 0x05).noise).toBe(5);
  });

  it("the MOS's power-on sequence leaves every channel off with tones &3F2, &3F1, &3F0 and noise 0", () => {
    const sn = written(0x9f, 0x82, 0x3f, 0xbf, 0xa1, 0x3f, 0xdf, 0xc0, 0x3f, 0xff, 0xe0);
    expect([0, 1, 2].map((c) => sn.tone(c))).toEqual([0x3f2, 0x3f1, 0x3f0]);
    expect([0, 1, 2, 3].map((c) => sn.attenuation(c))).toEqual([15, 15, 15, 15]);
    expect(sn.noise).toBe(0);
    expect(sn.latched).toBe(6);
  });

  it('only bits 0-7 of the value count', () => {
    expect(written(0x1d0).attenuation(2)).toBe(0);
  });
});

describe('SN76489: power-on and reading back', () => {
  it('has no reset pin; our power-on state is silent: all attenuations &F, tones and noise 0, R0 latched', () => {
    const sn = written(0x90, 0x85, 0x3f, 0xe7);
    sn.powerOn();
    expect([0, 1, 2, 3].map((c) => sn.attenuation(c))).toEqual([15, 15, 15, 15]);
    expect([0, 1, 2].map((c) => sn.tone(c))).toEqual([0, 0, 0]);
    expect(sn.noise).toBe(0);
    expect(sn.latched).toBe(0);
  });

  it('register(r) reads R0-R7 by number: the datasheet order tone, attenuation, … noise, attenuation', () => {
    const sn = written(0x8f, 0x0e, 0x92, 0xe3, 0xf4);
    expect([0, 1, 6, 7].map((r) => sn.register(r))).toEqual([0x0ef, 2, 3, 4]);
  });

  it('records each write in the hardware log as device sound, with the register it reached', () => {
    const log = new HardwareLog({ cycles: 0 }, 16);
    const sn = new Sn76489(log);
    sn.write(0xc5);
    sn.write(0x1d);
    const writes = log.recent();
    expect(writes.map((w) => [w.device, w.register, w.value])).toEqual([
      ['sound', 4, 0xc5],
      ['sound', 4, 0x1d],
    ]);
    expect(writes.map(describeHardwareWrite)).toEqual([
      'sound &C5: latch R4 (channel 2 tone), low 4 bits = &5',
      'sound &1D: data for R4 (channel 2 tone), high 6 bits = &1D',
    ]);
  });
});

describe('SN76489: what the numbers mean', () => {
  it('the Model B clocks the chip at 4 MHz', () => {
    expect(SN76489_CLOCK_HZ).toBe(4_000_000);
  });

  it('tone frequency is 4 MHz ÷ (32 × N): N = &1D5 is about 266.5 Hz', () => {
    expect(toneFrequency(0x1d5)).toBeCloseTo(266.52, 2);
    expect(toneFrequency(0x0ef)).toBeCloseTo(523.01, 2);
  });

  it('noise rates 0-2 shift at 4 MHz ÷ 512, ÷ 1024, ÷ 2048; rate 3 follows channel 2', () => {
    expect([0, 1, 2].map(noiseShiftRate)).toEqual([7812.5, 3906.25, 1953.125]);
    expect(noiseShiftRate(3)).toBeUndefined();
    expect(NOISE_RATE_NAMES[3]).toBe('channel 2\'s tone');
  });

  it("BASIC's SOUND channels map backwards onto the chip (MOS table at &EB40): 0 → 3, 1 → 2, 2 → 1, 3 → 0", () => {
    expect([0, 1, 2, 3].map(chipChannelForSound)).toEqual([3, 2, 1, 0]);
  });

  it('describes latch and data bytes, and a data byte needs to know which register was latched', () => {
    expect(describeSoundByte(0xd0, 0)).toBe('latch R5 (channel 2 attenuation) = &0 (loudest)');
    expect(describeSoundByte(0x9f, 0)).toBe('latch R1 (channel 0 attenuation) = &F (off)');
    expect(describeSoundByte(0xb5, 0)).toBe('latch R3 (channel 1 attenuation) = &5 (-10 dB)');
    expect(describeSoundByte(0xe6, 0)).toBe('latch R6 (noise control) = 6 (white, 4 MHz ÷ 2048)');
    expect(describeSoundByte(0x3f, 2)).toBe('data for R2 (channel 1 tone), high 6 bits = &3F');
    expect(describeSoundByte(0x0c, 7)).toBe('data for R7 (channel 3 attenuation) = &C (-24 dB)');
  });
});
