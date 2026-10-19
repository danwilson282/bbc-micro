// The Acorn DFS catalogue: sectors 0 and 1 of track 0 on each side.
//
// Layout (DFS User Guide; BeebWiki "Acorn DFS disc format"; checked against
// the discs in discs/):
//
//   sector 0  &00-&07  title, first 8 characters
//             &08-&FF  31 × (name, 7 bytes, space-padded; directory, 1 byte, bit 7 = locked)
//   sector 1  &00-&03  title, last 4 characters
//             &04      cycle number (BCD)
//             &05      8 × number of files
//             &06      bits 4-5 boot option, bits 0-1 sector count bits 8-9
//             &07      sector count bits 0-7
//             &08-&FF  31 × (load lo, hi; exec lo, hi; length lo, hi; mixed; start sector lo)
//
// The mixed byte: bits 7-6 exec b17-16, 5-4 length b17-16, 3-2 load b17-16,
// 1-0 start sector b9-8. Entry n of sector 0 and entry n of sector 1 are the
// same file, and the entries are kept highest start sector first.
//
// This module only turns bytes into a DfsCatalogue and back. Finding the
// sectors on a disc is dfs-disc.ts's job.

import { SECTOR_SIZE } from './disc-image';

/** Two sectors: &200 bytes. */
export const CATALOGUE_SIZE = 2 * SECTOR_SIZE;
/** Sectors 0 and 1 hold the catalogue, so the first file starts at sector 2. */
export const FIRST_FILE_SECTOR = 2;
/** 31 entries of 8 bytes after the 8-byte header, in each sector. */
export const MAX_FILES = 31;
/** Bytes per entry, in each of the two sectors. */
export const ENTRY_SIZE = 8;
/** Title characters: 8 in sector 0, 4 in sector 1. */
export const TITLE_LENGTH = 12;
/** File names are padded to 7 characters with spaces. */
export const NAME_LENGTH = 7;

// Offsets within sector 1 (BeebWiki; DFS User Guide).
/** Last 4 title characters. */
export const CAT_TITLE_END = 0x00;
/** Cycle number, bumped (in BCD) each time DFS rewrites the catalogue. */
export const CAT_CYCLE = 0x04;
/** 8 × the number of files: the offset of the end of the last entry, less 8. */
export const CAT_FILE_COUNT_X8 = 0x05;
/** Bits 4-5: boot option (*OPT 4). Bits 0-1: sector count bits 8-9. */
export const CAT_OPTION_SECTORS_HI = 0x06;
/** Sector count bits 0-7. */
export const CAT_SECTORS_LO = 0x07;
/** The first entry, in both sectors. */
export const CAT_FIRST_ENTRY = 0x08;

/** Byte 7 of a name entry: bit 7 is the locked flag, bits 0-6 the directory. */
export const LOCKED_BIT = 0x80;

/** *OPT 4,n: what SHIFT-BREAK does with $.!BOOT. */
export type BootOption = 0 | 1 | 2 | 3;
/** Indexed by the two bits, so a decoded option is typed BootOption without a cast. */
const BOOT_OPTIONS = [0, 1, 2, 3] as const satisfies readonly BootOption[];
export const BOOT_OPTION_NAMES = ['off', 'LOAD', 'RUN', 'EXEC'] as const satisfies Readonly<Record<BootOption, string>>;

/** The widest values the catalogue can hold. */
const MAX_18_BITS = 0x3_ffff;
const MAX_10_BITS = 0x3ff;

export interface DfsFile {
  /** One character, e.g. "$". */
  readonly directory: string;
  /** 1-7 characters, trailing spaces removed. */
  readonly name: string;
  readonly locked: boolean;
  /** 18 bits, as stored: &31900 is shown as FF1900 (dfs-text.ts). */
  readonly load: number;
  /** 18 bits. */
  readonly exec: number;
  /** In bytes, 18 bits. */
  readonly length: number;
  /** 10 bits, counted across the side: sector n is track n ÷ 10, sector n mod 10. */
  readonly startSector: number;
}

export interface DfsCatalogue {
  /** Up to 12 characters. */
  readonly title: string;
  readonly cycle: number;
  readonly bootOption: BootOption;
  /** Sectors on this side: 400 (&190) for 40 tracks, 800 (&320) for 80. */
  readonly sectorCount: number;
  /** In catalogue order, which DFS keeps highest start sector first. */
  readonly files: readonly DfsFile[];
}

/** How many sectors a file of this many bytes occupies. */
export function fileSectors(length: number): number {
  return Math.ceil(length / SECTOR_SIZE);
}

