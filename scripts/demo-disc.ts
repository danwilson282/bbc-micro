// Stage 47 demo: disc image geometry.
//
//   npm run demo:disc                                       a tour (no files needed)
//   npm run demo:disc -- make-test                          writes out/geometry.ssd and out/geometry.dsd
//   npm run demo:disc -- sector <file> <track> <sector> [side]   hex dump one sector
//
// The format comes from the file's extension (.ssd or .dsd). Track, sector and
// side take decimal or &hex. The test images have every sector filled with its
// own name, so a dump shows at a glance whether the offset arithmetic is right.
// They're raw sectors, not DFS discs: there's no catalogue until Stage 48.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DiscImage,
  SECTOR_SIZE,
  SECTORS_PER_TRACK,
  formatFromName,
  maxImageSize,
  sectorOffset,
  type DiscFormat,
  type TrackCount,
} from '../src/disc/disc-image';
import { hexdump } from '../src/util/hexdump';

const OUT_DIR = 'out';

function heading(text: string): void {
  console.log('');
  console.log(text);
  console.log('-'.repeat(text.length));
}

/** Parses &hex, $hex, 0xhex or decimal. */
function parseNumber(text: string): number | undefined {
  const match = /^(&|\$|0x)?([0-9a-f]+)$/i.exec(text.trim());
  if (match === null) return undefined;
  const [, prefix = '', digits = ''] = match;
  if (prefix === '' && !/^[0-9]+$/.test(digits)) return undefined;
  return parseInt(digits, prefix === '' ? 10 : 16);
}

/** A file offset as &hex: five digits, since a dsd runs to &63FFF. */
const offset = (n: number): string => `&${n.toString(16).toUpperCase().padStart(5, '0')}`;

/** A full image whose every sector is filled with its own name, e.g. "SIDE 1 TRK 05 SEC 3 ". */
function geometryTestImage(format: DiscFormat, tracks: TrackCount): Uint8Array {
  const bytes = new Uint8Array(maxImageSize(format, tracks));
  const sides = format === 'ssd' ? 1 : 2;
  for (let side = 0; side < sides; side++) {
    for (let track = 0; track < tracks; track++) {
      for (let sector = 0; sector < SECTORS_PER_TRACK; sector++) {
        const label = `SIDE ${String(side)} TRK ${String(track).padStart(2, '0')} SEC ${String(sector)} `;
        const start = sectorOffset(format, side, track, sector);
        for (let i = 0; i < SECTOR_SIZE; i++) bytes[start + i] = label.charCodeAt(i % label.length);
      }
    }
  }
  return bytes;
}

function describe(image: DiscImage, name: string): string {
  const { format, sides, tracks } = image.geometry;
  const full = maxImageSize(format, tracks);
  const short = image.fileLength < full ? `, short: the file stops at ${offset(image.fileLength)}` : '';
  return `${name}: ${format}, ${String(sides)} side${sides === 1 ? '' : 's'}, ${String(tracks)} tracks, ${image.fileLength.toLocaleString('en-GB')} bytes${short}`;
}

function dumpSector(image: DiscImage, side: number, track: number, sector: number): void {
  const at = image.offsetOf(side, track, sector);
  const past = at >= image.fileLength ? '  (past the end of the file: reads as &00)' : '';
  console.log(`side ${String(side)} track ${String(track)} sector ${String(sector)} → file offset ${offset(at)}${past}`);
  const bytes = image.readSector(side, track, sector);
  // hexdump's addresses are the offsets within the sector, &00-&FF.
  console.log(hexdump({ read: (a) => bytes[a] ?? 0 }, 0, SECTOR_SIZE));
}

function tour(): void {
  heading('1. The same addresses in each format');
  console.log('   (side, track, sector)     ssd offset   dsd offset');
  for (const [side, track, sector] of [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [0, 5, 3],
    [1, 5, 3],
  ] as const) {
    const ssd = side === 0 ? offset(sectorOffset('ssd', side, track, sector)) : '  (none)';
    const dsd = offset(sectorOffset('dsd', side, track, sector));
    console.log(`   (${String(side)}, ${String(track).padStart(2)}, ${String(sector)})                ${ssd.padEnd(10)}   ${dsd}`);
  }
  console.log('   Note (0, 1, 0) in an ssd and (1, 0, 0) in a dsd: both at &00A00.');

  heading('2. Sizes: what each file length means');
  for (const [format, size] of [
    ['ssd', 102_400],
    ['ssd', 204_800],
    ['dsd', 204_800],
    ['dsd', 409_600],
    ['ssd', 20_480],
    ['ssd', 0],
    ['dsd', 409_601],
  ] as const) {
    try {
      console.log(`   ✓ ${describe(DiscImage.fromBytes(new Uint8Array(size), format, `the ${format} file`), `${format} of ${size.toLocaleString('en-GB')}`)}`);
    } catch (e) {
      console.log(`   ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  heading('3. Side 1, track 5, sector 3 of an 80-track geometry test dsd');
  const image = DiscImage.fromBytes(geometryTestImage('dsd', 80), 'dsd', 'test.dsd');
  dumpSector(image, 1, 5, 3);

  console.log('\nTry: npm run demo:disc -- make-test, then npm run demo:disc -- sector out/geometry.dsd 5 3 1');
}

function makeTest(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, format] of [
    ['geometry.ssd', 'ssd'],
    ['geometry.dsd', 'dsd'],
  ] as const) {
    const path = join(OUT_DIR, name);
    const bytes = geometryTestImage(format, 80);
    writeFileSync(path, bytes);
    console.log(`wrote ${path}: ${bytes.length.toLocaleString('en-GB')} bytes (80 tracks, ${format === 'ssd' ? '1 side' : '2 sides'})`);
  }
}

function sectorCommand(args: readonly string[]): void {
  // .at() is typed string | undefined; destructuring would claim string.
  const path = args.at(0);
  const trackArg = args.at(1);
  const sectorArg = args.at(2);
  const sideArg = args.at(3) ?? '0';
  const track = trackArg === undefined ? undefined : parseNumber(trackArg);
  const sector = sectorArg === undefined ? undefined : parseNumber(sectorArg);
  const side = parseNumber(sideArg);
  if (path === undefined || track === undefined || sector === undefined || side === undefined) {
    console.error('Usage: npm run demo:disc -- sector <file.ssd|file.dsd> <track> <sector> [side]');
    process.exit(1);
  }
  const format = formatFromName(path);
  if (format === undefined) {
    console.error(`${path}: the name must end .ssd or .dsd (the size alone can't say which layout it is)`);
    process.exit(1);
  }
  try {
    const image = DiscImage.fromBytes(readFileSync(path), format, path);
    console.log(describe(image, path));
    dumpSector(image, side, track, sector);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const command = args.at(0);
const rest = args.slice(1);
if (command === undefined) tour();
else if (command === 'make-test') makeTest();
else if (command === 'sector') sectorCommand(rest);
else {
  console.error(`Unknown command ${command}. Use: (nothing), make-test, or sector <file> <track> <sector> [side]`);
  process.exit(1);
}
