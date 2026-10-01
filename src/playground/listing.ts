// A hand-assembled program, kept as a listing: each line says where it lives,
// its bytes, and the assembly they stand for. It's what you'd write on paper
// before Stage 08 gives us an assembler.
//
//   &0400  A9 00     LDA #&00     Z=1: the value is zero
//
// The bytes are the program. The source and comment are only for people.

import type { Bus } from '../memory/bus';

export interface ListingLine {
  readonly address: number;
  /** Opcode first, then operand bytes (addresses low byte first). */
  readonly bytes: readonly number[];
  /** The assembly these bytes encode, e.g. "LDA &7C00,X". */
  readonly source: string;
  /** What to watch for when this line runs. */
  readonly comment: string;
}

/** Writes every line's bytes at its address. */
export function loadListing(bus: Pick<Bus, 'write'>, lines: readonly ListingLine[]): void {
  for (const line of lines) {
    line.bytes.forEach((byte, i) => {
      bus.write((line.address + i) & 0xffff, byte);
    });
  }
}

/** The first address after the listing. */
export function listingEnd(lines: readonly ListingLine[]): number {
  const last = lines.at(-1);
  return last === undefined ? 0 : (last.address + last.bytes.length) & 0xffff;
}
