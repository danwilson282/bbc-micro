// The Program panel's view-model: a program listing, with the line at
// PC marked, and any line whose bytes in memory no longer match the listing
// flagged. The listing is only notes; memory is what the CPU actually runs.
//
//   ▶ &0408  BD 00 7C  LDA &7C00,X   &7C07 holds "B" (&42): 4 cycles
//
// No DOM here: listing-panel.ts turns this into elements, Jest tests this.

import type { ListingLine } from '../../playground/listing';
import { hex16, hex8 } from '../../util/bits';
import type { DebugTarget } from './debug-target';

export interface ListingRow {
  readonly address: number;
  /** e.g. "&0408". */
  readonly addressHex: string;
  /** The listed bytes, e.g. "BD 00 7C". */
  readonly bytes: string;
  readonly source: string;
  readonly comment: string;
  /** PC is on this line's opcode: it runs on the next Step. */
  readonly current: boolean;
  /** Memory no longer holds the listed bytes (someone poked them). */
  readonly modified: boolean;
}

export function buildListingView(lines: readonly ListingLine[], target: DebugTarget, pc: number): readonly ListingRow[] {
  return lines.map((line) => ({
    address: line.address,
    addressHex: `&${hex16(line.address)}`,
    bytes: line.bytes.map(hex8).join(' '),
    source: line.source,
    comment: line.comment,
    current: line.address === pc,
    modified: line.bytes.some((byte, i) => target.peek(line.address + i) !== byte),
  }));
}
