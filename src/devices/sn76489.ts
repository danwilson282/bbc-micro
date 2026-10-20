// The Texas Instruments SN76489 sound generator: its register file and the
// byte protocol that fills it (Stage 44), and the generators that turn those
// numbers into a waveform (Stage 45).
//
// Three square-wave tone channels, one noise channel, and four attenuators.
// The CPU can't read any of it back. On the Model B the chip's D0-D7 are the
// System VIA's port A (the "slow data bus") and its /WE is IC32 bit 0, so the
// machine calls write() when that bit falls, with port A's levels.
//
// Eight registers, numbered by the three bits a latch byte carries
// (SN76489 datasheet, "Register address field"):
//
//   R0 tone 0   R1 att 0   R2 tone 1   R3 att 1
//   R4 tone 2   R5 att 2   R6 noise    R7 att 3
//
// So R >> 1 is the channel and R & 1 is 1 for an attenuation. Two kinds of
// byte, told apart by bit 7:
//
//   latch: 1 R R R d d d d   latch register R, write dddd into it
//   data:  0 x d d d d d d   write into the register latched last
//
// A tone is 10 bits: the latch byte carries the low 4, a data byte the
// high 6. (The TI datasheet numbers bits backwards, D0 = the MSB. This file
// uses the usual bit 0 = LSB throughout.)
//
// The generators (Stage 45). The chip divides its 4 MHz clock by 16, so
// everything moves on 250,000 times a second: one "chip tick" per 8 CPU
// cycles. Each tick:
//
//   tone 0-2  count down; at zero, reload N and flip the output
//   noise     its own counter (16/32/64 ticks, or channel 2's N) flips; on
//             each rising edge the 15-bit shift register shifts, and its
//             bit 0 is the output
//
// Then the four outputs, each ±gain(attenuation), are summed and ÷ 4. Where
// the datasheet is silent (N = 0, the noise taps and width) this follows
// SMS Power's measurements of the SN76489AN; see the Stage 45 doc.
//
// N = 1 is special (SMS Power): the output doesn't oscillate, it holds at 1.
// Software uses that to play samples: tones at N = 1, and the attenuation
// written thousands of times a second as a 4-bit DAC. Superior Software's
// Speech! (1985) does exactly that. Found after Stage 51: we had a 125 kHz
// square wave there, which averages to silence.

import type { Clocked } from './clocked';
import type { HardwareLog } from './hardware-log';

/** The Model B's sound clock: the 16 MHz crystal ÷ 4 (Advanced User Guide, "The sound generator"). */
export const SN76489_CLOCK_HZ = 4_000_000;

/** A tone channel's square wave: one full period is 32 × N clocks (datasheet, "Tone generators"). */
const TONE_CLOCKS_PER_N = 32;

/** The chip divides its clock by 16 before anything else (datasheet, "Tone generators"). */
const SN_CLOCK_DIVIDER = 16;
/** One chip tick: 4 MHz ÷ 16 = 250 kHz. */
export const SN_TICK_RATE_HZ = SN76489_CLOCK_HZ / SN_CLOCK_DIVIDER;
/** The CPU's 2 MHz ÷ 250 kHz: a chip tick every 8 CPU cycles. */
export const SN_CPU_CYCLES_PER_TICK = 8;
/** N = 0 counts like 1024 on TI parts: the 10-bit counter wraps (SMS Power; not in the datasheet). */
const TONE_ZERO_PERIOD = 0x400;
/** N = 1 holds the output at 1 instead of flipping every tick (SMS Power: the sample-playback trick). */
const TONE_HELD_HIGH = 1;

/** Bit 7: 1 = latch byte, 0 = data byte. */
const LATCH_BYTE = 0x80;
/** Bits 6-4 of a latch byte: the register, R0-R7. */
const REGISTER_SHIFT = 4;
const REGISTER_MASK = 0x07;
/** The noise control register (channel 3's "tone" slot). */
export const SN_NOISE_REGISTER = 6;

/** The 4 data bits in a latch byte. */
const LOW_NIBBLE = 0x0f;
/** The 6 data bits in a data byte (bit 6 is ignored). */
const DATA_BITS = 0x3f;
/** A tone register's 10 bits. */
const TONE_MASK = 0x3ff;
/** Noise control: bit 2 FB (white/periodic), bits 1-0 NF (shift rate). */
const NOISE_MASK = 0x07;
export const SN_NOISE_WHITE = 0x04;
const NOISE_RATE_MASK = 0x03;

