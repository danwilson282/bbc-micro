// The sideways ROM header: the bytes every paged ROM starts with, so the MOS
// can tell what it is (Advanced User Guide, paged ROMs: "ROM format").
//
//   &8000  3 bytes  language entry (code: the MOS jumps here)
//   &8003  3 bytes  service entry  (code: the MOS calls here)
//   &8006  ROM type: bit 7 service entry, bit 6 language entry,
//                    bit 5 relocation address, bit 4 Electron keys,
//                    bits 3-0 what the code is for (0 = 6502 BASIC, 2 = 6502 code, ...)
//   &8007  copyright offset: &8000 + this holds the &00 before "(C)"
//   &8008  binary version number
//   &8009  title, &00, [version string, &00], then at the copyright offset:
//          &00 "(C)..." &00, [4-byte relocation address if bit 5]
//
// The parser reads through a peek function, so the same code reads a file's
// bytes in a test and the live machine through ROMSEL.

import { hex8, hex16 } from '../util/bits';
import { ROM_SIZE, SIDEWAYS_START } from './memory-regions';

/** Reads one byte of the sideways window, &8000-&BFFF. */
export type RomPeek = (address: number) => number;

/** Header offsets from &8000 (Advanced User Guide, ROM format). */
export const ROM_LANGUAGE_ENTRY = 0x00;
export const ROM_SERVICE_ENTRY = 0x03;
export const ROM_TYPE = 0x06;
export const ROM_COPYRIGHT_OFFSET = 0x07;
export const ROM_BINARY_VERSION = 0x08;
export const ROM_TITLE = 0x09;

/** ROM type byte bits (Advanced User Guide, ROM type). */
export const ROM_TYPE_SERVICE = 0x80;
export const ROM_TYPE_LANGUAGE = 0x40;
export const ROM_TYPE_RELOCATION = 0x20;
export const ROM_TYPE_ELECTRON_KEYS = 0x10;
export const ROM_TYPE_CPU_MASK = 0x0f;

/** "(C)": what the MOS expects straight after the &00 at the copyright offset. */
const COPYRIGHT_MARK = [0x28, 0x43, 0x29] as const;

/** Bits 3-0 of the type byte (Advanced User Guide; BeebWiki "Paged ROM"). */
const CPU_NAMES: Readonly<Partial<Record<number, string>>> = {
  0: '6502 BASIC',
  2: '6502 code',
  3: '68000',
  8: 'Z80',
  9: '32016',
};

export interface RomHeader {
  /** The raw type byte at &8006. */
  readonly type: number;
  readonly hasServiceEntry: boolean;
  readonly hasLanguageEntry: boolean;
  readonly hasRelocationAddress: boolean;
  readonly hasElectronKeys: boolean;
  /** Type bits 3-0. */
  readonly cpuType: number;
  readonly cpuName: string;
  /** The raw byte at &8007. */
  readonly copyrightOffset: number;
  /** The raw byte at &8008. */
  readonly binaryVersion: number;
  readonly title: string;
  /** The optional text between the title and the copyright, or undefined. */
  readonly versionString: string | undefined;
  /** From "(C)" up to its &00, bytes as they are (BASIC's ends in LF CR). */
  readonly copyright: string;
  /** The 32-bit second processor address after the copyright, if type bit 5 is set. */
  readonly relocationAddress: number | undefined;
}

export type RomHeaderResult = { readonly ok: true; readonly header: RomHeader } | { readonly ok: false; readonly reason: string };

/** A name for type bits 3-0. */
export function romCpuName(cpuType: number): string {
  const n = cpuType & ROM_TYPE_CPU_MASK;
  return CPU_NAMES[n] ?? `code type ${String(n)}`;
}

/** The type byte in words, e.g. &60 → "language, relocation address; 6502 BASIC". */
export function describeRomType(type: number): string {
  const parts: string[] = [];
  if (type & ROM_TYPE_SERVICE) parts.push('service');
  if (type & ROM_TYPE_LANGUAGE) parts.push('language');
  if (type & ROM_TYPE_RELOCATION) parts.push('relocation address');
  if (type & ROM_TYPE_ELECTRON_KEYS) parts.push('Electron keys');
  return `${parts.length > 0 ? parts.join(', ') : 'no entries'}; ${romCpuName(type)}`;
}

/**
 * Reads the header of whatever is paged in at &8000, the way the MOS decides
 * a ROM is there: the bytes at &8000 + copyright offset must be &00 ( C ).
 */
