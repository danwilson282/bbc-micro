// The Texas Instruments SN76489 sound generator: its register file and the
// byte protocol that fills it (Stage 44). No sound yet: Stage 45 turns these
// numbers into waveforms.
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

import type { HardwareLog } from './hardware-log';

/** The Model B's sound clock: the 16 MHz crystal ÷ 4 (Advanced User Guide, "The sound generator"). */
export const SN76489_CLOCK_HZ = 4_000_000;

/** A tone channel's square wave: one full period is 32 × N clocks (datasheet, "Tone generators"). */
const TONE_CLOCKS_PER_N = 32;

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
const NOISE_RATE_FOLLOWS_TONE_2 = 3;
export const NOISE_RATE_NAMES = ['4 MHz ÷ 512', '4 MHz ÷ 1024', '4 MHz ÷ 2048', "channel 2's tone"] as const;

/**
 * The MOS's table at &EB40 (E0 C0 A0 80), indexed by BASIC's SOUND channel:
 * the latch byte bits for chip channels 3, 2, 1, 0. Measured in Stage 44.
 */
const CHIP_CHANNEL_FOR_SOUND = [3, 2, 1, 0] as const;

export class Sn76489 {
  /** R0-R7, by the number a latch byte carries. */
  private readonly regs = new Uint16Array(8);
  private latch = 0;

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
    this.log?.record('sound', this.latch, byte);
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
  }
}

/** R0, R2 and R4 are the 10-bit tone registers. */
function isTone(r: number): boolean {
  return (r & 1) === 0 && r !== SN_NOISE_REGISTER;
}

/** A tone channel's frequency in Hz: 4 MHz ÷ (32 × N). N = 0 gives Infinity (Stage 45 decides what the chip does). */
export function toneFrequency(n: number): number {
  return SN76489_CLOCK_HZ / (TONE_CLOCKS_PER_N * (n & TONE_MASK));
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