/** Attenuation &F: the channel is off, not -30 dB. */
export const SN_ATTENUATION_OFF = 0x0f;
/** Each attenuation step is 2 dB (bit 0 = 2 dB … bit 3 = 16 dB). */
const DB_PER_STEP = 2;

/** NF = 0-2: the noise shift register is clocked at 4 MHz ÷ 512, 1024, 2048 (512 << NF). NF = 3: by channel 2's tone. */
const NOISE_BASE_DIVIDER = 512;
/** The noise counter reloads with 16 << NF ticks and shifts every other flip: 32 ticks × 16 = 512 clocks. */
const NOISE_BASE_PERIOD = 16;
/** The 15-bit noise shift register starts (and restarts on any R6 write) with a single 1 at the top. */
export const NOISE_RESET = 0x4000;
/** The new bit goes in at bit 14. */
const NOISE_TOP_BIT = 14;
/** R4: channel 2's tone, which NF = 3 clocks the noise from. */
const TONE_2_REGISTER = 4;
/** The noise counter is the fourth counter, after tones 0-2. */
const NOISE_COUNTER = 3;
/** Four channels at full volume sum to ±4; the mixer scales that to ±1. */
const CHANNELS = 4;
const NOISE_RATE_FOLLOWS_TONE_2 = 3;
export const NOISE_RATE_NAMES = ['4 MHz ÷ 512', '4 MHz ÷ 1024', '4 MHz ÷ 2048', "channel 2's tone"] as const;

/**
 * The MOS's table at &EB40 (E0 C0 A0 80), indexed by BASIC's SOUND channel:
 * the latch byte bits for chip channels 3, 2, 1, 0. Measured in Stage 44.
 */
const CHIP_CHANNEL_FOR_SOUND = [3, 2, 1, 0] as const;

/** Each attenuation step is 2 dB of amplitude, 10^(-2a/20); &F is off. Made once. */
export const ATTENUATION_GAIN: Float32Array = makeGainTable();

function makeGainTable(): Float32Array {
  const table = new Float32Array(16);
  for (let a = 0; a < SN_ATTENUATION_OFF; a++) table[a] = 10 ** ((-DB_PER_STEP * a) / 20);
  table[SN_ATTENUATION_OFF] = 0;
  return table;
}

/** What the chip feeds its output to, once per chip tick: the resampler, in practice. */
export interface ChipOutput {
  /** The mixed level, -1 to +1, for one 250 kHz tick. */
  input(level: number): void;
}

export class Sn76489 implements Clocked {
  /** R0-R7, by the number a latch byte carries. */
  private readonly regs = new Uint16Array(8);
  private latch = 0;

  /** Ticks to the next flip: tones 0-2, then the noise counter. */
  private readonly counters = new Int32Array(4);
  /** Each counter's flip-flop, 0 or 1. Index 3 is the noise counter's, whose rising edge shifts the register. */
  private readonly flips = new Uint8Array(4);
  /** The 15-bit noise shift register. */
  private shift = NOISE_RESET;
  /** CPU cycles not yet worth a whole chip tick. */
  private cycleRemainder = 0;
  private output: ChipOutput | undefined;

  constructor(private readonly log?: HardwareLog) {}

  /**
   * /WE has fallen: the byte on D0-D7 goes in. A latch byte picks a register
   * and writes its low bits; a data byte writes into the register picked last.
   */
  write(value: number): void {
    const byte = value & 0xff;
    if ((byte & LATCH_BYTE) !== 0) {
      this.latch = (byte >> REGISTER_SHIFT) & REGISTER_MASK;
      const r = this.latch;
      const old = this.regs[r] ?? 0;
      // A tone keeps its high 6 bits; the narrow registers take the nibble (noise only 3 bits of it).
      if (isTone(r)) this.regs[r] = (old & ~LOW_NIBBLE & TONE_MASK) | (byte & LOW_NIBBLE);
      else this.regs[r] = byte & (r === SN_NOISE_REGISTER ? NOISE_MASK : LOW_NIBBLE);
    } else {
      const r = this.latch;
      const old = this.regs[r] ?? 0;
      // The datasheet describes only the tone case. For the narrow registers we follow
      // the common reading: the low bits go in (unconfirmed on TI parts; the MOS never does it).
      if (isTone(r)) this.regs[r] = ((byte & DATA_BITS) << 4) | (old & LOW_NIBBLE);
      else this.regs[r] = byte & (r === SN_NOISE_REGISTER ? NOISE_MASK : LOW_NIBBLE);
    }
    // Writing the noise control restarts the shift register (datasheet, "Noise generator").
    if (this.latch === SN_NOISE_REGISTER) this.shift = NOISE_RESET;
    this.log?.record('sound', this.latch, byte);
  }

