// Disc image geometry: where (side, track, sector) lives in an .ssd or .dsd.
//
// An image file is the 256-byte data fields of every sector, end to end, with
// no header, IDs, gaps or CRCs. Acorn DFS discs have 10 sectors per track and
// 40 or 80 tracks per side (DFS User Guide; BeebWiki's disc image pages):
//
//   .ssd  one side, track after track:     offset = (track × 10 + sector) × 256
//   .dsd  both sides, interleaved by track: offset = ((track × 2 + side) × 10 + sector) × 256
//
// An 80-track .ssd and a 40-track .dsd are both 204,800 bytes, so the format
// is always passed in, never guessed from the size.
//
// No fs and no fetch here: the CLI demo and (later) the browser get the bytes
// their own way, then come here, as with ROMs (memory/rom-image.ts).

/** Bytes in one sector's data field. Acorn DFS size code 1. */
export const SECTOR_SIZE = 256;
/** Sectors per track in Acorn DFS single-density format, numbered 0-9. */
export const SECTORS_PER_TRACK = 10;
/** One track of one side: 10 × 256 = 2,560 bytes (&A00). */
export const TRACK_SIZE = SECTORS_PER_TRACK * SECTOR_SIZE;
/** The most track positions a Model B drive has (a 96 tpi drive). */
export const MAX_TRACKS = 80;

export type DiscFormat = 'ssd' | 'dsd';
export type TrackCount = 40 | 80;

export interface DiscGeometry {
  readonly format: DiscFormat;
  readonly sides: 1 | 2;
  readonly tracks: TrackCount;
}

function sidesOf(format: DiscFormat): 1 | 2 {
  return format === 'ssd' ? 1 : 2;
}

/** The size of a full image of this format and track count. */
export function maxImageSize(format: DiscFormat, tracks: TrackCount): number {
  return tracks * sidesOf(format) * TRACK_SIZE;
}

function inRange(value: number, limit: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < limit;
}

/**
 * Where (side, track, sector) starts in an image of this format, for any
 * disc up to 80 tracks. Throws RangeError for an address no such disc has.
 */
export function sectorOffset(format: DiscFormat, side: number, track: number, sector: number): number {
  const sides = sidesOf(format);
  if (!inRange(side, sides) || !inRange(track, MAX_TRACKS) || !inRange(sector, SECTORS_PER_TRACK)) {
    throw new RangeError(
      `no side ${String(side)} track ${String(track)} sector ${String(sector)} on a .${format} ` +
        `(sides 0-${String(sides - 1)}, tracks 0-${String(MAX_TRACKS - 1)}, sectors 0-${String(SECTORS_PER_TRACK - 1)})`,
    );
  }
  // The "track slot": which 2,560-byte run of the file holds this track.
  const slot = track * sides + side;
  return (slot * SECTORS_PER_TRACK + sector) * SECTOR_SIZE;
}

/** 'ssd' or 'dsd' from a file name's extension (any case), or undefined. */
export function formatFromName(name: string): DiscFormat | undefined {
  const match = /\.(ssd|dsd)$/i.exec(name);
  const ext = match?.[1]?.toLowerCase();
  return ext === 'ssd' || ext === 'dsd' ? ext : undefined;
}

/** A read-only disc: an .ssd or .dsd file's sectors, addressed by (side, track, sector). */
export class DiscImage {
  /** The bytes of the whole geometry. Past fileLength they're &00. */
  private readonly store: Uint8Array;

  private constructor(
    readonly geometry: DiscGeometry,
    /** How many bytes the file really had. Short images are common. */
    readonly fileLength: number,
    bytes: Uint8Array,
  ) {
    this.store = new Uint8Array(maxImageSize(geometry.format, geometry.tracks));
    this.store.set(bytes);
  }

  /**
   * A disc from an image file's bytes (copied). The track count follows from
   * the size: up to a full 40-track image is 40 tracks, otherwise 80. Throws
   * RangeError, naming the file, if it's empty or bigger than 80 tracks.
   */
  static fromBytes(bytes: Uint8Array, format: DiscFormat, name: string): DiscImage {
    const max = maxImageSize(format, 80);
    if (bytes.length === 0 || bytes.length > max) {
      throw new RangeError(
        `${name} is ${String(bytes.length)} bytes: a .${format} image must be 1 to ${String(max)} bytes (80 tracks)`,
      );
    }
    const tracks: TrackCount = bytes.length <= maxImageSize(format, 40) ? 40 : 80;
    return new DiscImage({ format, sides: sidesOf(format), tracks }, bytes.length, bytes);
  }

  /** Whether this disc has (side, track, sector). Never throws. */
  hasSector(side: number, track: number, sector: number): boolean {
    const { sides, tracks } = this.geometry;
    return inRange(side, sides) && inRange(track, tracks) && inRange(sector, SECTORS_PER_TRACK);
  }

  /** Where (side, track, sector) starts in the image file. Throws RangeError if the disc hasn't got it. */
  offsetOf(side: number, track: number, sector: number): number {
    if (!this.hasSector(side, track, sector)) {
      const { format, sides, tracks } = this.geometry;
      throw new RangeError(
        `no side ${String(side)} track ${String(track)} sector ${String(sector)} on this ` +
          `${String(tracks)}-track ${sides === 1 ? 'single' : 'double'}-sided ${format}`,
      );
    }
    return sectorOffset(this.geometry.format, side, track, sector);
  }

  /** A copy of the 256 bytes of (side, track, sector). Throws RangeError if the disc hasn't got it. */
  readSector(side: number, track: number, sector: number): Uint8Array {
    const offset = this.offsetOf(side, track, sector);
    return this.store.slice(offset, offset + SECTOR_SIZE);
  }
}
