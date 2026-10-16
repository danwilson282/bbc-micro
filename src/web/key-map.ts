// PC keyboard → BBC key matrix (Stage 34).
//
// We map by PLACE, using KeyboardEvent.code ("which physical key"), not
// KeyboardEvent.key ("which character"). A BBC keyboard is a set of
// switches, and the BBC itself decides what a switch means, with SHIFT,
// CTRL and CAPS LOCK (also switches). So a PC key closes the BBC switch in
// the same place, and the punctuation follows the BBC's keytops:
//
//   PC   ... P  [  ]          BBC  ... P  @  [  _
//   PC   ... L  ;  '  #       BBC  ... L  ;  :  ]
//
// so PC SHIFT + ' is BBC SHIFT + :, which is *. Places are from a UK PC
// keyboard (where "Backslash" is the #~ key beside Enter).
//
// BREAK isn't in the matrix (Stage 36): it's a switch on the 6502's /RES.
// F12 and Pause (the PC's "Pause/Break" key) work it, through a separate
// BreakSwitch, which the machine provides.
//
// No DOM in here: it only ever sees code strings, so Jest can test it.
// The panel and main.ts do the event listening.

import type { KeyboardSwitches } from '../devices/keyboard';

/** PC key (KeyboardEvent.code), the BBC key number it closes, and a short PC name for the panel. */
const MAPPING: readonly (readonly [code: string, key: number, pcName: string])[] = [
  // The function keys, by the number printed on them. The BBC's f0 is left of f1.
  ['F10', 0x20, 'F10'], ['F1', 0x71, 'F1'], ['F2', 0x72, 'F2'], ['F3', 0x73, 'F3'], ['F4', 0x14, 'F4'],
  ['F5', 0x74, 'F5'], ['F6', 0x75, 'F6'], ['F7', 0x16, 'F7'], ['F8', 0x76, 'F8'], ['F9', 0x77, 'F9'],
  // Number row
  ['Escape', 0x70, 'Esc'], ['Digit1', 0x30, '1'], ['Digit2', 0x31, '2'], ['Digit3', 0x11, '3'], ['Digit4', 0x12, '4'],
  ['Digit5', 0x13, '5'], ['Digit6', 0x34, '6'], ['Digit7', 0x24, '7'], ['Digit8', 0x15, '8'], ['Digit9', 0x26, '9'],
  ['Digit0', 0x27, '0'], ['Minus', 0x17, '-'], ['Equal', 0x18, '='],
  // Q row
  ['Tab', 0x60, 'Tab'], ['KeyQ', 0x10, 'Q'], ['KeyW', 0x21, 'W'], ['KeyE', 0x22, 'E'], ['KeyR', 0x33, 'R'],
  ['KeyT', 0x23, 'T'], ['KeyY', 0x44, 'Y'], ['KeyU', 0x35, 'U'], ['KeyI', 0x25, 'I'], ['KeyO', 0x36, 'O'],
  ['KeyP', 0x37, 'P'], ['BracketLeft', 0x47, '['], ['BracketRight', 0x38, ']'],
  // A row
  ['CapsLock', 0x40, 'Caps'], ['KeyA', 0x41, 'A'], ['KeyS', 0x51, 'S'], ['KeyD', 0x32, 'D'], ['KeyF', 0x43, 'F'],
  ['KeyG', 0x53, 'G'], ['KeyH', 0x54, 'H'], ['KeyJ', 0x45, 'J'], ['KeyK', 0x46, 'K'], ['KeyL', 0x56, 'L'],
  ['Semicolon', 0x57, ';'], ['Quote', 0x48, "'"], ['Backslash', 0x58, '#'], ['Enter', 0x49, 'Enter'],
  ['NumpadEnter', 0x49, 'Enter'],
  // Z row
  ['ShiftLeft', 0x00, 'Shift'], ['ShiftRight', 0x00, 'Shift'], ['IntlBackslash', 0x78, '\\'],
  ['KeyZ', 0x61, 'Z'], ['KeyX', 0x42, 'X'], ['KeyC', 0x52, 'C'], ['KeyV', 0x63, 'V'], ['KeyB', 0x64, 'B'],
  ['KeyN', 0x55, 'N'], ['KeyM', 0x65, 'M'], ['Comma', 0x66, ','], ['Period', 0x67, '.'], ['Slash', 0x68, '/'],
  // The rest
  ['ControlLeft', 0x01, 'Ctrl'], ['ControlRight', 0x01, 'Ctrl'], ['Space', 0x62, 'Space'],
  ['Backquote', 0x28, '`'], ['Backspace', 0x59, 'Backspace'], ['Delete', 0x59, 'Delete'], ['End', 0x69, 'End'],
  ['ArrowLeft', 0x19, '←'], ['ArrowRight', 0x79, '→'], ['ArrowUp', 0x39, '↑'], ['ArrowDown', 0x29, '↓'],
];