  /** Something to feed one mixed level per chip tick, or undefined. The chip runs either way. */
  connectOutput(output: ChipOutput | undefined): void {
    this.output = output;
  }

  /** Moves on by this many 2 MHz CPU cycles: one chip tick for every 8. */
  tick(cpuCycles: number): void {
    this.cycleRemainder += cpuCycles;
    while (this.cycleRemainder >= SN_CPU_CYCLES_PER_TICK) {
      this.cycleRemainder -= SN_CPU_CYCLES_PER_TICK;
      this.clockOnce();
      this.output?.input(this.level);
    }
  }

  /** The mix right now: each channel ±gain(attenuation), summed, ÷ 4. Between -1 and +1. */
  get level(): number {
    let sum = 0;
    for (let c = 0; c < CHANNELS; c++) {
      const gain = ATTENUATION_GAIN[this.regs[(c << 1) | 1] ?? SN_ATTENUATION_OFF] ?? 0;
      sum += this.channelOutput(c) === 1 ? gain : -gain;
    }
    return sum / CHANNELS;
  }

  /** Channel 0-2's square wave, or channel 3's shift register bit 0: 0 or 1. */
  channelOutput(channel: number): number {
    const c = channel & 3;
    return c === NOISE_COUNTER ? this.shift & 1 : (this.flips[c] ?? 0);
  }

  /** The noise shift register, 15 bits. */
  get shiftRegister(): number {
    return this.shift;
  }

  /** One 250 kHz tick: every counter down one, flipping (and maybe shifting) at zero. */
  private clockOnce(): void {
    const counters = this.counters;
    const flips = this.flips;
    for (let c = 0; c < NOISE_COUNTER; c++) {
      const left = (counters[c] ?? 0) - 1;
      if (left > 0) {
        counters[c] = left;
        continue;
      }
      const period = tonePeriod(this.regs[c << 1] ?? 0);
      counters[c] = period;
      // N = 1: held high, not a 125 kHz square wave.
      flips[c] = period === TONE_HELD_HIGH ? 1 : (flips[c] ?? 0) ^ 1;
    }
    const left = counters[NOISE_COUNTER] - 1;
    if (left > 0) {
      counters[NOISE_COUNTER] = left;
      return;
    }
    const noise = this.regs[SN_NOISE_REGISTER];
    const rate = noise & NOISE_RATE_MASK;
    counters[NOISE_COUNTER] =
      rate === NOISE_RATE_FOLLOWS_TONE_2 ? tonePeriod(this.regs[TONE_2_REGISTER]) : NOISE_BASE_PERIOD << rate;
    const edge = flips[NOISE_COUNTER] ^ 1;
    flips[NOISE_COUNTER] = edge;
    if (edge === 1) this.shift = shiftNoise(this.shift, (noise & SN_NOISE_WHITE) !== 0);
  }

  /** R0-R7 by number. */
  register(r: number): number {
    return this.regs[r & REGISTER_MASK] ?? 0;
  }

  /** Channel 0-2's 10-bit divider N. */
  tone(channel: number): number {
    return this.register((channel & 3) << 1);
  }

  /** Channel 0-3's attenuation: 0 loudest, &F off. */
  attenuation(channel: number): number {
    return this.register(((channel & 3) << 1) | 1);
  }

  /** R6: bit 2 white (1) or periodic (0), bits 1-0 the shift rate. */
  get noise(): number {
    return this.register(SN_NOISE_REGISTER);
  }

  /** The register the next data byte goes to, R0-R7. */
  get latched(): number {
    return this.latch;
  }

  /**
   * The chip has no reset pin, so a real one powers up in whatever state it
   * settles to. We choose silence: every attenuation &F, every tone and the
   * noise control 0, R0 latched. BREAK doesn't call this.
   */
  powerOn(): void {
    this.regs.fill(0);
    for (let channel = 0; channel < 4; channel++) this.regs[(channel << 1) | 1] = SN_ATTENUATION_OFF;
    this.latch = 0;
    this.counters.fill(0);
    this.flips.fill(0);
    this.shift = NOISE_RESET;
    this.cycleRemainder = 0;
  }
}

