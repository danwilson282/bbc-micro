// A 5¼" single-density floppy drive (Stage 50), as the 8271 sees it down
// the ribbon cable: a disc that may or may not be in, a head on a stepper
// motor, and the lines READY, TRK0 and WRITE PROTECT.
//
// It's passive: the 8271 steps its head and asks it for bytes. The disc's
// turning is just a clock, kept by the 8271: where the disc is now is
// cycles mod CYCLES_PER_REVOLUTION, counted from the index hole.
//
// Our simplified track: ten equal slots of 40,000 cycles, one per sector.
// Each slot has its ID field at the start and its data field DATA_FIELD_START
// cycles in. A real FM track's gaps differ a little; DFS can't tell.
//
//   0        640     2,048                         34,816  35,072    40,000
//   ├─ ID ───┤ gap ──┤ data: 256 bytes × 128 cycles ┤─ CRC ─┤─ gap ───┤ next ID
//
// Not modelled: motor spin-up (a disc is ready the moment it's in), head
// load, the index pulse, and writing (images are read-only: Stage 51).

import type { DiscImage } from '../disc/disc-image';
import { MAX_TRACKS, SECTORS_PER_TRACK } from '../disc/disc-image';

/** 300 rpm: 200 ms a revolution, at 2 MHz. */
export const CYCLES_PER_REVOLUTION = 400_000;

/** FM single density: 125,000 data bits a second, so 64 µs a byte. */
export const CYCLES_PER_BYTE = 128;

/** Our track layout: ten equal slots, one per sector (the real one is 312.5 byte times each). */
export const CYCLES_PER_SECTOR = CYCLES_PER_REVOLUTION / SECTORS_PER_TRACK;

/** Where a sector's data field starts in its slot: after the ID (4 + 2 CRC bytes), a gap and the data mark. Our choice of 16 byte times. */
export const DATA_FIELD_START = 16 * CYCLES_PER_BYTE;

/** How long until `point` (cycles from the index hole) next comes under the head, from time `now`. 0 if it's there now. */
export function cyclesUntil(now: number, point: number): number {
  const angle = now % CYCLES_PER_REVOLUTION;
  return (point - angle + CYCLES_PER_REVOLUTION) % CYCLES_PER_REVOLUTION;
}

export class DiscDrive {
  private image: DiscImage | undefined;
  private head = 0;

  /** The disc in the drive, if any. */
  get disc(): DiscImage | undefined {
    return this.image;
  }

  insert(image: DiscImage): void {
    this.image = image;
  }

  eject(): void {
    this.image = undefined;
  }

  /** READY: a disc is in (and, on a real drive, up to speed: we don't wait). */
  get ready(): boolean {
    return this.image !== undefined;
  }

  /** WRITE PROTECT: every disc is, until Stage 51 decides about writing. */
  get writeProtected(): boolean {
    return this.image !== undefined;
  }

  /** The track the head is over, 0-79. */
  get headTrack(): number {
    return this.head;
  }

  /** TRK0: the head is at the outermost track. */
  get track0(): boolean {
    return this.head === 0;
  }

  /** One STEP pulse: +1 is in (towards the middle), -1 out. The end stops hold it in 0-79. */
  step(direction: 1 | -1): void {
    this.head = Math.min(MAX_TRACKS - 1, Math.max(0, this.head + direction));
  }

  /**
   * Where `sector` of the track under the head, on `side`, starts in the
   * image, or -1 if no such sector passes the head (no disc, no such
   * side, sector or track). Never throws, and makes nothing.
   */
  sectorOffset(side: number, sector: number): number {
    const image = this.image;
    if (image === undefined || !image.hasSector(side, this.head, sector)) return -1;
    return image.offsetOf(side, this.head, sector);
  }

  /** A byte of the image (from sectorOffset), or &00 with no disc. */
  byteAt(offset: number): number {
    return this.image?.byteAt(offset) ?? 0x00;
  }
}
