// Stage 12 demo: masks in binary, worked out by running real AND, ORA, EOR
// and BIT instructions, then a trace of the logic example with A in binary.
//
//   npm run demo:logic
//
// Same source as the browser playground's default example
// (src/playground/examples.ts), on the same set-up (src/playground/setup.ts).

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { LOGIC_SOURCE } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex8 } from '../src/util/bits';
import { formatBinary } from '../src/web/workbench/registers-view-model';

const flag = (on: boolean): string => (on ? '1' : '0');

/** Runs one `OP #m` (or `BIT &70` holding m) on a fresh CPU with A preset, and returns the CPU after. */
function run(bytes: readonly number[], a: number, m: number): Cpu6502 {
  const bus = new TestBus();
  bus.load(0xfffc, [0x00, 0x04]);
  bus.load(0x0400, bytes);
  bus.write(0x70, m);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.regs.a = a;
  cpu.step();
  return cpu;
}

console.log('Stage 12: logic & BIT.');
console.log('');
console.log('Masks. Each line is one real instruction, run on the emulated 6502.');
console.log('');
const MASKS: readonly (readonly [string, number, number, string])[] = [
  ['AND', 0xb5, 0x0f, 'clear: keep only the low nibble'],
  ['ORA', 0x05, 0xc0, 'set bits 7 and 6'],
  ['EOR', 0xc5, 0xff, 'flip all eight: NOT'],
  ['EOR', 0x3a, 0xff, 'flip them again: back where we started'],
  ['AND', 0xc5, 0x30, 'no 1s in common: Z=1'],
  ['EOR', 0x48, 0x20, '"H" → "h": swap case'],
  ['ORA', 0x45, 0x20, '"E" → "e": force lower case'],
  ['AND', 0x68, 0xdf, '"h" → "H": force upper case'],
];
const IMMEDIATE: Readonly<Record<string, number>> = { AND: 0x29, ORA: 0x09, EOR: 0x49 };
for (const [op, a, m, note] of MASKS) {
  const cpu = run([IMMEDIATE[op] ?? 0xea, m], a, m);
  const r = cpu.regs;
  console.log(`   ${formatBinary(a)}   &${hex8(a)}`);
  console.log(`   ${formatBinary(m)}   &${hex8(m)}  ${op} #&${hex8(m)}    ${note}`);
  console.log('   ----------');
  console.log(`   ${formatBinary(r.a)}   &${hex8(r.a)}  N=${flag(r.n)} Z=${flag(r.z)}`);
  console.log('');
}

console.log('BIT &70: Z from A AND M (thrown away), N and V from bits 7 and 6 of M. A never changes.');
console.log('');
console.log('A           M           A AND M     A after  Z  N  V');
console.log('----------  ----------  ----------  -------  -  -  -');
const BITS: readonly (readonly [number, number])[] = [
  [0x01, 0xc1],
  [0x02, 0xc1],
  [0x00, 0xc0],
  [0xff, 0x20],
  [0xff, 0x40],
];
for (const [a, m] of BITS) {
  const r = run([0x24, 0x70], a, m).regs; // BIT &70
  console.log(`${formatBinary(a)}  ${formatBinary(m)}  ${formatBinary(a & m)}  &${hex8(r.a)}      ${flag(r.z)}  ${flag(r.n)}  ${flag(r.v)}`);
}

// The example program, one step per line.
const result = assemble(LOGIC_SOURCE);
if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
const bus = new TestBus();
installProgram(bus, result.lines, 0x0400);
const cpu = new Cpu6502(bus);
cpu.reset();

console.log('');
console.log('The Stage 12 example, one instruction per line:');
console.log('');
console.log('source              A                 N V Z');
console.log('------------------  ---------------   - - -');
for (const line of result.lines) {
  cpu.step();
  const r = cpu.regs;
  const source = line.source.replace(/^start:\s*/, '');
  console.log(`${source.padEnd(18)}  &${hex8(r.a)} ${formatBinary(r.a)}   ${flag(r.n)} ${flag(r.v)} ${flag(r.z)}`);
}
const text = String.fromCharCode(...Array.from({ length: 16 }, (_, i) => bus.read(0x7c00 + i)));
console.log('');
console.log(`Screen row 0 at &7C00 now reads: "${text}"`);
