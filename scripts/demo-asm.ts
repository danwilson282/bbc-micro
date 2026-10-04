// Stage 08 demo: assemble a file (or the Stage 08 example) and print the
// listing: address, bytes, source, comment. Errors print with line numbers.
//
//   npm run demo:asm                  # the labels example
//   npm run demo:asm -- prog.asm      # your own file
//   npm run demo:asm -- --example stores

import { readFileSync } from 'node:fs';
import { assemble, formatError } from '../src/asm/assembler';
import { findExample } from '../src/playground/examples';
import { hex16, hex8 } from '../src/util/bits';

const args = process.argv.slice(2);
const exampleFlag = args.indexOf('--example');
const path = exampleFlag === -1 ? args[0] : undefined;
const example = findExample(exampleFlag === -1 ? null : (args[exampleFlag + 1] ?? null));
const name = path ?? `example "${example.id}"`;
const source = path === undefined ? example.source : readFileSync(path, 'utf8');

const result = assemble(source);
if (!result.ok) {
  console.log(`${name}: ${String(result.errors.length)} error(s)`);
  for (const error of result.errors) {
    console.log(`  ${formatError(error)}`);
    console.log(`      ${error.text.trim()}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Assembled ${name}`);
  console.log('');
  console.log('addr  bytes     source                   ; comment');
  console.log('----  --------  -----------------------  ---------');
  for (const line of result.lines) {
    // .byte/.word lines can be long: wrap their bytes 3 to a row.
    for (let i = 0; i < line.bytes.length; i += 3) {
      const chunk = line.bytes.slice(i, i + 3).map(hex8).join(' ').padEnd(8);
      const text = i === 0 ? `${line.source.padEnd(23)}${line.comment === '' ? '' : `  ; ${line.comment}`}` : '';
      console.log(`${hex16(line.address + i)}  ${chunk}  ${text}`.trimEnd());
    }
  }
  console.log('');
  const bytes = result.lines.reduce((n, l) => n + l.bytes.length, 0);
  console.log(`${String(bytes)} bytes. Entry: ${result.entry === undefined ? 'none' : `&${hex16(result.entry)}`}`);
  console.log(`Labels: ${[...result.symbols].map(([k, v]) => `${k}=&${v > 0xff ? hex16(v) : hex8(v)}`).join('  ')}`);
}
