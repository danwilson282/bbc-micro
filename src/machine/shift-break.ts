// SHIFT-BREAK without fingers (Stage 51): hold SHIFT, press and let go of
// BREAK, keep SHIFT down until the MOS has asked the ROMs about booting.
//
// The MOS offers service call 3 (auto-boot) about 16 ms after BREAK goes
// up, with Y = &00 if SHIFT is down (with the start-up link open). DFS then
// reads the catalogue and acts on the boot option. Measured in Stage 51:
// half a second of SHIFT is plenty.

import type { BbcModelB } from './bbc-model-b';

/** SHIFT's key number: row 0, column 0 (Stage 34). */
export const SHIFT_KEY = 0x00;

export interface ShiftBreakOptions {
  /** Frames (20 ms each) BREAK is held down. */
  readonly breakFrames: number;
  /** Frames SHIFT stays down after BREAK goes up. */
  readonly shiftFrames: number;
}

export const DEFAULT_SHIFT_BREAK: ShiftBreakOptions = { breakFrames: 2, shiftFrames: 25 };

/** Holds SHIFT, taps BREAK, lets SHIFT go: the disc in drive 0 boots. Runs the machine meanwhile. */
export function shiftBreak(machine: BbcModelB, options: ShiftBreakOptions = DEFAULT_SHIFT_BREAK): void {
  machine.keyboard.press(SHIFT_KEY);
  machine.setBreak(true);
  for (let i = 0; i < options.breakFrames; i++) machine.runFrame();
  machine.setBreak(false);
  for (let i = 0; i < options.shiftFrames; i++) machine.runFrame();
  machine.keyboard.release(SHIFT_KEY);
}
