// A catalogue as text, the way DFS's *CAT and *INFO print it. Shared by the
// CLI demo and the browser's Disc panel.
//
// The content follows the DFS User Guide. The spacing is copied from what
// DFS 0.98 really prints in MODE 7 (Stage 50 ran it on four discs): two
// 20-column columns, "L" two spaces after a 7-character name, and the other
// directories as their own group after a blank line.

import { BOOT_OPTION_NAMES, fullName, type DfsCatalogue, type DfsFile } from './dfs-catalogue';

const hex = (n: number, digits: number): string => n.toString(16).toUpperCase().padStart(digits, '0');

/** *CAT prints this directory's files without their "$.". DFS's default after BREAK. */
const CURRENT_DIRECTORY = '$';
/** MODE 7's 40 columns hold two. */
const CAT_COLUMN = 20;

/**
 * An 18-bit catalogue address as *INFO shows it: bits 16-17 both set mean
 * &FFFFxxxx (the BBC itself, not a second processor), shown as FFxxxx.
 */
export function dfsAddress(address: number): string {
  return (address & 0x3_0000) === 0x3_0000 ? `FF${hex(address & 0xffff, 4)}` : hex(address, 6);
}

/** "$.MANIC   L  001900 00801F 000760 003" */
export function infoLine(file: DfsFile): string {
  return `${fullName(file).padEnd(9)} ${file.locked ? 'L' : ' '}  ${dfsAddress(file.load)} ${dfsAddress(file.exec)} ${hex(file.length, 6)} ${hex(file.startSector, 3)}`;
}

const byName = (a: DfsFile, b: DfsFile): number => {
  const x = a.name.toUpperCase();
  const y = b.name.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** *CAT's order: the current directory first, then the others by directory letter; names A-Z, ignoring case. */
export function sortedForCat(files: readonly DfsFile[]): DfsFile[] {
  const here = files.filter((f) => f.directory === CURRENT_DIRECTORY).sort(byName);
  const others = files
    .filter((f) => f.directory !== CURRENT_DIRECTORY)
    .sort((a, b) => (a.directory.toUpperCase() < b.directory.toUpperCase() ? -1 : a.directory.toUpperCase() > b.directory.toUpperCase() ? 1 : byName(a, b)));
  return [...here, ...others];
}

/** "    !BOOT    L" or "  E.EDITOR   L": a file in its *CAT column (DFS 0.98's spacing, seen in Stage 50). */
function catEntry(file: DfsFile): string {
  const prefix = file.directory === CURRENT_DIRECTORY ? '  ' : `${file.directory}.`;
  return `  ${prefix}${file.name.padEnd(7)}${file.locked ? '  L' : ''}`;
}

/** Entries two to a row, the second at CAT_COLUMN. */
function inRows(entries: readonly string[]): string[] {
  const rows: string[] = [];
  for (let i = 0; i < entries.length; i += 2) {
    const left = entries[i];
    rows.push((i + 1 < entries.length ? left.padEnd(CAT_COLUMN) + entries[i + 1] : left).trimEnd());
  }
  return rows;
}

/** The lines *CAT prints for this catalogue in drive `drive` (0, or 2 for side 1 of a dsd). */
export function catLines(catalogue: DfsCatalogue, drive: number): string[] {
  const d = String(drive);
  const lines = [
    `${catalogue.title} (${hex(catalogue.cycle, 2)})`,
    `${`Drive ${d}`.padEnd(CAT_COLUMN)}Option ${String(catalogue.bootOption)} (${BOOT_OPTION_NAMES[catalogue.bootOption]})`,
    `${`Directory :${d}.${CURRENT_DIRECTORY}`.padEnd(CAT_COLUMN)}Library :${d}.${CURRENT_DIRECTORY}`,
    '',
  ];
  // The current directory's files, then the others, each group starting its own row with a blank line between (DFS 0.98).
  const sorted = sortedForCat(catalogue.files);
  const here = inRows(sorted.filter((f) => f.directory === CURRENT_DIRECTORY).map(catEntry));
  const others = inRows(sorted.filter((f) => f.directory !== CURRENT_DIRECTORY).map(catEntry));
  lines.push(...here);
  if (here.length > 0 && others.length > 0) lines.push('');
  lines.push(...others);
  return lines;
}
