// DFS catalogues on a disc: reading one (and its files) from a DiscImage, and
// writing whole sides from a list of files, so tests can make their own discs.
//
// A DFS side is a world of its own: side 0 of a disc is drive 0, side 1 is
// drive 2, and each has its own catalogue in sectors 0 and 1 of its track 0.
// Sector numbers count across the side: sector n is track n ÷ 10, sector n mod 10.
//
// Pure: no fs. The CLI and the browser bring the bytes.

import {
  DiscImage,
  SECTORS_PER_TRACK,
  SECTOR_SIZE,
  TRACK_SIZE,
  maxImageSize,
  sectorOffset,
  type DiscFormat,
  type TrackCount,
} from './disc-image';
import {
  CAT_OPTION_SECTORS_HI,
  CAT_SECTORS_LO,
  FIRST_FILE_SECTOR,
  MAX_FILES,
  NAME_LENGTH,
  decodeCatalogue,
  encodeCatalogue,
  fileSectors,
  fullName,
  type BootOption,
  type DfsCatalogue,
  type DfsFile,
} from './dfs-catalogue';

const hex = (n: number, digits: number): string => n.toString(16).toUpperCase().padStart(digits, '0');

/** Sectors on one side: 400 (&190) for 40 tracks, 800 (&320) for 80. */
export function sideSectors(tracks: TrackCount): number {
  return tracks * SECTORS_PER_TRACK;
}

/** The catalogue of one side (0, or 1 on a dsd). Throws RangeError if it isn't a DFS catalogue. */
export function readCatalogue(image: DiscImage, side: number): DfsCatalogue {
  return decodeCatalogue(image.readSector(side, 0, 0), image.readSector(side, 0, 1));
}

/** A file's bytes, from its start sector on. Throws RangeError, naming it, if a sector isn't on the disc. */
export function readFile(image: DiscImage, side: number, file: DfsFile): Uint8Array {
  const out = new Uint8Array(fileSectors(file.length) * SECTOR_SIZE);
  for (let i = 0; i * SECTOR_SIZE < file.length; i++) {
    const n = file.startSector + i;
    const track = Math.floor(n / SECTORS_PER_TRACK);
    const sector = n % SECTORS_PER_TRACK;
    if (!image.hasSector(side, track, sector)) {
      throw new RangeError(`${fullName(file)}: sector &${hex(n, 3)} is not on this disc (track ${String(track)}, sector ${String(sector)})`);
    }
    out.set(image.readSector(side, track, sector), i * SECTOR_SIZE);
  }
  return out.subarray(0, file.length);
}

/**
 * A disc image whose track count comes from side 0's DFS catalogue when it
 * says 400 or 800 sectors, and from the size otherwise (Stage 47's rule).
 * A short image's size can't tell 40 tracks from 80, but the catalogue can.
 * Side 0's sector 1 is at &100 in both formats, so &106/&107 are file offsets.
 */
export function openDfsDisc(bytes: Uint8Array, format: DiscFormat, name: string): DiscImage {
  const sectors = (((bytes[SECTOR_SIZE + CAT_OPTION_SECTORS_HI] ?? 0) & 3) << 8) | (bytes[SECTOR_SIZE + CAT_SECTORS_LO] ?? 0);
  const fromCatalogue = sectors === sideSectors(80) ? 80 : sectors === sideSectors(40) ? 40 : undefined;
  // A file bigger than 40 tracks is 80 whatever its catalogue says.
  const tracks = fromCatalogue === 40 && bytes.length > maxImageSize(format, 40) ? undefined : fromCatalogue;
  return DiscImage.fromBytes(bytes, format, name, tracks);
}

// --- Writing ----------------------------------------------------------------

export interface NewDfsFile {
  /** Default "$". */
  readonly directory?: string;
  readonly name: string;
  readonly locked?: boolean;
  /** A 32-bit address like &FFFF1900 is fine: the catalogue keeps its low 18 bits. */
  readonly load: number;
  readonly exec: number;
  readonly data: Uint8Array;
}

export interface NewDfsSide {
  readonly title?: string;
  readonly bootOption?: BootOption;
  readonly cycle?: number;
  readonly tracks: TrackCount;
  /** Laid out from sector 2 in this order. */
  readonly files: readonly NewDfsFile[];
}

/**
 * Characters *SAVE accepts in a name or directory, as we read the DFS User
 * Guide: printable ASCII except space and the ones with a meaning in a file
 * spec: "." (directory separator), ":" (drive), "#" and "*" (wildcards) and
 * '"' (quotes). Stricter than the reader, which takes what it finds.
 */
