// Which ROM files we expect in roms/, and where each one goes.
//
// The slot numbers are our choice (see the Stage 22 doc). BASIC goes in 15,
// the highest slot, because at reset the MOS starts the highest-numbered
// language ROM it finds. DFS has no language entry, so slot 14 is fine.
//
// Shared by the Node loader (rom-files.ts) and the browser one
// (web/rom-fetch.ts): they differ only in how they get the bytes.

import type { BbcMemoryMap } from './bbc-memory-map';

export type StandardRomId = 'mos' | 'basic' | 'dfs';

export interface StandardRom {
  readonly id: StandardRomId;
  /** File name inside roms/. */
  readonly file: string;
  readonly name: string;
  /** 'mos' for &C000-&FFFF, or a sideways slot number. */
  readonly slot: 'mos' | number;
}

export const STANDARD_ROMS: readonly StandardRom[] = [
  { id: 'mos', file: 'os12.rom', name: 'MOS 1.20', slot: 'mos' },
  { id: 'basic', file: 'basic2.rom', name: 'BASIC II', slot: 15 },
  { id: 'dfs', file: 'dfs.rom', name: 'Acorn DFS', slot: 14 },
];

/** Puts a fitted 16K image where `rom` belongs. */
export function installRom(map: BbcMemoryMap, rom: StandardRom, image: Uint8Array): void {
  if (rom.slot === 'mos') map.loadMos(image);
  else map.loadSidewaysRom(rom.slot, image);
}

/** Which standard ROMs were loaded, and which files weren't there. */
export interface RomLoadReport {
  readonly loaded: readonly StandardRom[];
  readonly missing: readonly StandardRom[];
}
