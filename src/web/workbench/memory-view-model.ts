// The memory panel's view-model: pure functions that decide what to show.
//
//   7C00  48 45 4C 4C 4F 2C 20 42 42 43 20 4D 49 43 52 4F  HELLO, BBC MICRO
//
// Rows are 16 bytes, aligned so each row's address ends in 0. The panel shows
// one page (&100 bytes = 16 rows) at a time. Addresses wrap at &FFFF, like the
// 16-line address bus. No DOM here: memory-panel.ts turns this data into
// elements, and Jest tests this file directly.

import { hex16, hex8 } from '../../util/bits';
import { toAscii } from '../../util/hexdump';
import type { DebugTarget } from './debug-target';

export const BYTES_PER_ROW = 16;
/** One 6502 page: the high byte of an address picks the page. */
export const PAGE_SIZE = 0x100;
export const ROWS_PER_PAGE = PAGE_SIZE / BYTES_PER_ROW;

export interface MemoryCell {
  readonly address: number;
  readonly value: number;
  /** Two upper-case hex digits, e.g. "A9". */
  readonly hex: string;
  /** True if the byte differs from the previous view of the same addresses. */
  readonly changed: boolean;
  /** True if this is the byte the CPU's PC points at (the next opcode). */
  readonly isPc: boolean;
}

export interface MemoryRow {
  readonly address: number;
  /** Four hex digits, e.g. "7C00". */
  readonly label: string;
  readonly cells: readonly MemoryCell[];
  /** Printable ASCII (&20-&7E) as itself, everything else as ".". */
  readonly ascii: string;
}

export interface MemoryView {
  readonly start: number;
  readonly rows: readonly MemoryRow[];
}

/** The start of the 16-byte row containing address: &7C1D → &7C10. */
export function rowStart(address: number): number {
  return address & 0xfff0;
}

/** Moves a view start by whole pages, wrapping at the ends of 64K. */
export function stepPage(start: number, pages: number): number {
  return (start + pages * PAGE_SIZE) & 0xffff;
}

/**
 * Builds rowCount rows starting at the row containing start. Reads each byte
 * once, through peek(). If previous started at the same address, cells whose
 * value differs from it are marked changed. If pc is given, that cell is
 * marked isPc.
 */
export function buildMemoryView(
  target: DebugTarget,
  start: number,
  rowCount: number,
  previous?: MemoryView,
  pc?: number,
): MemoryView {
  const aligned = rowStart(start);
  const comparable = previous?.start === aligned ? previous : undefined;
  const rows: MemoryRow[] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowAddress = (aligned + r * BYTES_PER_ROW) & 0xffff;
    const oldCells = comparable?.rows[r]?.cells;
    const cells: MemoryCell[] = [];
    let ascii = '';
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      const address = (rowAddress + i) & 0xffff;
      const value = target.peek(address) & 0xff;
      const old = oldCells?.[i];
      cells.push({
        address,
        value,
        hex: hex8(value),
        changed: old !== undefined && old.value !== value,
        isPc: address === pc,
      });
      ascii += toAscii(value);
    }
    rows.push({ address: rowAddress, label: hex16(rowAddress), cells, ascii });
  }
  return { start: aligned, rows };
}

/**
 * Parses hex typed by a person: bare ("48"), BBC ("&48"), assembler ("$48")
 * or JS ("0x48"), with up to maxDigits digits. Returns undefined rather than
 * masking, because "123" in a byte field is a typo, not a request for &23.
 */
function parseHex(text: string, maxDigits: number): number | undefined {
  const match = /^(?:&|\$|0x)?([0-9a-f]+)$/i.exec(text.trim());
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  const value = parseInt(digits, 16);
  // Allow leading zeros ("0048") but not values too wide for the field.
  return value < 16 ** maxDigits ? value : undefined;
}

/** A byte, &00-&FF, or undefined if the text isn't one. */
export function parseHexByte(text: string): number | undefined {
  return parseHex(text, 2);
}

/** An address, &0000-&FFFF, or undefined if the text isn't one. */
export function parseHexAddress(text: string): number | undefined {
  return parseHex(text, 4);
}
