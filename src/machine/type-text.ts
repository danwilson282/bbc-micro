// Typing without a keyboard (Stage 35): close the BBC's switches for a
// while, as a person's fingers would, and run the machine meanwhile.
//
// The MOS hears a key through the CA2 interrupt, then scans for it from its
// 100 Hz Timer 1 interrupt, so a key has to stay down for a few scans (10 ms
// each), and be let go long enough for the next press to be a new one.
// Measured in Stage 35: 1 frame down and 1 frame up is already enough; the
// default doubles both.
//
// Characters → switches is *symbolic*: '"' is SHIFT + 2 because that's where
// the BBC prints it. That's fine here because we pick the switches. The
// browser stays positional (Stage 34).

import { BBC_KEYS } from '../devices/keyboard';
import type { BbcModelB } from './bbc-model-b';

/** SHIFT, row 0 column 0. */
const SHIFT = 0x00;
const RETURN = 0x49;
const SPACE = 0x62;

export interface TypingOptions {
  /** Frames (20 ms each) each key is held down. */
  readonly holdFrames: number;
  /** Frames with every key up before the next character. */
  readonly gapFrames: number;
  /** Called after each frame: for tests and demos that watch. */
  readonly onFrame?: () => void;
}

/** 2 frames down, 2 up: 80 ms a character, about 12 a second. */
export const DEFAULT_TYPING: TypingOptions = { holdFrames: 2, gapFrames: 2 };

/** One character → the key numbers to hold, built once from the keytops in BBC_KEYS. */
const KEYS_BY_CHAR: ReadonlyMap<string, readonly number[]> = buildCharMap();

function buildCharMap(): Map<string, readonly number[]> {
  const map = new Map<string, readonly number[]>();
  for (const key of BBC_KEYS) {
    // Only single-character legends are typed characters: "A", "2", ":". Not "SHIFT" or "f0".
    if (key.legend.length === 1 && !(key.legend >= 'a' && key.legend <= 'z')) map.set(key.legend, [key.key]);
    if (key.shifted !== undefined) map.set(key.shifted, [SHIFT, key.key]);
  }
  map.set(' ', [SPACE]);
  map.set('\r', [RETURN]);
  map.set('\n', [RETURN]);
  return map;
}

/**
 * The switches that type `char` on a BBC (SHIFT first when needed), or
 * undefined if one key and SHIFT can't. Lowercase is undefined: with CAPS
 * LOCK on (the MOS's default) it needs SHIFT, with it off it doesn't, and
 * this helper doesn't know which.
 */
export function keysFor(char: string): readonly number[] | undefined {
  return KEYS_BY_CHAR.get(char);
}

/**
 * Types `text` into the machine: each character's keys are held for
 * holdFrames, then all let go for gapFrames. Throws RangeError, before
 * pressing anything, if a character can't be typed (see keysFor).
 */
export function typeText(machine: BbcModelB, text: string, options: TypingOptions = DEFAULT_TYPING): void {
  const presses: (readonly number[])[] = [];
  for (const char of text) {
    const keys = keysFor(char);
    if (keys === undefined) throw new RangeError(`typeText: no BBC key types ${JSON.stringify(char)} (lowercase needs the CAPS LOCK state)`);
    presses.push(keys);
  }
  for (const keys of presses) tapKeys(machine, keys, options);
}

/**
 * Holds `keys` down together for holdFrames, then lets them all go for
 * gapFrames: one chord, like SHIFT + A or CTRL + A (Stage 36). Pressed in
 * order, released in order.
 */
export function tapKeys(machine: BbcModelB, keys: readonly number[], options: TypingOptions = DEFAULT_TYPING): void {
  for (const key of keys) machine.keyboard.press(key);
  runFrames(machine, options.holdFrames, options);
  for (const key of keys) machine.keyboard.release(key);
  runFrames(machine, options.gapFrames, options);
}

function runFrames(machine: BbcModelB, frames: number, options: TypingOptions): void {
  for (let i = 0; i < frames; i++) {
    machine.runFrame();
    options.onFrame?.();
  }
}
