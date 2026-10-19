// Stage 36 with the real ROMs: what the MOS does with SHIFT, CTRL, the lock
// keys and BREAK. None of it is emulation code beyond Stages 34-35 and the
// BREAK switch: these tests prove the switches are wired so the MOS's own
// code behaves as on a real BBC.

import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7StartAddress, mode7Text } from '../video/mode7-text';
import { BbcModelB } from './bbc-model-b';
import { tapKeys, typeText } from './type-text';

const SHIFT = 0x00;
const CTRL = 0x01;
const CAPS_LOCK = 0x40;
const SHIFT_LOCK = 0x50;
const KEY_A = 0x41;

/** MOS variables (Advanced User Guide, OSBYTE &CA and &FD). */
const KEYBOARD_STATUS = 0x025a;
const LAST_BREAK_TYPE = 0x028d;
/** BASIC's PAGE on a Model B with no DFS: the program starts here. */
const PAGE = 0x0e00;

const BOTH_ROMS = ['roms/os12.rom', 'roms/basic2.rom'] as const;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

/** Powered on and run to the > prompt. */
function booted(): BbcModelB {
  const m = new BbcModelB();
  loadStandardRoms(m.map, ['mos', 'basic']);
  m.powerOn();
  run(m, 50);
  return m;
}

/** The MODE 7 screen's rows, trailing spaces trimmed. */
function screen(m: BbcModelB): string[] {
  return mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13))).map((row) => row.trimEnd());
}

/**
 * BASIC's PRINT GET, then `keys` held together: the code the MOS made of
 * them, as BASIC printed it. With capsOff, CAPS LOCK is turned off just for
 * the key (typeText needs it on to type PRINT GET in capitals).
 */
function codeFor(m: BbcModelB, keys: readonly number[], capsOff = false): number {
  typeText(m, 'PRINT GET\r');
  if (capsOff) tapKeys(m, [CAPS_LOCK]);
  tapKeys(m, keys);
  if (capsOff) tapKeys(m, [CAPS_LOCK]);
  run(m, 5);
  const rows = screen(m).filter((row) => row !== '');
  // The last row is the new >, the one before it is GET's number.
  return Number(rows[rows.length - 2]);
}

/** Hold BREAK for `frames` frames, let go, and let the MOS and BASIC start again. */
function pressBreak(m: BbcModelB, frames = 2): void {
  m.setBreak(true);
  run(m, frames);
  m.setBreak(false);
  run(m, 50);
}

describe('the lock LEDs, as MOS 1.20 drives them', () => {
  withRoms(...BOTH_ROMS)('at the > prompt: CAPS LOCK LED on, SHIFT LOCK LED off, and &025A = &20', () => {
    const m = booted();
    expect([m.capsLockLed, m.shiftLockLed]).toEqual([true, false]);
    expect(m.peek(KEYBOARD_STATUS)).toBe(0x20);
  });

  withRoms(...BOTH_ROMS)('at power-on, after clearing RAM, the MOS lights both LEDs (keyLeds with &025A still &00), then puts SHIFT LOCK out once &025A is &20', () => {
    const m = new BbcModelB();
    loadStandardRoms(m.map, ['mos', 'basic']);
    m.hardwareLog.clear();
    m.powerOn();
    run(m, 50);
    // [bit, LED lit] for every write to latch bits 6 and 7.
    const leds = m.hardwareLog
      .recent()
      .filter((w) => w.device === 'latch' && (w.register === 6 || w.register === 7))
      .map((w) => [w.register, w.value === 0]);
    expect(leds.slice(0, 6)).toEqual([
      [7, false], // PB0-PB3 floating high at power-on
      [6, false], // &DA08: the loop that writes &0E down to &08
      [6, true], [7, true], // &DA22: keyLeds, &025A = &00: both lit
      [6, true], [7, false], // keyLeds again, &025A = &20 now
    ]);
    expect(leds[leds.length - 1]).toEqual([7, false]);
  });

  withRoms(...BOTH_ROMS)('CAPS LOCK flips the CAPS LOCK LED (and &025A bit 4) each time it is pressed', () => {
    const m = booted();
    tapKeys(m, [CAPS_LOCK]);
    expect([m.capsLockLed, m.peek(KEYBOARD_STATUS)]).toEqual([false, 0x30]);
    tapKeys(m, [CAPS_LOCK]);
    expect([m.capsLockLed, m.peek(KEYBOARD_STATUS)]).toEqual([true, 0x20]);
  });

  withRoms(...BOTH_ROMS)('SHIFT LOCK lights its LED and puts CAPS LOCK out: &025A = &10', () => {
    const m = booted();
    tapKeys(m, [SHIFT_LOCK]);
    expect([m.capsLockLed, m.shiftLockLed, m.peek(KEYBOARD_STATUS)]).toEqual([false, true, 0x10]);
    tapKeys(m, [SHIFT_LOCK]);
    expect([m.capsLockLed, m.shiftLockLed]).toEqual([false, false]);
  });
});