/** Ticks per half-cycle for a tone register value: N, or 1024 for N = 0. */
function tonePeriod(n: number): number {
  const masked = n & TONE_MASK;
  return masked === 0 ? TONE_ZERO_PERIOD : masked;
}

/**
 * One shift of the 15-bit noise register: right by one, with the new bit 14
 * = bit 0 (periodic) or bit 0 XOR bit 1 (white). Taps and width are SMS
 * Power's measurements of the SN76489AN.
 */
export function shiftNoise(register: number, white: boolean): number {
  const feedback = white ? (register ^ (register >> 1)) & 1 : register & 1;
  return ((register >> 1) | (feedback << NOISE_TOP_BIT)) & 0x7fff;
}

/** R0, R2 and R4 are the 10-bit tone registers. */
function isTone(r: number): boolean {
  return (r & 1) === 0 && r !== SN_NOISE_REGISTER;
}

/** A tone channel's frequency in Hz: 4 MHz ÷ (32 × N), with N = 0 counting as 1024. */
export function toneFrequency(n: number): number {
  return SN76489_CLOCK_HZ / (TONE_CLOCKS_PER_N * tonePeriod(n));
}

/** The noise shift register's clock in Hz for NF = 0-2, or undefined for 3 (it follows channel 2). */
export function noiseShiftRate(nf: number): number | undefined {
  const rate = nf & NOISE_RATE_MASK;
  return rate === NOISE_RATE_FOLLOWS_TONE_2 ? undefined : SN76489_CLOCK_HZ / (NOISE_BASE_DIVIDER << rate);
}

/** Which chip channel BASIC's SOUND channel 0-3 drives (the MOS's table at &EB40). */
export function chipChannelForSound(basicChannel: number): number {
  return CHIP_CHANNEL_FOR_SOUND[basicChannel & 3] ?? 0;
}

/** "R4 (channel 2 tone)", "R6 (noise control)". */
export function registerName(r: number): string {
  const reg = r & REGISTER_MASK;
  if (reg === SN_NOISE_REGISTER) return 'R6 (noise control)';
  return `R${String(reg)} (channel ${String(reg >> 1)} ${(reg & 1) === 1 ? 'attenuation' : 'tone'})`;
}

/** "&0 (loudest)", "&5 (-10 dB)", "&F (off)". */
export function describeAttenuation(value: number): string {
  const a = value & LOW_NIBBLE;
  const meaning = a === 0 ? 'loudest' : a === SN_ATTENUATION_OFF ? 'off' : `-${String(a * DB_PER_STEP)} dB`;
  return `&${a.toString(16).toUpperCase()} (${meaning})`;
}

/** "6 (white, 4 MHz ÷ 2048)". */
export function describeNoise(value: number): string {
  const n = value & NOISE_MASK;
  return `${String(n)} (${(n & SN_NOISE_WHITE) !== 0 ? 'white' : 'periodic'}, ${NOISE_RATE_NAMES[n & NOISE_RATE_MASK]})`;
}

/**
 * One byte as the chip reads it. A data byte's meaning depends on the
 * register latched before it, so that's passed in (a latch byte ignores it).
 */
export function describeSoundByte(value: number, latchedBefore: number): string {
  const byte = value & 0xff;
  if ((byte & LATCH_BYTE) !== 0) {
    const r = (byte >> REGISTER_SHIFT) & REGISTER_MASK;
    if (isTone(r)) return `latch ${registerName(r)}, low 4 bits = &${(byte & LOW_NIBBLE).toString(16).toUpperCase()}`;
    if (r === SN_NOISE_REGISTER) return `latch ${registerName(r)} = ${describeNoise(byte)}`;
    return `latch ${registerName(r)} = ${describeAttenuation(byte)}`;
  }
  const r = latchedBefore & REGISTER_MASK;
  if (isTone(r)) return `data for ${registerName(r)}, high 6 bits = &${(byte & DATA_BITS).toString(16).toUpperCase().padStart(2, '0')}`;
  if (r === SN_NOISE_REGISTER) return `data for ${registerName(r)} = ${describeNoise(byte)}`;
  return `data for ${registerName(r)} = ${describeAttenuation(byte)}`;
}
