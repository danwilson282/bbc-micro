// The data every Part 2 playground program expects to find in memory. The
// browser playground, the CLI demos and the program tests all call this, so
// they can't drift apart.
//
//   &7C00  "HELLO, BBC MICRO"  row 0 of Mode 7 screen memory (AUG memory map)
//   &70/71 00 7C               a zero-page pointer to &7C00, for (&70),Y

import { RESET_VECTOR } from '../cpu/cpu6502';
import type { Bus } from '../memory/bus';
import { hi, lo } from '../util/bits';
import { loadListing, type ListingLine } from './listing';

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

/** NOP (&EA): fills the rest of the program page, so stepping past a program's end is harmless. */
const NOP = 0xea;
/** The program page: programs start at &0400, and the NOP slide runs to &04FF. */
export const PROGRAM_PAGE = 0x0400;
const PROGRAM_PAGE_END = 0x0500;

/**
 * The pointers the addressing-mode explorer's examples follow (Stage 05):
 *   &FF/&00 = 00 7C  the &70 pointer again, straddling the end of page zero
 *   &30FF = 00, &3000 = 04, &3100 = 80  the JMP (&30FF) trap: the NMOS bug
 *     jumps to &0400; a "correct" CPU would go to &8000
 */
export function loadExplorerPointers(bus: Pick<Bus, 'write'>): void {
  bus.write(0x00ff, lo(MODE7_SCREEN));
  bus.write(0x0000, hi(MODE7_SCREEN));
  bus.write(0x30ff, 0x00);
  bus.write(0x3000, 0x04);
  bus.write(0x3100, 0x80);
}

/**
 * A clean playground with a program in it: all 64K zeroed, the playground
 * data and explorer pointers, NOPs through the program page, then the
 * program's bytes, and the reset vector pointing at entry.
 *
 * The NOPs end at &04FF. &0500 is &00 (BRK), which isn't implemented yet, so
 * a program that runs off the end of its page stops there with an error.
 */
export function installProgram(bus: Pick<Bus, 'write'>, lines: readonly ListingLine[], entry: number): void {
  for (let address = 0; address < 0x10000; address++) bus.write(address, 0x00);
  loadPlaygroundData(bus);
  loadExplorerPointers(bus);
  for (let address = PROGRAM_PAGE; address < PROGRAM_PAGE_END; address++) bus.write(address, NOP);
  loadListing(bus, lines);
  bus.write(RESET_VECTOR, lo(entry));
  bus.write(RESET_VECTOR + 1, hi(entry));
}
