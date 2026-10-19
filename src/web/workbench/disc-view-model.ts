// What the Disc panel shows for a dropped disc image (Stage 48). Pure: bytes
// and a file name in, text out, so it's tested without a browser.
//
// It reads the catalogue, as `npm run demo:disc -- cat` does. Since Stage 51
// it can also view a disc already in a drive (discImageView), so the panel
// can show a SAVE as soon as the DFS has written it, and it describes each
// drive's row (driveRowView).

import type { DiscImage } from '../../disc/disc-image';
import { formatFromName, maxImageSize } from '../../disc/disc-image';
import { catalogueProblems, fileSectors, fullName, MAX_FILES, FIRST_FILE_SECTOR } from '../../disc/dfs-catalogue';
import { openDfsDisc, readCatalogue } from '../../disc/dfs-disc';
import { catLines, dfsAddress } from '../../disc/dfs-text';

export interface DiscFileRow {
  readonly name: string;
  readonly locked: boolean;
  readonly load: string;
  readonly exec: string;
  readonly length: string;
  readonly start: string;
  readonly sectors: number;
}

export interface DiscSideView {
  /** The DFS drive number: 0, or 2 for side 1 of a dsd (1 and 3 in the second drive). */
  readonly drive: number;
  /** Set if this side's catalogue couldn't be read; then the rest is empty. */
  readonly error: string | undefined;
  readonly catLines: readonly string[];
  /** In catalogue order: highest start sector first. */
  readonly files: readonly DiscFileRow[];
  readonly summary: string;
  readonly problems: readonly string[];
}

export type DiscView =
  | {
      readonly ok: true;
      readonly heading: string;
      readonly sides: readonly DiscSideView[];
      /** The disc itself, for a drive (Stage 50). */
      readonly image: DiscImage;
    }
  | { readonly ok: false; readonly error: string };

const hex = (n: number, digits: number): string => `&${n.toString(16).toUpperCase().padStart(digits, '0')}`;

/** The panel's view of a disc image file. Never throws: a bad file is { ok: false }. */
export function discView(bytes: Uint8Array, fileName: string): DiscView {
  const format = formatFromName(fileName);
  if (format === undefined) return { ok: false, error: `${fileName}: the name must end .ssd or .dsd (the size alone can't say which layout it is)` };
  let image;
  try {
    image = openDfsDisc(bytes, format, fileName);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return discImageView(image);
}

/**
 * The view of a disc that's already open, maybe in a drive (Stage 51):
 * `physicalDrive` 1 numbers its sides 1 and 3, as DFS does.
 */
export function discImageView(image: DiscImage, physicalDrive: 0 | 1 = 0): DiscView & { readonly ok: true } {
  const { format, sides, tracks } = image.geometry;
  const length = image.bytes().length;
  const short = length < maxImageSize(format, tracks) ? ` (short file: ${length.toLocaleString('en-GB')} bytes)` : '';
  const heading = `${image.name}: ${format}, ${sides === 1 ? 'single' : 'double'}-sided, ${String(tracks)} tracks${short}`;

  const views: DiscSideView[] = [];
  for (let side = 0; side < sides; side++) {
    const drive = side * 2 + physicalDrive;
    try {
      const cat = readCatalogue(image, side);
      const used = cat.files.reduce((sum, f) => sum + fileSectors(f.length), 0);
      const room = cat.sectorCount - FIRST_FILE_SECTOR;
      views.push({
        drive,
        error: undefined,
        catLines: catLines(cat, drive),
        files: cat.files.map((f) => ({
          name: fullName(f),
          locked: f.locked,
          load: dfsAddress(f.load),
          exec: dfsAddress(f.exec),
          length: hex(f.length, 4),
          start: hex(f.startSector, 3),
          sectors: fileSectors(f.length),
        })),
        summary: `${String(cat.files.length)} of ${String(MAX_FILES)} files · ${String(used)} of ${String(room)} sectors used · ${String(room - used)} free`,
        problems: catalogueProblems(cat),
      });
    } catch (e) {
      views.push({ drive, error: e instanceof Error ? e.message : String(e), catLines: [], files: [], summary: '', problems: [] });
    }
  }
  return { ok: true, heading, sides: views, image };
}

/** What a drive's row in the panel needs (a DiscDrive has it all). */
export interface PanelDrive {
  readonly disc: DiscImage | undefined;
  readonly writeProtected: boolean;
}

export interface DriveRowView {
  /** "Drive 0: demo.ssd", "Drive 1: empty". */
  readonly text: string;
  /** "changed: 768 bytes written", or '' if the disc is as it came (or there's none). */
  readonly changed: string;
  readonly hasDisc: boolean;
  readonly writeProtected: boolean;
  /** Download is worth offering once the DFS has written to the disc. */
  readonly downloadable: boolean;
}

/** One drive's row: the disc in it, whether it has changed, and its tab (Stage 51). */
export function driveRowView(drive: PanelDrive, n: 0 | 1): DriveRowView {
  const disc = drive.disc;
  if (disc === undefined) return { text: `Drive ${String(n)}: empty`, changed: '', hasDisc: false, writeProtected: false, downloadable: false };
  const writes = disc.changes;
  return {
    text: `Drive ${String(n)}: ${disc.name}`,
    changed: writes === 0 ? '' : `changed: ${writes.toLocaleString('en-GB')} bytes written`,
    hasDisc: true,
    writeProtected: drive.writeProtected,
    downloadable: writes > 0,
  };
}
