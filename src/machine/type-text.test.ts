import { RESET_VECTOR } from '../cpu/cpu6502';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7StartAddress, mode7Text } from '../video/mode7-text';
import { BbcModelB } from './bbc-model-b';
import { DEFAULT_TYPING, keysFor, typeText } from './type-text';

describe('keysFor: which BBC switches type a character', () => {
  it('a capital letter or digit is its own key: A is &41, P is &37, 2 is &31', () => {
    expect(keysFor('A')).toEqual([0x41]);
    expect(keysFor('P')).toEqual([0x37]);
    expect(keysFor('2')).toEqual([0x31]);
  });

  it('a shifted symbol is SHIFT (&00) plus the key it is printed on: + is SHIFT and ; (&57), " is SHIFT and 2 (&31)', () => {
    expect(keysFor('+')).toEqual([0x00, 0x57]);
    expect(keysFor('"')).toEqual([0x00, 0x31]);
    expect(keysFor('*')).toEqual([0x00, 0x48]);
  });

  it('unshifted symbols on the BBC keytops need no SHIFT: ; is &57, : is &48, @ is &47', () => {
    expect(keysFor(';')).toEqual([0x57]);
    expect(keysFor(':')).toEqual([0x48]);
    expect(keysFor('@')).toEqual([0x47]);
  });

  it('space is SPACE (&62); a carriage return or newline is RETURN (&49)', () => {
    expect(keysFor(' ')).toEqual([0x62]);
    expect(keysFor('\r')).toEqual([0x49]);
    expect(keysFor('\n')).toEqual([0x49]);
  });

  it('lowercase and characters with no BBC key give undefined (the CAPS LOCK state would decide lowercase)', () => {
    expect(keysFor('a')).toBeUndefined();
    expect(keysFor('€')).toBeUndefined();
    expect(keysFor('AB')).toBeUndefined();
  });
});

describe('typeText', () => {
  it('refuses text with an untypable character before pressing anything', () => {
    const m = new BbcModelB();
    expect(() => {
      typeText(m, 'PRINT x');
    }).toThrow(RangeError);
    expect(m.cycles).toBe(0);
  });

  it('holds each key for holdFrames, then lets go for gapFrames: 2 characters = 2 × (2 + 2) frames by default', () => {
    const m = new BbcModelB();
    // No ROMs: JMP &0400 forever, from the reset vector. Only the keys and the time matter here.
    [0x4c, 0x00, 0x04].forEach((b, i) => {
      m.poke(0x0400 + i, b);
    });
    m.poke(RESET_VECTOR, 0x00);
    m.poke(RESET_VECTOR + 1, 0x04);
    m.powerOn();
    const before = m.cycles;
    const seen: number[][] = [];
    typeText(m, 'A"', {
      ...DEFAULT_TYPING,
      onFrame: () => {
        seen.push([m.keyboard.isDown(0x00) ? 1 : 0, m.keyboard.isDown(0x41) ? 1 : 0, m.keyboard.isDown(0x31) ? 1 : 0]);
      },
    });
    expect(seen).toEqual([
      [0, 1, 0], [0, 1, 0], [0, 0, 0], [0, 0, 0],
      [1, 0, 1], [1, 0, 1], [0, 0, 0], [0, 0, 0],
    ]);
    expect(m.cycles - before).toBeGreaterThanOrEqual(8 * 40_000);
  });
});

describe('typeText with MOS 1.20 and BASIC II', () => {
  withRoms('roms/os12.rom', 'roms/basic2.rom')('types PRINT 2+2 and RETURN at the > prompt, and BASIC prints 4 on the next line', () => {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    m.powerOn();
    for (let i = 0; i < 50; i++) m.runFrame();
    typeText(m, 'PRINT 2+2\r');
    for (let i = 0; i < 10; i++) m.runFrame();
    const rows = mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13)));
    expect(rows[5]?.trimEnd()).toBe('>PRINT 2+2');
    expect(rows[6]?.trim()).toBe('4');
    expect(rows[7]?.trimEnd()).toBe('>');
  });

  withRoms('roms/os12.rom', 'roms/basic2.rom')('after the keys are let go the MOS turns the CA2 interrupt back on: IER &F3, autoscan on', () => {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    m.powerOn();
    for (let i = 0; i < 50; i++) m.runFrame();
    typeText(m, 'P');
    expect(m.peek(0xfe4e)).toBe(0xf3);
    expect(m.keyboard.scanning).toBe(true);
    expect(m.keyboard.ca2Rises).toBeGreaterThan(0);
  });
});