describe('SHIFT, CTRL and CAPS LOCK change the code a key makes (PRINT GET)', () => {
  withRoms(...BOTH_ROMS)('with CAPS LOCK on: A is 65, SHIFT+A is still 65, CTRL+A is 1, CTRL+SHIFT+A is 1', () => {
    const m = booted();
    expect(codeFor(m, [KEY_A])).toBe(65);
    expect(codeFor(m, [SHIFT, KEY_A])).toBe(65);
    expect(codeFor(m, [CTRL, KEY_A])).toBe(1);
    expect(codeFor(m, [CTRL, SHIFT, KEY_A])).toBe(1);
  });

  withRoms(...BOTH_ROMS)('with CAPS LOCK off: A is 97 (a), and SHIFT+A is 65 (A)', () => {
    const m = booted();
    expect(codeFor(m, [KEY_A], true)).toBe(97);
    expect(codeFor(m, [SHIFT, KEY_A], true)).toBe(65);
  });

  withRoms(...BOTH_ROMS)('SHIFT+CAPS LOCK is a third mode (&025A bit 7): CAPS LOCK LED on, and SHIFT now gives lower case', () => {
    const m = booted();
    tapKeys(m, [SHIFT, CAPS_LOCK]);
    expect([m.capsLockLed, m.peek(KEYBOARD_STATUS)]).toEqual([true, 0xa0]);
    expect(codeFor(m, [KEY_A])).toBe(65);
    expect(codeFor(m, [SHIFT, KEY_A])).toBe(97);
  });

  withRoms(...BOTH_ROMS)('SHIFT on a symbol key picks its top legend: SHIFT+2 is 34 (")', () => {
    const m = booted();
    expect(codeFor(m, [SHIFT, 0x31])).toBe(34);
  });
});

describe('BREAK and CTRL+BREAK', () => {
  withRoms(...BOTH_ROMS)('BREAK (soft) keeps a BASIC program: LIST shows nothing, but OLD brings it back', () => {
    const m = booted();
    typeText(m, '10PRINT "HI"\r');
    expect(m.peek(PAGE + 1)).toBe(0x00); // line 10's number, high byte
    pressBreak(m);
    expect(m.peek(LAST_BREAK_TYPE)).toBe(0); // soft
    expect(screen(m).slice(1, 4)).toEqual(['BBC Computer', '', 'BASIC']); // no "32K" on a soft BREAK
    expect(m.peek(PAGE + 1)).toBe(0xff); // BASIC's NEW: the only byte it changes
    expect(m.peek(PAGE + 4)).toBe(0xf1); // the PRINT token is still there
    typeText(m, 'LIST\rOLD\rLIST\r');
    run(m, 5);
    const rows = screen(m).filter((row) => row !== '');
    expect(rows.slice(-5)).toEqual(['>LIST', '>OLD', '>LIST', '   10PRINT "HI"', '>']);
  });

  withRoms(...BOTH_ROMS)('CTRL+BREAK is a hard reset: &028D = 2, the "32K" banner, and TIME starts again from 0', () => {
    const m = booted();
    run(m, 200); // TIME is past 400 (centiseconds) now
    m.keyboard.press(CTRL);
    pressBreak(m);
    m.keyboard.release(CTRL);
    expect(m.peek(LAST_BREAK_TYPE)).toBe(2);
    expect(screen(m)[1]).toBe('BBC Computer 32K');
    typeText(m, 'PRINT TIME\r');
    run(m, 5);
    const rows = screen(m).filter((row) => row !== '');
    expect(Number(rows[rows.length - 2])).toBeLessThan(300); // about 50 frames of boot and the typing
  });

  withRoms(...BOTH_ROMS)('but a soft BREAK leaves TIME counting (&0292-&029B are only zeroed by a hard reset)', () => {
    const m = booted();
    run(m, 200);
    pressBreak(m);
    typeText(m, 'PRINT TIME\r');
    run(m, 5);
    const rows = screen(m).filter((row) => row !== '');
    expect(Number(rows[rows.length - 2])).toBeGreaterThan(500);
  });

  withRoms(...BOTH_ROMS)('even CTRL+BREAK doesn\'t clear RAM: only power-on does, so OLD still works', () => {
    const m = booted();
    typeText(m, '10PRINT "HI"\r');
    m.keyboard.press(CTRL);
    pressBreak(m);
    m.keyboard.release(CTRL);
    typeText(m, 'OLD\rLIST\r');
    run(m, 5);
    expect(screen(m)).toContain('   10PRINT "HI"');
  });

  withRoms(...BOTH_ROMS)('the order you let go in matters: CTRL up before BREAK is a soft BREAK, because the MOS reads CTRL after BREAK comes up', () => {
    const m = booted();
    m.keyboard.press(CTRL);
    m.setBreak(true);
    run(m, 2);
    m.keyboard.release(CTRL);
    run(m, 2);
    m.setBreak(false);
    run(m, 50);
    expect(m.peek(LAST_BREAK_TYPE)).toBe(0);
  });

  withRoms(...BOTH_ROMS)('while BREAK is held the MOS doesn\'t run: the screen and PC stay as they were', () => {
    const m = booted();
    m.setBreak(true);
    const pc = m.registers.pc;
    const before = screen(m);
    run(m, 25);
    expect(m.registers.pc).toBe(pc);
    expect(screen(m)).toEqual(before);
  });
});
