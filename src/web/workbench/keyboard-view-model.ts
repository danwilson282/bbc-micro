// The Keyboard panel's view model (Stage 34): the same 80 matrix positions
// arranged two ways.
//
//   the desk view    the Model B's keyboard as you see it, row by row
//   the matrix view  8 rows × 10 columns, as the wiring sees it
//
// Both are plain data. The panel builds one button per cap once, and only
// asks the Keyboard which are down on each refresh.

import { BBC_KEYS, MATRIX_COLUMNS, MATRIX_ROWS, bbcKey, isLinkPosition, keyColumn, keyNumber, keyRow, linkBit, type BbcKey, type Keyboard } from '../../devices/keyboard';
import { hex8 } from '../../util/bits';
import { pcKeysFor } from '../key-map';

/** A key on the desk view. width is in key widths (1 = a letter key). */
export interface KeyCap {
  readonly kind: 'key';
  readonly key: number;
  readonly legend: string;
  readonly shifted?: string;
  readonly width: number;
  /** "Key &48 (row 4, column 8). PC key: '". */
  readonly title: string;
}

/** BREAK: on the keyboard, but not in the matrix (it's wired to reset). */
export interface BreakCap {
  readonly kind: 'break';
  readonly width: number;
}

export type DeskCap = KeyCap | BreakCap;

/** A position in the matrix view. */
export interface MatrixCell {
  readonly key: number;
  readonly kind: 'key' | 'link';
  /** Short enough for a grid cell: "A", "ESC", "b7". */
  readonly label: string;
  readonly title: string;
}

/** The tooltip for a key: what it is, where it is in the matrix, and which PC key presses it. */
function keyTitle(key: BbcKey): string {
  const what = key.shifted === undefined ? key.legend : `${key.legend} (SHIFT: ${key.shifted})`;
  const pc = pcKeysFor(key.key);
  const pcText = pc.length === 0 ? 'No PC key: click it.' : `PC key: ${pc.join(' or ')}`;
  return `${what}, key &${hex8(key.key)} (row ${String(keyRow(key.key))}, column ${String(keyColumn(key.key))}). ${pcText}`;
}

function cap(name: string, width = 1): KeyCap {
  const key = BBC_KEYS.find((k) => k.name === name);
  if (key === undefined) throw new Error(`No BBC key called ${name}`);
  return { kind: 'key', key: key.key, legend: key.legend, ...(key.shifted === undefined ? {} : { shifted: key.shifted }), width, title: keyTitle(key) };
}

function caps(names: string): KeyCap[] {
  return names.split(' ').map((name) => cap(name));
}

/**
 * The Model B keyboard, top row to bottom, from photographs of one. The
 * widths are approximate: enough to look like the real thing.
 */
export const DESK_ROWS: readonly (readonly DeskCap[])[] = [
  [...caps('f0 f1 f2 f3 f4 f5 f6 f7 f8 f9'), { kind: 'break', width: 1 }],
  [cap('ESCAPE', 1.25), ...caps('1 2 3 4 5 6 7 8 9 0 - ^ \\ LEFT RIGHT')],
  [cap('TAB', 1.5), ...caps('Q W E R T Y U I O P @ [ _ UP DOWN')],
  [cap('CAPS LOCK', 1.25), cap('CTRL', 1.25), ...caps('A S D F G H J K L ; : ]'), cap('RETURN', 1.75)],
  [cap('SHIFT LOCK', 1.25), cap('SHIFT', 1.5), ...caps('Z X C V B N M , . /'), cap('SHIFT', 1.5), cap('DELETE', 1.25), cap('COPY')],
  [cap('SPACE', 8)],
];

/** Grid labels for keys whose names are too long for a cell. */
const SHORT_LABELS: ReadonlyMap<string, string> = new Map([
  ['SHIFT', 'SHF'], ['CTRL', 'CTL'], ['CAPS LOCK', 'CAPS'], ['SHIFT LOCK', 'SLCK'], ['RETURN', 'RET'],
  ['DELETE', 'DEL'], ['SPACE', 'SPC'], ['ESCAPE', 'ESC'], ['COPY', 'COPY'], ['TAB', 'TAB'],
]);

/** The matrix: cells[row][column]. Row 0, columns 2-9 are the links. */
export function matrixCells(): readonly (readonly MatrixCell[])[] {
  const rows: MatrixCell[][] = [];
  for (let row = 0; row < MATRIX_ROWS; row++) {
    const cells: MatrixCell[] = [];
    for (let column = 0; column < MATRIX_COLUMNS; column++) {
      const key = keyNumber(row, column);
      const found = bbcKey(key);
      if (found !== undefined) {
        cells.push({ key, kind: 'key', label: SHORT_LABELS.get(found.name) ?? found.legend, title: keyTitle(found) });
      } else if (isLinkPosition(key)) {
        const bit = linkBit(column);
        cells.push({ key, kind: 'link', label: `b${String(bit)}`, title: `Link: bit ${String(bit)} of &028F, read at reset. Lit = closed.` });
      }
    }
    rows.push(cells);
  }
  return rows;
}

/** "Down: SHIFT &00, A &41", in matrix order; links aren't listed. */
export function describeDown(keyboard: Keyboard): string {
  const down = BBC_KEYS.filter((key) => keyboard.isDown(key.key))
    .sort((a, b) => a.key - b.key)
    .map((key) => `${key.name} &${hex8(key.key)}`);
  return down.length === 0 ? 'No keys down.' : `Down: ${down.join(', ')}`;
}

/** IER bit 0: the System VIA's CA2 interrupt. */
const IER_CA2 = 0x01;

/**
 * The scan logic in words (Stage 35): who picks the column, whether the MOS
 * is waiting for a CA2 interrupt (IER bit 0) or scanning by itself, and
 * how many times CA2 has risen. `ier` is the System VIA's IER (&FE4E).
 */
export function describeScan(keyboard: Keyboard, ier: number): string {
  const who = keyboard.scanning ? 'Autoscan on' : `Autoscan off: the CPU picks column ${String(keyboard.scanColumn)}`;
  const ca2 = (ier & IER_CA2) !== 0 ? 'CA2 interrupt on: waiting for a key' : 'CA2 interrupt off: the MOS scans every 10 ms';
  return `${who} · ${ca2} · CA2 rises: ${keyboard.ca2Rises.toLocaleString('en-GB')}`;
}
