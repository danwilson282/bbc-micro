// Stage 02 demo: look at memory through the bus.
//
//   npm run demo:hexdump                 guided tour of a fresh 64K TestBus
//   npm run demo:hexdump -- &FFF0 16     also dump a range of your choice
//
// If roms/basic2.rom and roms/os12.rom exist, they're loaded into the flat
// test bus at &8000 and &C000 (as plain bytes: there's no ROM protection or
// paging yet) so you can see real ROM contents. If not, those steps are skipped.

import { existsSync, readFileSync } from 'node:fs';
import { hex16, word } from '../src/util/bits';
import { hexdump } from '../src/util/hexdump';
import { TestBus } from '../src/memory/test-bus';

const bus = new TestBus();

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

function loadRom(path: string, address: number, name: string): boolean {
  if (!existsSync(path)) {
    console.log(`(skipped: ${path} not found; put your ${name} ROM there to see it)`);
    return false;
  }
  bus.load(address, readFileSync(path));
  return true;
}

heading('1. Power on: fresh RAM is all &00');
console.log(hexdump(bus, 0x0000, 32));

heading('2. bus.write() a message into Mode 7 screen memory at &7C00');
const message = 'HELLO, BBC MICRO\rThe end.';
for (let i = 0; i < message.length; i++) bus.write(0x7c00 + i, message.charCodeAt(i));
console.log(hexdump(bus, 0x7c00, message.length));
console.log('(&0D, the carriage return, is not printable, so it shows as ".")');

heading('3. The bus masks: write(&17C20, &148) lands at &7C20 as &48');
bus.write(0x17c20, 0x148);
console.log(hexdump(bus, 0x7c20, 1));

heading('4. Addresses wrap: a dump from &FFF8 carries on at &0000');
bus.load(0xfffe, [0xaa, 0xbb, 0xcc, 0xdd]);
console.log(hexdump(bus, 0xfff8, 24));

heading('5. Your BASIC II ROM at &8000: its header has a readable title');
if (loadRom('roms/basic2.rom', 0x8000, 'BASIC II')) console.log(hexdump(bus, 0x8000, 32));

heading('6. Your MOS 1.20 ROM at &C000: the CPU vectors are its last 6 bytes');
if (loadRom('roms/os12.rom', 0xc000, 'MOS 1.20')) {
  console.log(hexdump(bus, 0xfff0, 16));
  const vector = (at: number): string => `&${hex16(word(bus.read(at), bus.read(at + 1)))}`;
  console.log(`  &FFFA NMI   = ${vector(0xfffa)}`);
  console.log(`  &FFFC RESET = ${vector(0xfffc)}   (bytes CD D9, low byte first)`);
  console.log(`  &FFFE IRQ   = ${vector(0xfffe)}`);
}

const args = process.argv.slice(2);
const startArg = args.at(0); // .at() is typed string | undefined; indexing would claim string
const lengthArg = args.at(1);
if (startArg !== undefined) {
  const start = parseNumber(startArg);
  const length = lengthArg === undefined ? 64 : parseNumber(lengthArg);
  if (start === undefined || length === undefined) {
    console.error(`Usage: npm run demo:hexdump -- [start] [length], e.g. '&FFF0' 16`);
    process.exit(1);
  }
  heading(`Your range: &${hex16(start)}, ${String(length)} bytes`);
  console.log(hexdump(bus, start, length));
}
