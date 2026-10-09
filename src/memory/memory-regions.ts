// The Model B's memory map, as a table: which part of the machine answers
// each address. From the Advanced User Guide's memory map.
//
//   &0000-&7FFF  RAM            A15 = 0
//   &8000-&BFFF  sideways ROM   A15 = 1, A14 = 0
//   &C000-&FBFF  MOS ROM        A15 = 1, A14 = 1 ...
//   &FC00-&FCFF  FRED             ... except these three pages, which are I/O
//   &FD00-&FDFF  JIM
//   &FE00-&FEFF  SHEILA
//   &FF00-&FFFF  MOS ROM        the last page of the same 16K chip
//
// The MOS ROM is one 16K chip at &C000-&FFFF. The decoder switches on I/O
// instead for &FC00-&FEFF, so 768 of its bytes can never be read by the CPU.

/** First address of each region (Advanced User Guide, memory map). */
export const RAM_START = 0x0000;
export const SIDEWAYS_START = 0x8000;
export const MOS_START = 0xc000;
export const FRED_START = 0xfc00;
export const JIM_START = 0xfd00;
export const SHEILA_START = 0xfe00;
/** The MOS ROM shows through again from here to &FFFF. */
export const MOS_TOP_PAGE = 0xff00;

/** The Model B's 32K of RAM. */
export const RAM_SIZE = SIDEWAYS_START - RAM_START;
/** Sideways and MOS ROMs are 16K chips. */
export const ROM_SIZE = 0x4000;

export type RegionId = 'ram' | 'sideways' | 'mos' | 'fred' | 'jim' | 'sheila';

export interface MemoryRegion {
  readonly id: RegionId;
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
  readonly name: string;
  /** What's there on a Model B. */
  readonly detail: string;
}

/** The map in address order. The MOS ROM appears twice, either side of the I/O pages. */
export const MEMORY_REGIONS: readonly MemoryRegion[] = [
  { id: 'ram', start: RAM_START, end: SIDEWAYS_START - 1, name: 'RAM', detail: 'zero page, stack, MOS workspace, your program, and screen memory at the top' },
  { id: 'sideways', start: SIDEWAYS_START, end: MOS_START - 1, name: 'Sideways ROM', detail: 'one of 16 paged ROMs, chosen by ROMSEL at &FE30 (Stage 22); an empty socket for now' },
  { id: 'mos', start: MOS_START, end: FRED_START - 1, name: 'MOS ROM', detail: 'the operating system, MOS 1.20 (Stage 22 loads it)' },
  { id: 'fred', start: FRED_START, end: JIM_START - 1, name: 'FRED', detail: '1 MHz bus: add-on hardware (nothing connected)' },
  { id: 'jim', start: JIM_START, end: SHEILA_START - 1, name: 'JIM', detail: '1 MHz bus: paged expansion memory (nothing connected)' },
  { id: 'sheila', start: SHEILA_START, end: MOS_TOP_PAGE - 1, name: 'SHEILA', detail: "the Model B's own I/O chips: video, VIAs, disc, ..." },
  { id: 'mos', start: MOS_TOP_PAGE, end: 0xffff, name: 'MOS ROM', detail: 'the last page of the MOS: OS entry points and the CPU vectors at &FFFA-&FFFF' },
];

/** Which region answers address & 0xffff. The same tests, in the same order, as BbcMemoryMap.read(). */
export function regionOf(address: number): RegionId {
  const a = address & 0xffff;
  if (a < SIDEWAYS_START) return 'ram';
  if (a < MOS_START) return 'sideways';
  if (a < FRED_START || a >= MOS_TOP_PAGE) return 'mos';
  if (a < JIM_START) return 'fred';
  if (a < SHEILA_START) return 'jim';
  return 'sheila';
}
