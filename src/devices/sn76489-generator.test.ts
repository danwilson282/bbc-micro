import {
  ATTENUATION_GAIN,
  NOISE_RESET,
  SN_CPU_CYCLES_PER_TICK,
  SN_TICK_RATE_HZ,
  Sn76489,
  shiftNoise,
} from './sn76489';

// Stage 45: the generators behind the registers. One chip tick is 4 MHz ÷ 16
// = 250 kHz, which is every 8 of the CPU's 2 MHz cycles.

/** A powered-on chip with these bytes written. */
function chip(...bytes: number[]): Sn76489 {
  const sn = new Sn76489();
  sn.powerOn();
  for (const b of bytes) sn.write(b);
  return sn;
}

/** Ticks the chip one 250 kHz tick at a time and returns the ticks at which channel's output changed. */
function flipTicks(sn: Sn76489, channel: number, ticks: number): number[] {
  const at: number[] = [];
  let was = sn.channelOutput(channel);
  for (let t = 1; t <= ticks; t++) {
    sn.tick(SN_CPU_CYCLES_PER_TICK);
    const now = sn.channelOutput(channel);
    if (now !== was) at.push(t);
    was = now;
  }
  return at;
}

const gaps = (ts: readonly number[]): number[] => ts.slice(1).map((t, i) => t - (ts[i] ?? 0));

describe('SN76489 clocking', () => {
  it('one chip tick is 4 MHz ÷ 16 = 250 kHz: 8 CPU cycles at 2 MHz', () => {
    expect(SN_TICK_RATE_HZ).toBe(250_000);
    expect(SN_CPU_CYCLES_PER_TICK).toBe(8);
  });

  it('cycles left over from one step count towards the next: 5 + 3 cycles make one tick', () => {
    const sn = chip(0x81, 0x00); // channel 0, N = 1: flips every tick
    const before = sn.channelOutput(0);
    sn.tick(5);
    expect(sn.channelOutput(0)).toBe(before);
    sn.tick(3);
    expect(sn.channelOutput(0)).not.toBe(before);
  });
});

