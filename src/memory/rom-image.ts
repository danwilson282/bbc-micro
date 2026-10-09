// Fitting a ROM file's bytes to a 16K ROM socket.
//
// The Model B's ROM sockets are wired for 16K EPROMs (27128). An 8K chip
// (2764) has no A13 pin, so it ignores that address line: its 8K show up at
// &8000-&9FFF and again at &A000-&BFFF. We model that by repeating an 8K
// file to make a 16K image. Any other size isn't a ROM we know how to fit.
//
// No fs and no fetch here: the Node loader (rom-files.ts) and the browser
// loader (web/rom-fetch.ts) both get bytes their own way, then come here.

import { ROM_SIZE } from './memory-regions';

/** An 8K EPROM (2764). */
export const ROM_SIZE_8K = 0x2000;

/**
 * A fresh 16K image from a ROM file's bytes: 16K as is, 8K repeated twice.
 * Throws RangeError, naming the file, for any other size.
 */
export function toRomImage(bytes: Uint8Array, name: string): Uint8Array {
  const image = new Uint8Array(ROM_SIZE);
  if (bytes.length === ROM_SIZE) {
    image.set(bytes);
  } else if (bytes.length === ROM_SIZE_8K) {
    image.set(bytes, 0);
    image.set(bytes, ROM_SIZE_8K);
  } else {
    throw new RangeError(`${name} is ${String(bytes.length)} bytes: a ROM image must be 16384 (16K) or 8192 (8K)`);
  }
  return image;
}
