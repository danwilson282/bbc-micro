// Loading ROM files in the browser. The Vite dev server serves the project
// folder, so roms/os12.rom is at /roms/os12.rom (dev only: roms/ is
// gitignored and never built into the site).
//
// A missing ROM is normal (you supply them), so these return a result
// rather than throwing. One trap: for a file it can't find, the dev server
// may answer 200 with index.html (its fallback for single-page apps), so a
// 200 isn't enough. We reject an HTML reply, and toRomImage rejects any
// other size that isn't 8K or 16K.

import type { BbcMemoryMap } from '../memory/bbc-memory-map';
import { toRomImage } from '../memory/rom-image';
import { STANDARD_ROMS, installRom, type RomLoadReport, type StandardRom } from '../memory/standard-roms';

/** The parts of fetch() we use, so tests can pass a fake. */
export interface RomResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type RomFetch = (url: string) => Promise<RomResponse>;

export type RomFetchResult = { readonly ok: true; readonly image: Uint8Array } | { readonly ok: false; readonly reason: string };

const browserFetch: RomFetch = (url) => fetch(url);

/** Fetches one ROM file and fits it to 16K. */
export async function fetchRom(url: string, fetchFn: RomFetch = browserFetch): Promise<RomFetchResult> {
  let response: RomResponse;
  try {
    response = await fetchFn(url);
  } catch (e) {
    return { ok: false, reason: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!response.ok) return { ok: false, reason: `${url}: HTTP ${String(response.status)}` };
  if (response.headers.get('content-type')?.includes('text/html') === true) {
    return { ok: false, reason: `${url}: not found (the server sent an HTML page)` };
  }
  try {
    return { ok: true, image: toRomImage(new Uint8Array(await response.arrayBuffer()), url) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetches every standard ROM from `base` (e.g. "/roms/") into `map`, and reports what was missing. */
export async function fetchStandardRoms(map: BbcMemoryMap, base = '/roms/', fetchFn: RomFetch = browserFetch): Promise<RomLoadReport> {
  const results = await Promise.all(STANDARD_ROMS.map(async (rom) => ({ rom, result: await fetchRom(base + rom.file, fetchFn) })));
  const loaded: StandardRom[] = [];
  const missing: StandardRom[] = [];
  for (const { rom, result } of results) {
    if (result.ok) {
      installRom(map, rom, result.image);
      loaded.push(rom);
    } else {
      missing.push(rom);
    }
  }
  return { loaded, missing };
}