/** KeyboardEvent.code → BBC internal key number. */
export const PC_KEY_MAP: ReadonlyMap<string, number> = new Map(MAPPING.map(([code, key]) => [code, key]));

/** The PC keys that work BREAK. F12 is the usual one; Pause is labelled "Pause/Break", but few laptops have it. */
export const BREAK_PC_CODES: ReadonlySet<string> = new Set(['F12', 'Pause']);

/** Does this PC key mean something to the BBC: a matrix key or BREAK? */
export function isBbcKeyCode(code: string): boolean {
  return PC_KEY_MAP.has(code) || BREAK_PC_CODES.has(code);
}

/** The BREAK key's switch: down holds the CPU in reset, up lets it go (BbcModelB.setBreak). */
export interface BreakSwitch {
  setBreak(down: boolean): void;
}

/** What `held` stores for a PC key that's holding BREAK: not a matrix position (those are &00-&7F). */
const BREAK_HELD = 0x100;

/** The PC keys that close a BBC key, as a person would name them (both Shifts are "Shift" once). */
export function pcKeysFor(key: number): readonly string[] {
  const names = MAPPING.filter(([, k]) => k === key).map(([, , pcName]) => pcName);
  return [...new Set(names)];
}

/**
 * Turns PC key-downs and key-ups into BBC presses and releases. It counts:
 * a BBC key is down while ANY PC key mapped to it is held (both Shifts are
 * one BBC SHIFT; F12 and Pause are one BREAK). It only lets go of what it
 * pressed, so a key clicked down in the panel stays down.
 */
export class PcKeyTracker {
  private readonly keyboard: KeyboardSwitches;
  private readonly breakSwitch: BreakSwitch | undefined;
  /** PC codes held now, each with the BBC key it pressed (or BREAK_HELD). */
  private readonly held = new Map<string, number>();

  /** Without a breakSwitch, F12 and Pause are left to the browser. */
  constructor(keyboard: KeyboardSwitches, breakSwitch?: BreakSwitch) {
    this.keyboard = keyboard;
    this.breakSwitch = breakSwitch;
  }

  /** A PC key went down. Returns true if it's a BBC key (so the caller can stop the browser using it). */
  keyDown(code: string): boolean {
    const key = this.bbcKeyFor(code);
    if (key === undefined) return false;
    if (!this.held.has(code)) {
      const first = !this.isHeld(key);
      this.held.set(code, key);
      if (first) this.down(key);
    }
    return true;
  }

  /** A PC key came up. Returns true if it's a BBC key. */
  keyUp(code: string): boolean {
    const key = this.bbcKeyFor(code);
    if (key === undefined) return false;
    if (this.held.delete(code) && !this.isHeld(key)) this.up(key);
    return true;
  }

  /** Let go of every key this tracker pressed: the window lost focus, so the key-ups will never come. */
  releaseAll(): void {
    const keys = new Set(this.held.values());
    this.held.clear();
    for (const key of keys) this.up(key);
  }

  /** The matrix key, BREAK_HELD, or undefined if the BBC doesn't use this PC key. */
  private bbcKeyFor(code: string): number | undefined {
    if (this.breakSwitch !== undefined && BREAK_PC_CODES.has(code)) return BREAK_HELD;
    return PC_KEY_MAP.get(code);
  }

  private down(key: number): void {
    if (key === BREAK_HELD) this.breakSwitch?.setBreak(true);
    else this.keyboard.press(key);
  }

  private up(key: number): void {
    if (key === BREAK_HELD) this.breakSwitch?.setBreak(false);
    else this.keyboard.release(key);
  }

  private isHeld(key: number): boolean {
    for (const k of this.held.values()) if (k === key) return true;
    return false;
  }
}