export function parseRomHeader(peek: RomPeek): RomHeaderResult {
  const at = (offset: number): number => peek(SIDEWAYS_START + offset) & 0xff;
  const type = at(ROM_TYPE);
  const copyrightOffset = at(ROM_COPYRIGHT_OFFSET);
  const copyrightAddress = SIDEWAYS_START + copyrightOffset;
  const markOk = at(copyrightOffset) === 0x00 && COPYRIGHT_MARK.every((b, i) => at(copyrightOffset + 1 + i) === b);
  if (!markOk) {
    return { ok: false, reason: `no "(C)" at &${hex16(copyrightAddress)} (copyright offset &${hex8(copyrightOffset)}): not a ROM` };
  }
  if (copyrightOffset < ROM_TITLE) {
    return { ok: false, reason: `copyright offset &${hex8(copyrightOffset)} points inside the fixed header` };
  }

  // The title runs from &8009 to a &00. If that &00 is the copyright's own
  // &00, there's no version string; otherwise the version follows it.
  const title = readString(at, ROM_TITLE, copyrightOffset);
  const titleEnd = ROM_TITLE + title.length;
  const versionString = titleEnd < copyrightOffset ? readString(at, titleEnd + 1, copyrightOffset) : undefined;
  const copyright = readString(at, copyrightOffset + 1, ROM_SIZE);

  let relocationAddress: number | undefined;
  if (type & ROM_TYPE_RELOCATION) {
    const r = copyrightOffset + 1 + copyright.length + 1; // past the copyright's &00
    // * not <<: a shift would make the top byte negative.
    relocationAddress = at(r) + at(r + 1) * 0x100 + at(r + 2) * 0x10000 + at(r + 3) * 0x1000000;
  }

  return {
    ok: true,
    header: {
      type,
      hasServiceEntry: (type & ROM_TYPE_SERVICE) !== 0,
      hasLanguageEntry: (type & ROM_TYPE_LANGUAGE) !== 0,
      hasRelocationAddress: (type & ROM_TYPE_RELOCATION) !== 0,
      hasElectronKeys: (type & ROM_TYPE_ELECTRON_KEYS) !== 0,
      cpuType: type & ROM_TYPE_CPU_MASK,
      cpuName: romCpuName(type),
      copyrightOffset,
      binaryVersion: at(ROM_BINARY_VERSION),
      title,
      versionString,
      copyright,
      relocationAddress,
    },
  };
}

/** Bytes from `start` up to (not including) a &00, or `limit`, as characters. */
function readString(at: (offset: number) => number, start: number, limit: number): string {
  let s = '';
  for (let o = start; o < limit && o < ROM_SIZE; o++) {
    const b = at(o);
    if (b === 0x00) break;
    s += String.fromCharCode(b);
  }
  return s;
}

export interface RomSpec {
  readonly type: number;
  readonly binaryVersion?: number;
  readonly title: string;
  readonly version?: string;
  /** Must start with "(C)", or the MOS wouldn't accept the ROM. */
  readonly copyright: string;
  /** Written after the copyright string. Set type bit 5 too. */
  readonly relocationAddress?: number;
}

/**
 * A 16K image with a valid header and nothing else: RTS (&60) at both entries,
 * so calling it just returns, and &FF (erased EPROM) after the header.
 * For tests and demos.
 */
export function buildRomImage(spec: RomSpec): Uint8Array {
  if (!spec.copyright.startsWith('(C)')) throw new RangeError(`copyright "${spec.copyright}" must start with "(C)"`);
  const bytes: number[] = [0x60, 0x00, 0x00, 0x60, 0x00, 0x00, spec.type & 0xff, 0x00, (spec.binaryVersion ?? 0) & 0xff];
  const text = (s: string): void => {
    for (const ch of s) bytes.push(ch.charCodeAt(0) & 0xff);
  };
  text(spec.title);
  if (spec.version !== undefined) {
    bytes.push(0x00);
    text(spec.version);
  }
  bytes[ROM_COPYRIGHT_OFFSET] = bytes.length; // the &00 below
  bytes.push(0x00);
  text(spec.copyright);
  bytes.push(0x00);
  if (spec.relocationAddress !== undefined) {
    const r = spec.relocationAddress;
    bytes.push(r & 0xff, (r >>> 8) & 0xff, (r >>> 16) & 0xff, (r >>> 24) & 0xff);
  }
  if (bytes.length > 0x100) throw new RangeError('header too long: the copyright offset is one byte');
  const image = new Uint8Array(ROM_SIZE).fill(0xff);
  image.set(bytes);
  return image;
}