const NAME_CHARACTER = /^[\x21-\x7e]$/;
const SPECIAL = new Set(['.', ':', '#', '*', '"']);

function validCharacter(c: string): boolean {
  return NAME_CHARACTER.test(c) && !SPECIAL.has(c);
}

function checkName(directory: string, name: string): void {
  const full = `${directory}.${name}`;
  if (directory.length !== 1 || !validCharacter(directory)) {
    throw new RangeError(`${full}: the directory must be one printable character other than . : # * " or space`);
  }
  if (name.length < 1 || name.length > NAME_LENGTH || !Array.from(name).every(validCharacter)) {
    throw new RangeError(`${full}: a name is 1 to ${String(NAME_LENGTH)} printable characters, none of . : # * " or space`);
  }
}

/** A 32-bit address (or an 18-bit one) as the catalogue's 18 bits. */
function address18(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${what} must be a 32-bit address, not ${String(value)}`);
  }
  return value & 0x3_ffff; // &FFFF1900 → &31900
}

/**
 * One side of a DFS disc, `tracks × 2,560` bytes, with the files laid out
 * one after another from sector 2 and a catalogue listing them highest
 * start sector first. Throws RangeError for a name DFS wouldn't accept, a
 * duplicate (ignoring case, as DFS does), more than 31 files, or files that
 * don't fit.
 */
export function buildDfsSide(spec: NewDfsSide): Uint8Array {
  const { tracks, files } = spec;
  if (files.length > MAX_FILES) throw new RangeError(`${String(files.length)} files: a DFS side holds at most ${String(MAX_FILES)}`);
  const sectorCount = sideSectors(tracks);
  const side = new Uint8Array(tracks * TRACK_SIZE);

  const seen = new Map<string, string>();
  const entries: DfsFile[] = [];
  let next = FIRST_FILE_SECTOR;
  for (const file of files) {
    const directory = file.directory ?? '$';
    const full = `${directory}.${file.name}`;
    checkName(directory, file.name);
    const key = full.toUpperCase();
    const clash = seen.get(key);
    if (clash !== undefined) throw new RangeError(`${full}: there's already a ${clash} (DFS ignores case in names)`);
    seen.set(key, full);

    const sectors = fileSectors(file.data.length);
    if (next + sectors > sectorCount) {
      throw new RangeError(
        `${full} doesn't fit: it needs sectors &${hex(next, 3)}-&${hex(next + sectors - 1, 3)}, ` +
          `but a ${String(tracks)}-track side has &${hex(sectorCount, 3)} (${String(sectorCount)}) sectors`,
      );
    }
    side.set(file.data, next * SECTOR_SIZE);
    entries.push({
      directory,
      name: file.name,
      locked: file.locked ?? false,
      load: address18(file.load, `${full} load address`),
      exec: address18(file.exec, `${full} exec address`),
      length: file.data.length,
      startSector: next,
    });
    next += sectors;
  }

  // Laid out lowest first, listed highest first: reverse keeps ties (empty files) stable too.
  side.set(
    encodeCatalogue({
      title: spec.title ?? '',
      cycle: spec.cycle ?? 0,
      bootOption: spec.bootOption ?? 0,
      sectorCount,
      files: entries.reverse(),
    }),
    0,
  );
  return side;
}

/**
 * A whole .ssd (one side) or .dsd (two, interleaved by track as Stage 47
 * worked out), full size. Throws RangeError for the wrong number of sides
 * or sides of different track counts.
 */
export function buildDfsImage(format: DiscFormat, sides: readonly NewDfsSide[]): Uint8Array {
  const wanted = format === 'ssd' ? 1 : 2;
  if (sides.length !== wanted) {
    throw new RangeError(`a .${format} has ${format === 'ssd' ? 'one side' : 'two sides'}, not ${String(sides.length)}`);
  }
  const tracks = sides[0]?.tracks ?? 40;
  if (sides.some((s) => s.tracks !== tracks)) throw new RangeError('both sides of a disc have the same number of tracks');

  const image = new Uint8Array(maxImageSize(format, tracks));
  sides.forEach((spec, side) => {
    const bytes = buildDfsSide(spec);
    for (let track = 0; track < tracks; track++) {
      image.set(bytes.subarray(track * TRACK_SIZE, (track + 1) * TRACK_SIZE), sectorOffset(format, side, track, 0));
    }
  });
  return image;
}
