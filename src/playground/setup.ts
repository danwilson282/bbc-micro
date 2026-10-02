// The data every Part 2 playground program expects to find in memory. The
// browser playground, the CLI demos and the program tests all call this, so
// they can't drift apart.
//
//   &7C00  "HELLO, BBC MICRO"  row 0 of Mode 7 screen memory (AUG memory map)
//   &70/71 00 7C               a zero-page pointer to &7C00, for (&70),Y

import type { Bus } from '../memory/bus';
import { hi, lo } from '../util/bits';

/** Where Mode 7 screen memory starts on a Model B. Nothing draws it yet. */
export const MODE7_SCREEN = 0x7c00;
/** Bytes per Mode 7 row: 40 characters. So row 1 starts at &7C28. */
export const MODE7_ROW = 40;
export const MESSAGE = 'HELLO, BBC MICRO';
/** The zero-page pointer to MODE7_SCREEN. */
export const SCREEN_POINTER = 0x70;

export function loadPlaygroundData(bus: Pick<Bus, 'write'>): void {
  for (let i = 0; i < MESSAGE.length; i++) bus.write(MODE7_SCREEN + i, MESSAGE.charCodeAt(i));
  bus.write(SCREEN_POINTER, lo(MODE7_SCREEN));
  bus.write(SCREEN_POINTER + 1, hi(MODE7_SCREEN));
}
