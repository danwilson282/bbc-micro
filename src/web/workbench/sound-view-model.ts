// The Sound panel's view-model (Stage 44): the SN76489's eight registers as
// four channel rows, and the last bytes the chip took in.
//
//   Chip  SOUND  Tone / noise           Pitch      Attenuation   Level
//   0     3      &0EF (239)             523.0 Hz   &F (off)      ...............
//   2     1      &1D5 (469)             266.5 Hz   &0 (loudest)  ███████████████
//   3     0      6: white, 4 MHz ÷ 2048 1,953.1 Hz &0 (loudest)  ███████████████
//
// No DOM here: sound-panel.ts builds elements, Jest tests this.

import {
  NOISE_RATE_NAMES,
  SN_ATTENUATION_OFF,
  SN_NOISE_REGISTER,
  SN_NOISE_WHITE,
  chipChannelForSound,
  describeAttenuation,
  describeSoundByte,
  noiseShiftRate,
  registerName,
  toneFrequency,
} from '../../devices/sn76489';
import { hex8 } from '../../util/bits';

export interface SoundByte {
  /** The SN76489 register the byte reached (HardwareWrite.register). */
  readonly register: number;
  readonly value: number;
}

export interface SoundViewInput {
  /** R0-R7. */
  readonly registers: readonly number[];
  readonly latched: number;
  /** The chip's last bytes, oldest first. */
  readonly recent: readonly SoundByte[];
}

export interface SoundChannelRow {
  /** "2". */
  readonly chip: string;
  /** "1": the BASIC SOUND channel that drives it (the MOS's table at &EB40). */
  readonly basic: string;
  /** "&1D5 (469)", or the noise control: "6: white, 4 MHz ÷ 2048". */
  readonly tone: string;
  /** "266.5 Hz", or for noise the shift register's clock. */
  readonly pitch: string;
  /** "&0 (loudest)". */
  readonly attenuation: string;
  /** 15 - attenuation: 15 loudest, 0 off. */
  readonly level: number;
  readonly silent: boolean;
}

export interface SoundByteRow {
  /** "&C5". */
  readonly byte: string;
  /** "latch R4 (channel 2 tone), low 4 bits = &5". */
  readonly meaning: string;
}

export interface SoundView {
  readonly summary: string;
  readonly channels: readonly SoundChannelRow[];
  /** "Latched: R4 (channel 2 tone). A data byte (bit 7 = 0) goes there next." */
  readonly latched: string;
  readonly bytes: readonly SoundByteRow[];
}

/** How many of the chip's recent bytes the panel lists. */
export const SOUND_BYTES_SHOWN = 8;

/** Which BASIC channel drives each chip channel: the inverse of the MOS's table. */
const BASIC_FOR_CHIP = [0, 1, 2, 3].map((basic) => ({ basic, chip: chipChannelForSound(basic) }));

function basicFor(chip: number): number {
  return BASIC_FOR_CHIP.find((m) => m.chip === chip)?.basic ?? 0;
}

/** "266.5 Hz", "1,953.1 Hz", "7,812.5 Hz": one decimal place. */
export function formatHz(hz: number): string {
  return `${hz.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Hz`;
}

function toneRow(chip: number, n: number, attenuation: number): SoundChannelRow {
  return {
    chip: String(chip),
    basic: String(basicFor(chip)),
    tone: `&${n.toString(16).toUpperCase().padStart(3, '0')} (${String(n)})`,
    // N = 0: what the chip does with it is Stage 45's question.
    pitch: n === 0 ? '— (N = 0)' : formatHz(toneFrequency(n)),
    attenuation: describeAttenuation(attenuation),
    level: SN_ATTENUATION_OFF - attenuation,
    silent: attenuation === SN_ATTENUATION_OFF,
  };
}

function noiseRow(noise: number, tone2: number, attenuation: number): SoundChannelRow {
  const rate = noise & 3;
  const shift = noiseShiftRate(rate);
  return {
    chip: '3',
    basic: String(basicFor(3)),
    tone: `${String(noise)}: ${(noise & SN_NOISE_WHITE) !== 0 ? 'white' : 'periodic'}, ${NOISE_RATE_NAMES[rate] ?? '?'}`,
    pitch: shift === undefined ? `follows channel 2 (${tone2 === 0 ? 'N = 0' : formatHz(toneFrequency(tone2))})` : formatHz(shift),
    attenuation: describeAttenuation(attenuation),
    level: SN_ATTENUATION_OFF - attenuation,
    silent: attenuation === SN_ATTENUATION_OFF,
  };
}

export function buildSoundView(input: SoundViewInput): SoundView {
  const reg = (r: number): number => input.registers[r] ?? 0;
  const channels = [0, 1, 2].map((c) => toneRow(c, reg(c << 1), reg((c << 1) | 1)));
  channels.push(noiseRow(reg(SN_NOISE_REGISTER), reg(4), reg(7)));

  const playing = channels.filter((c) => !c.silent);
  const summary =
    playing.length === 0
      ? 'Silent: all four attenuations are &F.'
      : `Playing: ${playing.map((c) => `chip channel ${c.chip} (SOUND ${c.basic}) ${c.chip === '3' ? 'noise' : c.pitch}`).join(', ')}.`;

  // Each byte's meaning needs the register latched before it: for a data byte that's
  // the register it reached, which is what the log records.
  const bytes = input.recent.slice(-SOUND_BYTES_SHOWN).map((b) => ({ byte: `&${hex8(b.value)}`, meaning: describeSoundByte(b.value, b.register) }));

  return {
    summary,
    channels,
    latched: `Latched: ${registerName(input.latched)}. A data byte (bit 7 = 0) goes there next.`,
    bytes,
  };
}