describe('SN76489 tone generators: count N ticks, flip', () => {
  it('N = 3: the output flips every 3 ticks, so a cycle is 6 ticks (4 MHz ÷ (32 × 3))', () => {
    const sn = chip(0x83, 0x00);
    expect(gaps(flipTicks(sn, 0, 30))).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('N = &1D5 on channel 2 flips every 469 ticks: 266.5 Hz, SOUND 1,-15,53', () => {
    const sn = chip(0xc5, 0x1d);
    const g = gaps(flipTicks(sn, 2, 469 * 6));
    expect(g.every((x) => x === 469)).toBe(true);
    expect(SN_TICK_RATE_HZ / (2 * 469)).toBeCloseTo(266.5, 1);
  });

  it('each channel counts its own N: channels 0, 1, 2 at 2, 5, 7 ticks', () => {
    const sn = chip(0x82, 0x00, 0xa5, 0x00, 0xc7, 0x00);
    expect(gaps(flipTicks(sn, 0, 40)).every((x) => x === 2)).toBe(true);
    const sn1 = chip(0x82, 0x00, 0xa5, 0x00, 0xc7, 0x00);
    expect(gaps(flipTicks(sn1, 1, 40)).every((x) => x === 5)).toBe(true);
    const sn2 = chip(0x82, 0x00, 0xa5, 0x00, 0xc7, 0x00);
    expect(gaps(flipTicks(sn2, 2, 40)).every((x) => x === 7)).toBe(true);
  });

  it('a new N waits for the next reload: the half-cycle in progress finishes at the old length', () => {
    const sn = chip(0x8a, 0x00); // N = 10
    expect(flipTicks(sn, 0, 1)).toEqual([1]); // power-on counter is 0, so it reloads at once
    flipTicks(sn, 0, 4); // 4 ticks into a 10-tick half-cycle
    sn.write(0x83); // N = 3 now
    expect(gaps([0, ...flipTicks(sn, 0, 15)])).toEqual([6, 3, 3, 3]);
  });

  it('N = 0 counts like 1024 on TI parts (reported, not datasheet): 122.1 Hz', () => {
    const sn = chip(0x80, 0x00);
    const g = gaps(flipTicks(sn, 0, 1024 * 4));
    expect(g).toEqual([1024, 1024, 1024]);
  });
});

describe('SN76489 noise: the 15-bit shift register', () => {
  it('white noise feeds bit 0 XOR bit 1 into bit 14: &4000 → &2000 … &0002 → &4001 → &6000', () => {
    const seq = [NOISE_RESET];
    for (let i = 0; i < 15; i++) seq.push(shiftNoise(seq[seq.length - 1] ?? 0, true));
    expect(seq.slice(0, 3)).toEqual([0x4000, 0x2000, 0x1000]);
    expect(seq.slice(13, 16)).toEqual([0x0002, 0x4001, 0x6000]);
  });

  it('white noise repeats after 32,767 shifts (2^15 − 1: every state but zero), and not before', () => {
    let r = NOISE_RESET;
    let period = 0;
    do {
      r = shiftNoise(r, true);
      period++;
    } while (r !== NOISE_RESET && period < 40_000);
    expect(period).toBe(32_767);
  });

  it('periodic noise feeds bit 0 back: the single 1 comes out once every 15 shifts', () => {
    let r = NOISE_RESET;
    const out: number[] = [];
    for (let i = 0; i < 45; i++) {
      r = shiftNoise(r, false);
      out.push(r & 1);
    }
    expect(out.filter((b) => b === 1)).toHaveLength(3);
    expect(out.indexOf(1)).toBe(13); // after the 14th shift: &4000 >> 14 = &0001
    expect(out.lastIndexOf(1)).toBe(43);
    expect(r).toBe(NOISE_RESET);
  });

  it('any write to R6 reloads the shift register with &4000', () => {
    const sn = chip(0xe4); // white, NF = 0
    for (let i = 0; i < 100; i++) sn.tick(256);
    expect(sn.shiftRegister).not.toBe(NOISE_RESET);
    sn.write(0xe4);
    expect(sn.shiftRegister).toBe(NOISE_RESET);
  });

  it.each([
    [0xe4, 0, 32],
    [0xe5, 1, 64],
    [0xe6, 2, 128],
  ])('R6 = &%s (NF = %i) shifts once every %i ticks: on each rising edge of a counter reloading 16 << NF', (r6, _nf, every) => {
    const sn = chip(r6);
    const shiftsAt: number[] = [];
    let was = sn.shiftRegister;
    for (let t = 1; t <= every * 6; t++) {
      sn.tick(SN_CPU_CYCLES_PER_TICK);
      if (sn.shiftRegister !== was) shiftsAt.push(t);
      was = sn.shiftRegister;
    }
    expect(gaps(shiftsAt)).toEqual([every, every, every, every, every]);
  });

  it("NF = 3 shifts once per channel 2 cycle: with N = 5 on channel 2, every 10 ticks", () => {
    const sn = chip(0xc5, 0x00, 0xe7);
    const shiftsAt: number[] = [];
    let was = sn.shiftRegister;
    for (let t = 1; t <= 60; t++) {
      sn.tick(SN_CPU_CYCLES_PER_TICK);
      if (sn.shiftRegister !== was) shiftsAt.push(t);
      was = sn.shiftRegister;
    }
    expect(gaps(shiftsAt)).toEqual([10, 10, 10, 10, 10]);
  });

  it("channel 3's output is the shift register's bit 0", () => {
    const sn = chip(0xe4);
    for (let i = 0; i < 50; i++) {
      sn.tick(32 * SN_CPU_CYCLES_PER_TICK);
      expect(sn.channelOutput(3)).toBe(sn.shiftRegister & 1);
    }
  });
});

describe('SN76489 attenuators and mixer', () => {
  it('each attenuation step is 2 dB: &0 = 1, &1 = 0.794, &3 = 0.501, &A = 0.1, &E = 0.040, &F = off', () => {
    expect(ATTENUATION_GAIN[0]).toBe(1);
    expect(ATTENUATION_GAIN[1]).toBeCloseTo(0.794, 3);
    expect(ATTENUATION_GAIN[3]).toBeCloseTo(0.501, 3);
    expect(ATTENUATION_GAIN[10]).toBeCloseTo(0.1, 3);
    expect(ATTENUATION_GAIN[14]).toBeCloseTo(0.0398, 3);
    expect(ATTENUATION_GAIN[15]).toBe(0);
  });

  it('powered on, every channel is off, so the mix is 0 however long it runs', () => {
    const sn = chip();
    for (let i = 0; i < 100; i++) {
      sn.tick(SN_CPU_CYCLES_PER_TICK);
      expect(sn.level).toBe(0);
    }
  });

  it('one channel at attenuation 0 swings between +¼ and −¼ (four channels share ±1)', () => {
    const sn = chip(0x90, 0x84, 0x00); // channel 0 loudest, N = 4
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) {
      sn.tick(SN_CPU_CYCLES_PER_TICK);
      seen.add(sn.level);
    }
    expect([...seen].sort()).toEqual([-0.25, 0.25]);
  });

  it('attenuation &3 (−6 dB) roughly halves a channel: ±0.125', () => {
    const sn = chip(0x93, 0x84, 0x00);
    sn.tick(SN_CPU_CYCLES_PER_TICK);
    expect(Math.abs(sn.level)).toBeCloseTo(0.125, 3);
  });

  it('all four channels at attenuation 0 and all high reach exactly +1', () => {
    // N = 1 on every tone; noise periodic so bit 0 is known.
    const sn = chip(0x90, 0xb0, 0xd0, 0xf0, 0x81, 0x00, 0xa1, 0x00, 0xc1, 0x00, 0xe0);
    const levels: number[] = [];
    for (let i = 0; i < 32 * 15; i++) {
      sn.tick(SN_CPU_CYCLES_PER_TICK);
      levels.push(sn.level);
    }
    expect(Math.max(...levels)).toBe(1);
    expect(Math.min(...levels)).toBe(-1);
  });

  it('power-on resets the generators too: counters, outputs and the shift register', () => {
    const sn = chip(0x90, 0x83, 0x00, 0xe4);
    for (let i = 0; i < 1000; i++) sn.tick(7);
    sn.powerOn();
    expect(sn.shiftRegister).toBe(NOISE_RESET);
    expect([0, 1, 2].map((c) => sn.channelOutput(c))).toEqual([0, 0, 0]);
  });
});

describe('SN76489 output: one value per chip tick to whatever is connected', () => {
  it('sends exactly one level per 8 CPU cycles, whatever the step sizes', () => {
    const sn = chip(0x90, 0x83, 0x00);
    const got: number[] = [];
    sn.connectOutput({ input: (level) => got.push(level) });
    for (const c of [2, 3, 4, 5, 6, 7, 12, 1]) sn.tick(c); // 40 cycles
    expect(got).toHaveLength(5);
    expect(got.every((l) => Math.abs(l) === 0.25)).toBe(true);
  });

  it('disconnected, it still runs: the noise register moves on with nothing listening', () => {
    const sn = chip(0xe4);
    sn.connectOutput(undefined);
    sn.tick(32 * SN_CPU_CYCLES_PER_TICK * 3);
    expect(sn.shiftRegister).not.toBe(NOISE_RESET);
  });
});
