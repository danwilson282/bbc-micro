import { SOUND_BYTES_SHOWN, buildSoundView, formatHz, type SoundViewInput } from './sound-view-model';

/** The registers after the MOS's power-on sequence and the start-up bleep: all off, tones &0EF, &3F1, &3F0. */
const AFTER_BOOT = [0x0ef, 15, 0x3f1, 15, 0x3f0, 15, 0, 15];

function view(registers: readonly number[], latched = 0, recent: SoundViewInput['recent'] = []): ReturnType<typeof buildSoundView> {
  return buildSoundView({ registers, latched, recent });
}

describe('Sound panel view-model', () => {
  it('after boot every channel is off and the summary says so', () => {
    const v = view(AFTER_BOOT);
    expect(v.summary).toBe('Silent: all four attenuations are &F.');
    expect(v.channels.map((c) => c.silent)).toEqual([true, true, true, true]);
    expect(v.channels.map((c) => c.level)).toEqual([0, 0, 0, 0]);
  });

  it('after SOUND 1,-15,53,20 chip channel 2 (driven by SOUND 1) shows tone &1D5 (469), 266.5 Hz, attenuation &0, full level', () => {
    const regs = [...AFTER_BOOT];
    regs[4] = 0x1d5;
    regs[5] = 0;
    const v = view(regs, 4);
    expect(v.channels.at(2)).toEqual({
      chip: '2',
      basic: '1',
      tone: '&1D5 (469)',
      pitch: '266.5 Hz',
      attenuation: '&0 (loudest)',
      level: 15,
      silent: false,
    });
    expect(v.summary).toBe('Playing: chip channel 2 (SOUND 1) 266.5 Hz.');
    expect(v.latched).toBe('Latched: R4 (channel 2 tone). A data byte (bit 7 = 0) goes there next.');
  });

  it('labels each chip channel with the BASIC channel that drives it: chip 0-3 ← SOUND 3, 2, 1, 0', () => {
    expect(view(AFTER_BOOT).channels.map((c) => `${c.chip}←${c.basic}`)).toEqual(['0←3', '1←2', '2←1', '3←0']);
  });

  it('the noise row decodes the control: 6 is white noise shifted at 4 MHz ÷ 2048 = 1,953.1 Hz', () => {
    const regs = [...AFTER_BOOT];
    regs[6] = 6;
    regs[7] = 0;
    const noise = view(regs).channels.at(3);
    expect(noise?.tone).toBe('6: white, 4 MHz ÷ 2048');
    expect(noise?.pitch).toBe('1,953.1 Hz');
    expect(view(regs).summary).toBe('Playing: chip channel 3 (SOUND 0) noise.');
  });

  it("noise rate 3 follows chip channel 2's tone, and says what that is now", () => {
    const regs = [...AFTER_BOOT];
    regs[4] = 0x1d5;
    regs[6] = 3;
    const noise = view(regs).channels.at(3);
    expect(noise?.tone).toBe("3: periodic, channel 2's tone");
    expect(noise?.pitch).toBe('follows channel 2 (266.5 Hz)');
  });

  it('attenuation is in 2 dB steps, and the level bar is 15 minus it', () => {
    const regs = [...AFTER_BOOT];
    regs[1] = 5;
    const c = view(regs).channels.at(0);
    expect(c?.attenuation).toBe('&5 (-10 dB)');
    expect(c?.level).toBe(10);
  });

  it('a tone of N = 0 counts as 1024 on TI parts: 122.1 Hz', () => {
    expect(view([0, 0, 0, 0, 0, 0, 0, 0]).channels.at(0)?.pitch).toBe('122.1 Hz (N = 0 counts as 1024)');
  });

  it(`lists the last ${String(SOUND_BYTES_SHOWN)} bytes, decoded, using the register each reached`, () => {
    const recent = [0x9f, 0x82, 0x3f, 0xbf, 0xa1, 0x3f, 0xdf, 0xc0, 0x3f, 0xd0, 0xc5, 0x1d].map((value) => ({
      value,
      register: value >= 0x80 ? (value >> 4) & 7 : -1,
    }));
    // Data bytes go to the register latched before them.
    recent.forEach((b, i) => {
      if (b.register === -1) b.register = recent[i - 1]?.register ?? 0;
    });
    const v = view(AFTER_BOOT, 4, recent);
    expect(v.bytes).toHaveLength(SOUND_BYTES_SHOWN);
    expect(v.bytes.slice(-3)).toEqual([
      { byte: '&D0', meaning: 'latch R5 (channel 2 attenuation) = &0 (loudest)' },
      { byte: '&C5', meaning: 'latch R4 (channel 2 tone), low 4 bits = &5' },
      { byte: '&1D', meaning: 'data for R4 (channel 2 tone), high 6 bits = &1D' },
    ]);
  });

  it('formats frequencies with one decimal place and thousands separators', () => {
    expect([266.52, 7812.5, 1953.125].map(formatHz)).toEqual(['266.5 Hz', '7,812.5 Hz', '1,953.1 Hz']);
  });
});
