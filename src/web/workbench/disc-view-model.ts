// What the Disc panel shows for a dropped disc image (Stage 48). Pure: bytes
// and a file name in, text out, so it's tested without a browser.
//
// The disc isn't in a drive: there's no 8271 until Stages 49-50. This only
// reads the catalogue, as `npm run demo:disc -- cat` does.

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
  /** 0, or 2 for side 1 of a dsd. */
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
  | { readonly ok: true; readonly heading: string; readonly sides: readonly DiscSideView[] }
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
  const { sides, tracks } = image.geometry;
  const short = image.fileLength < maxImageSize(format, tracks) ? ` (short file: ${image.fileLength.toLocaleString('en-GB')} bytes)` : '';
  const heading = `${fileName}: ${format}, ${sides === 1 ? 'single' : 'double'}-sided, ${String(tracks)} tracks${short}`;

  const views: DiscSideView[] = [];
  for (let side = 0; side < sides; side++) {
    const drive = side * 2;
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
  return { ok: true, heading, sides: views };
}
