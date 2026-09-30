// The classic 16-bytes-per-row hex dump, for looking at memory.
//
//   7C00  48 45 4C 4C 4F 2C 20 42  42 43 20 4D 49 43 52 4F  |HELLO, BBC MICRO|
//
// Address, 16 bytes with an extra space after the eighth, then the same bytes
// as text. Only printable ASCII (&20-&7E) is shown as a character; everything
// else is '.'. Builds strings, so it's for display only, never the hot path.

import { hex16, hex8 } from './bits';

/** Anything we can read bytes from. A Bus fits, and so does a Ram. */
export interface ByteSource {
  read(address: number): number;
}

const BYTES_PER_ROW = 16;
const GROUP = 8; // extra space after this many bytes
// "XX " per byte, minus the trailing space, plus one for the mid-row gap: 48.
const HEX_COLUMN_WIDTH = BYTES_PER_ROW * 3 - 1 + 1;

function toAscii(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
}

/**
 * Dumps length bytes starting at start. Rows begin at start and step by 16.
 * Addresses wrap at &FFFF. Each byte is read exactly once, in address order,
 * which matters when the source is I/O and reads have side effects.
 */
export function hexdump(source: ByteSource, start: number, length: number): string {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`hexdump length must be a whole number >= 0, got ${String(length)}`);
  }
  const lines: string[] = [];
  for (let rowStart = 0; rowStart < length; rowStart += BYTES_PER_ROW) {
    const rowAddress = (start + rowStart) & 0xffff;
    const count = Math.min(BYTES_PER_ROW, length - rowStart);
    let hex = '';
    let ascii = '';
    for (let i = 0; i < count; i++) {
      const byte = source.read((rowAddress + i) & 0xffff) & 0xff;
      if (i > 0) hex += i === GROUP ? '  ' : ' ';
      hex += hex8(byte);
      ascii += toAscii(byte);
    }
    lines.push(`${hex16(rowAddress)}  ${hex.padEnd(HEX_COLUMN_WIDTH)}  |${ascii}|`);
  }
  return lines.join('\n');
}