/** "$.MANIC" */
export function fullName(file: Pick<DfsFile, 'directory' | 'name'>): string {
  return `${file.directory}.${file.name}`;
}

const hex = (n: number, digits: number): string => n.toString(16).toUpperCase().padStart(digits, '0');

/** Characters, with bit 7 stripped. Stops at the first NUL if stopAtNul. */
function text(bytes: Uint8Array, start: number, length: number, stopAtNul: boolean): string {
  let out = '';
  for (let i = start; i < start + length; i++) {
    const code = bytes[i] & 0x7f;
    if (code === 0 && stopAtNul) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function checkSector(sector: Uint8Array, which: string): void {
  if (sector.length !== SECTOR_SIZE) {
    throw new RangeError(`catalogue ${which} is ${String(sector.length)} bytes, not ${String(SECTOR_SIZE)}`);
  }
}

/**
 * The catalogue in sectors 0 and 1. Lenient: any characters are accepted.
 * Throws RangeError only if &105 can't be a file count (not a multiple of
 * 8, or more than 31 files), since then nothing else can be trusted.
 */
export function decodeCatalogue(sector0: Uint8Array, sector1: Uint8Array): DfsCatalogue {
  checkSector(sector0, 'sector 0');
  checkSector(sector1, 'sector 1');
  const countX8 = sector1[CAT_FILE_COUNT_X8];
  if (countX8 % ENTRY_SIZE !== 0) {
    throw new RangeError(`not a DFS catalogue: &105 is &${hex(countX8, 2)}: not a multiple of 8, so not a file count`);
  }
  // &F8 is the most a byte can say (31 × 8), so the count check is the multiple-of-8 one.
  const count = countX8 / ENTRY_SIZE;

  const titleBytes = new Uint8Array(TITLE_LENGTH);
  titleBytes.set(sector0.subarray(0, 8));
  titleBytes.set(sector1.subarray(CAT_TITLE_END, CAT_TITLE_END + 4), 8);
  const title = text(titleBytes, 0, TITLE_LENGTH, true).trimEnd();
  const optionByte = sector1[CAT_OPTION_SECTORS_HI];

  const files: DfsFile[] = [];
  for (let i = 0; i < count; i++) {
    const n = CAT_FIRST_ENTRY + i * ENTRY_SIZE;
    const at = (offset: number): number => sector1[n + offset];
    const dirByte = sector0[n + NAME_LENGTH];
    const mixed = at(6);
    files.push({
      directory: String.fromCharCode(dirByte & 0x7f),
      name: text(sector0, n, NAME_LENGTH, false).trimEnd(),
      locked: (dirByte & LOCKED_BIT) !== 0,
      load: (((mixed >> 2) & 3) << 16) | (at(1) << 8) | at(0),
      exec: (((mixed >> 6) & 3) << 16) | (at(3) << 8) | at(2),
      length: (((mixed >> 4) & 3) << 16) | (at(5) << 8) | at(4),
      startSector: ((mixed & 3) << 8) | at(7),
    });
  }
  return {
    title,
    cycle: sector1[CAT_CYCLE],
    bootOption: BOOT_OPTIONS[(optionByte >> 4) & 3] ?? 0,
    sectorCount: ((optionByte & 3) << 8) | sector1[CAT_SECTORS_LO],
    files,
  };
}

function checkWidth(value: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${what} &${hex(value, 1)} doesn't fit: the catalogue holds 0 to &${hex(max, 1)}`);
  }
}

/** Writes the 7-bit characters of s at start, padded to length with pad. */
function putText(bytes: Uint8Array, start: number, s: string, length: number, pad: number): void {
  for (let i = 0; i < length; i++) bytes[start + i] = i < s.length ? s.charCodeAt(i) & 0x7f : pad;
}

/**
 * The 512 bytes of sectors 0 and 1 for this catalogue, files in the order
 * given (the caller keeps them highest start sector first). Throws
 * RangeError for anything too wide for its field: nothing is masked away.
 * Characters aren't checked here (the reader is lenient, so this is too);
 * dfs-disc.ts's writer checks names before it gets this far.
 */
export function encodeCatalogue(catalogue: DfsCatalogue): Uint8Array {
  const { title, cycle, bootOption, sectorCount, files } = catalogue;
  if (title.length > TITLE_LENGTH) throw new RangeError(`title "${title}" is ${String(title.length)} characters: at most ${String(TITLE_LENGTH)}`);
  if (files.length > MAX_FILES) throw new RangeError(`${String(files.length)} files: a DFS catalogue holds at most ${String(MAX_FILES)}`);
  checkWidth(cycle, 0xff, 'cycle number');
  checkWidth(sectorCount, MAX_10_BITS, 'sector count');

  const bytes = new Uint8Array(CATALOGUE_SIZE);
  const s1 = SECTOR_SIZE;
  // Manic Miner pads its title with NULs, so we do too.
  putText(bytes, 0, title.slice(0, 8), 8, 0);
  putText(bytes, s1 + CAT_TITLE_END, title.slice(8), 4, 0);
  bytes[s1 + CAT_CYCLE] = cycle;
  bytes[s1 + CAT_FILE_COUNT_X8] = files.length * ENTRY_SIZE;
  bytes[s1 + CAT_OPTION_SECTORS_HI] = (bootOption << 4) | (sectorCount >> 8);
  bytes[s1 + CAT_SECTORS_LO] = sectorCount & 0xff;

  files.forEach((file, i) => {
    const name = fullName(file);
    if (file.name.length < 1 || file.name.length > NAME_LENGTH) throw new RangeError(`${name}: a name is 1 to ${String(NAME_LENGTH)} characters`);
    if (file.directory.length !== 1) throw new RangeError(`${name}: a directory is one character`);
    checkWidth(file.load, MAX_18_BITS, `${name} load address`);
    checkWidth(file.exec, MAX_18_BITS, `${name} exec address`);
    checkWidth(file.length, MAX_18_BITS, `${name} length`);
    checkWidth(file.startSector, MAX_10_BITS, `${name} start sector`);

    const n = CAT_FIRST_ENTRY + i * ENTRY_SIZE;
    putText(bytes, n, file.name, NAME_LENGTH, 0x20);
    bytes[n + NAME_LENGTH] = (file.directory.charCodeAt(0) & 0x7f) | (file.locked ? LOCKED_BIT : 0);
    const e = s1 + n;
    bytes[e] = file.load & 0xff;
    bytes[e + 1] = (file.load >> 8) & 0xff;
    bytes[e + 2] = file.exec & 0xff;
    bytes[e + 3] = (file.exec >> 8) & 0xff;
    bytes[e + 4] = file.length & 0xff;
    bytes[e + 5] = (file.length >> 8) & 0xff;
    bytes[e + 6] = (((file.exec >> 16) & 3) << 6) | (((file.length >> 16) & 3) << 4) | (((file.load >> 16) & 3) << 2) | ((file.startSector >> 8) & 3);
    bytes[e + 7] = file.startSector & 0xff;
  });
  return bytes;
}

/** "sectors &002-&004" (a file's first and last sector). */
function span(file: DfsFile): string {
  return `sectors &${hex(file.startSector, 3)}-&${hex(file.startSector + fileSectors(file.length) - 1, 3)}`;
}

/**
 * Things wrong with a catalogue that don't stop it being read: files past
 * the end of the disc or inside the catalogue, files sharing sectors, and
 * entries out of DFS's highest-start-first order. Empty for a good disc.
 */
export function catalogueProblems(catalogue: DfsCatalogue): string[] {
  const problems: string[] = [];
  const { files, sectorCount } = catalogue;
  files.forEach((file, i) => {
    const sectors = fileSectors(file.length);
    if (file.startSector < FIRST_FILE_SECTOR && sectors > 0) {
      problems.push(`${fullName(file)} starts at sector &${hex(file.startSector, 3)}, inside the catalogue (sectors 0 and 1)`);
    }
    if (file.startSector + sectors > sectorCount) {
      problems.push(`${fullName(file)} runs past the end of the disc: ${span(file)}, but the disc has &${hex(sectorCount, 3)} sectors`);
    }
    const previous = i > 0 ? files[i - 1] : undefined;
    if (previous !== undefined && file.startSector > previous.startSector) {
      problems.push(
        `entries are out of order: ${fullName(file)} (sector &${hex(file.startSector, 3)}) comes after ${fullName(previous)} ` +
          `(sector &${hex(previous.startSector, 3)}), but DFS keeps the highest start sector first`,
      );
    }
    for (const earlier of files.slice(0, i)) {
      const a = fileSectors(earlier.length);
      if (sectors === 0 || a === 0) continue;
      if (file.startSector < earlier.startSector + a && earlier.startSector < file.startSector + sectors) {
        problems.push(`${fullName(file)} (${span(file)}) overlaps ${fullName(earlier)} (${span(earlier)})`);
      }
    }
  });
  return problems;
}
