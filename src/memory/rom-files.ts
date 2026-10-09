// Reading ROM files from roms/. Node-only (fs), so it's kept apart from the
// core: only tests and CLI demos import it. The browser's loader is
// web/rom-fetch.ts.
//
// The ROMs are Acorn copyright and gitignored: you supply them. Paths are
// relative to the project root, where npm runs jest and the demos.

import { existsSync, readFileSync } from 'node:fs';
import type { BbcMemoryMap } from './bbc-memory-map';
import { toRomImage } from './rom-image';
import { STANDARD_ROMS, installRom, type RomLoadReport, type StandardRom } from './standard-roms';

export const ROMS_DIR = 'roms';

/** Where a standard ROM's file lives, e.g. "roms/os12.rom". */
export function romPath(rom: StandardRom): string {
  return `${ROMS_DIR}/${rom.file}`;
}

export function romFileExists(path: string): boolean {
  return existsSync(path);
}

/** A file's bytes fitted to 16K (8K files mirrored). Throws if it's missing or the wrong size. */
export function loadRomFile(path: string): Uint8Array {
  return toRomImage(new Uint8Array(readFileSync(path)), path);
}

/** Loads every standard ROM whose file exists into `map`, and reports what was missing. */
export function loadStandardRoms(map: BbcMemoryMap): RomLoadReport {
  const loaded: StandardRom[] = [];
  const missing: StandardRom[] = [];
  for (const rom of STANDARD_ROMS) {
    const path = romPath(rom);
    if (!romFileExists(path)) {
      missing.push(rom);
      continue;
    }
    installRom(map, rom, loadRomFile(path));
    loaded.push(rom);
  }
  return { loaded, missing };
}
