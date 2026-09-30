// Stage 01 demo: one number, many readings.
//
//   npm run demo:numbers                 edge values (&00, &7F, &80, &FF, ...)
//   npm run demo:numbers -- 200          one value
//   npm run demo:numbers -- &FB -5 %1010 0xD9CD 65536
//
// Values from -128 to 255 are treated as a byte (8 bits); anything else as a
// word (16 bits). Values outside the width are masked, and the demo says so.

import {
  bcdToBinary,
  binaryToBcd,
  hex16,
  hex8,
  hi,
  isValidBcd,
  lo,
  toSigned8,
} from '../src/util/bits';

const DEFAULT_VALUES = [0x00, 0x01, 42, 0x7f, 0x80, 200, 0xfb, 0xff, 0xd9cd] as const;

interface Row {
  readonly input: string;
  readonly value: number;
  readonly isByte: boolean;
  readonly wrapped: boolean;
}

/** Parses decimal, &hex, $hex, 0xhex or %binary (optionally negative). */
function parseNumber(text: string): number | undefined {
  const match = /^(-?)(&|\$|0x|%)?([0-9a-f]+)$/i.exec(text.trim());
  if (match === null) return undefined;
  const [, sign = '', prefix = '', digits = ''] = match;
  const radix = prefix === '' ? 10 : prefix === '%' ? 2 : 16;
  const valid = radix === 10 ? /^[0-9]+$/ : radix === 2 ? /^[01]+$/ : /^[0-9a-f]+$/i;
  if (!valid.test(digits)) return undefined;
  const n = parseInt(digits, radix);
  return sign === '-' ? -n : n;
}

function toRow(input: string, n: number): Row {
  const isByte = n >= -128 && n <= 0xff;
  const value = isByte ? n & 0xff : n & 0xffff;
  const wrapped = isByte ? n < 0 : n < 0 || n > 0xffff;
  return { input, value, isByte, wrapped };
}

function binary(row: Row): string {
  const bits = row.value.toString(2).padStart(row.isByte ? 8 : 16, '0');
  return bits.replace(/(.{4})(?=.)/g, '$1 '); // group into nibbles
}

function bcdEncode(row: Row): string {
  if (row.value > 99) return '- (>99)';
  return `&${hex8(binaryToBcd(row.value))}`;
}

function bcdDecode(row: Row): string {
  if (!row.isByte) return '-';
  if (!isValidBcd(row.value)) return 'invalid';
  return String(bcdToBinary(row.value));
}

const args = process.argv.slice(2);
const rows: Row[] = [];
if (args.length === 0) {
  for (const n of DEFAULT_VALUES) rows.push(toRow(String(n), n));
} else {
  for (const arg of args) {
    const n = parseNumber(arg);
    if (n === undefined) {
      console.error(`Can't read "${arg}". Try 200, &C8, 0xC8, %11001000 or -56.`);
      process.exit(1);
    }
    rows.push(toRow(arg, n));
  }
}

const headers = ['Decimal', 'Hex', 'Binary', 'Signed', 'In memory', 'As BCD', 'Read as BCD'];
const table = rows.map((row) => [
  String(row.value),
  row.isByte ? `&${hex8(row.value)}` : `&${hex16(row.value)}`,
  binary(row),
  row.isByte ? String(toSigned8(row.value)) : '-',
  row.isByte ? hex8(row.value) : `${hex8(lo(row.value))} ${hex8(hi(row.value))}`,
  bcdEncode(row),
  bcdDecode(row),
]);

const widths = headers.map((h, i) =>
  Math.max(h.length, ...table.map((cells) => (cells[i] ?? '').length)),
);
const line = (cells: readonly string[]): string =>
  cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();

console.log(line(headers));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const cells of table) console.log(line(cells));

const notes = rows.filter((r) => r.wrapped || r.input !== String(r.value));
if (notes.length > 0) {
  console.log('');
  for (const r of notes) {
    const how = r.wrapped
      ? `wrapped to ${r.isByte ? '8' : '16'} bits`
      : r.isByte ? 'a byte' : 'a word';
    console.log(`  ${r.input} → ${String(r.value)} (${how})`);
  }
}

console.log('');
console.log('Signed = two\'s complement (bytes only). In memory = little-endian, low byte first.');
console.log('As BCD = the number encoded as BCD (0-99 only). Read as BCD = the byte decoded as BCD.');
