import { describeHardwareWrite } from '../devices/hardware-log';
import { RESET_VECTOR } from '../cpu/cpu6502';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

// Stage 44: the SN76489 hangs off the System VIA. Its D0-D7 are port A and
// its /WE is IC32 bit 0, so a byte reaches it when the latch bit falls.

/** A machine running JMP &0400 forever. */
function idle(): BbcModelB {
  const m = new BbcModelB();
  [0x4c, 0x00, 0x04].forEach((b, i) => {
    m.poke(0x0400 + i, b);
  });
  m.poke(RESET_VECTOR, 0x00);
  m.poke(RESET_VECTOR + 1, 0x04);
  m.powerOn();
  return m;
}

/** What the MOS does at &EB21, as register writes: DDRA = &FF, the byte to &FE4F, &00 then &08 to &FE40. */
function sendByte(m: BbcModelB, byte: number): void {
  m.map.write(0xfe43, 0xff);
  m.map.write(0xfe4f, byte);
  m.map.write(0xfe40, 0x00);
  m.map.write(0xfe40, 0x08);
}

/** The System VIA's port B as outputs (PB0-PB3 drive IC32), as the MOS sets it up. */
function withLatchOutputs(m: BbcModelB): BbcModelB {
  m.map.write(0xfe42, 0x0f);
  m.map.write(0xfe40, 0x08); // bit 0 := 1: /WE high
  m.map.write(0xfe40, 0x0b); // bit 3 := 1: autoscan on, as when the MOS writes sound
  return m;
}

describe('BbcModelB: the sound chip on the slow data bus', () => {
  it('&D0 &C5 &1D sent the MOS\'s way set chip channel 2 to tone &1D5 at attenuation 0', () => {
    const m = withLatchOutputs(idle());
    sendByte(m, 0xd0);
    sendByte(m, 0xc5);
    sendByte(m, 0x1d);
    expect(m.sound.tone(2)).toBe(0x1d5);
    expect(m.sound.attenuation(2)).toBe(0);
  });

  it('the byte goes in as /WE falls (latch bit 0: 1 → 0), with port A as it is then', () => {
    const m = withLatchOutputs(idle());
    m.map.write(0xfe43, 0xff);
    m.map.write(0xfe4f, 0x90);
    expect(m.sound.attenuation(0)).toBe(15); // nothing yet: /WE is still high
    m.map.write(0xfe40, 0x00);
    expect(m.sound.attenuation(0)).toBe(0);
  });

  it('only a falling edge writes: changing port A while /WE stays low, or raising /WE, sends nothing', () => {
    const m = withLatchOutputs(idle());
    sendByte(m, 0x95);
    m.map.write(0xfe40, 0x00);
    expect(m.sound.attenuation(0)).toBe(5);
    m.map.write(0xfe4f, 0x9a);
    m.map.write(0xfe40, 0x00); // still low: no edge
    expect(m.sound.attenuation(0)).toBe(5);
    m.map.write(0xfe40, 0x08); // rising: no write
    expect(m.sound.attenuation(0)).toBe(5);
  });

  it('other latch bits don\'t strobe the chip: &03 (keyboard enable off) leaves it alone', () => {
    const m = withLatchOutputs(idle());
    m.map.write(0xfe43, 0xff);
    m.map.write(0xfe4f, 0x90);
    m.map.write(0xfe40, 0x03);
    m.map.write(0xfe40, 0x0b);
    expect(m.sound.attenuation(0)).toBe(15);
  });

  it('with autoscan on, latch bytes keep bit 7 even while a key is held (the keyboard lets go of PA7)', () => {
    const m = withLatchOutputs(idle());
    m.keyboard.press(0x41);
    m.keyboard.links = 0x00;
    sendByte(m, 0xdf);
    expect(m.sound.latched).toBe(5);
    expect(m.sound.attenuation(2)).toBe(15);
  });

  it('the chip sees the pins, not ORA: a line pulled low outside reaches it low', () => {
    const m = withLatchOutputs(idle());
    m.systemVia.setOutside('a', 0xfe); // PA0 held low
    sendByte(m, 0x95);
    expect(m.sound.attenuation(0)).toBe(4);
  });

  it('power-on silences the chip (our choice: it has no reset pin); BREAK leaves it alone', () => {
    const m = withLatchOutputs(idle());
    sendByte(m, 0x90);
    m.reset();
    expect(m.sound.attenuation(0)).toBe(0);
    m.setBreak(true);
    m.setBreak(false);
    expect(m.sound.attenuation(0)).toBe(0);
    m.powerOn();
    expect(m.sound.attenuation(0)).toBe(15);
  });

  it('each byte is in the hardware log, decoded', () => {
    const m = withLatchOutputs(idle());
    m.hardwareLog.clear();
    sendByte(m, 0xc5);
    const sound = m.hardwareLog.recent().filter((w) => w.device === 'sound');
    expect(sound.map(describeHardwareWrite)).toEqual(['sound &C5: latch R4 (channel 2 tone), low 4 bits = &5']);
  });
});

describe('BbcModelB: the sound chip with MOS 1.20', () => {
  function booted(frames: number): BbcModelB {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    m.powerOn();
    for (let i = 0; i < frames; i++) m.runFrame();
    return m;
  }

  const soundBytes = (m: BbcModelB): number[] => m.hardwareLog.recent().filter((w) => w.device === 'sound').map((w) => w.value);

  withRoms('roms/os12.rom')('at power-on the MOS silences all four channels and sets tones, then bleeps on chip channel 0', () => {
    const m = booted(100);
    expect(soundBytes(m).slice(0, 15)).toEqual([0x9f, 0x82, 0x3f, 0xbf, 0xa1, 0x3f, 0xdf, 0xc0, 0x3f, 0xff, 0xe0, 0x92, 0x8f, 0x0e, 0x9f]);
    expect([0, 1, 2, 3].map((c) => m.sound.attenuation(c))).toEqual([15, 15, 15, 15]);
    expect(m.sound.tone(0)).toBe(0x0ef);
  });

  withRoms('roms/os12.rom', 'roms/basic2.rom')('SOUND 1,-15,53,20 plays chip channel 2: tone &1D5, attenuation 0, then silence after 20 twentieths of a second', () => {
    const m = booted(100);
    m.hardwareLog.clear();
    typeText(m, 'SOUND 1,-15,53,20\r');
    for (let i = 0; i < 5; i++) m.runFrame();
    expect(soundBytes(m)).toEqual([0xd0, 0xc5, 0x1d]);
    expect(m.sound.tone(2)).toBe(0x1d5);
    expect(m.sound.attenuation(2)).toBe(0);
    for (let i = 0; i < 55; i++) m.runFrame(); // 1.1 s more
    expect(m.sound.attenuation(2)).toBe(15);
  });

  withRoms('roms/os12.rom', 'roms/basic2.rom')('SOUND 0,-15,6,5 is noise on chip channel 3: &F0 then &E6 (white, ÷ 2048)', () => {
    const m = booted(100);
    m.hardwareLog.clear();
    typeText(m, 'SOUND 0,-15,6,5\r');
    for (let i = 0; i < 5; i++) m.runFrame();
    expect(soundBytes(m)).toEqual([0xf0, 0xe6]);
    expect(m.sound.noise).toBe(6);
  });
});
