// Stage 10 demo: the overflow truth table, worked out by running real ADC
// instructions, then a trace of the binary arithmetic example: a 16-bit
// addition, two signed overflows, and a 16-bit subtraction.
//
//   npm run demo:arith
//
// Same source as the browser playground's default example
// (src/playground/examples.ts), on the same set-up (src/playground/setup.ts).

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { WriteRecorder } from '../src/memory/write-recorder';
import { ARITHMETIC_SOURCE } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8, toSigned8 } from '../src/util/bits';

const flag = (on: boolean): string => (on ? '1' : '0');
const signed = (value: number): string => {
  const n = toSigned8(value);
  return (n < 0 ? String(n) : `+${String(n)}`).padStart(4);
};

// Part 1: the truth table. One ADC #m per row, on a fresh CPU with C=0.
console.log('Stage 10: binary arithmetic.');
console.log('');
console.log('The overflow truth table: each row is a real ADC #&nn, with C=0 going in.');
console.log('');
console.log('A7 M7 R7  A + M = R           signed            C  V');
console.log('-- -- --  ------------------  ----------------  -  -');
const ROWS: readonly (readonly [number, number])[] = [
  [0x50, 0x10],
  [0x50, 0x50],
  [0x50, 0xd0],
  [0x50, 0x90],
  [0xd0, 0x50],
  [0xd0, 0x10],
  [0xd0, 0x90],
  [0xd0, 0xd0],
];
for (const [a, m] of ROWS) {
  const bus = new TestBus();
  bus.load(0xfffc, [0x00, 0x04]);
  bus.load(0x0400, [0x69, m]); // ADC #m
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.regs.a = a;
  cpu.step();
  const r = cpu.regs.a;
  const bits = [a, m, r].map((x) => ` ${String(x >> 7)}`).join(' ');
  const sum = `&${hex8(a)} + &${hex8(m)} = &${hex8(r)}`;
  const meaning = `${signed(a)} ${signed(m)} = ${signed(r)}`;
  const mark = cpu.regs.v ? '  ← doesn’t fit' : '';
  console.log(`${bits}  ${sum.padEnd(18)}  ${meaning}  ${flag(cpu.regs.c)}  ${flag(cpu.regs.v)}${mark}`);
}
console.log('');
console.log('V=1 only when A and M have the same sign (A7 = M7) and the result R has the other one.');

// Part 2: the example program, one step per line.
const result = assemble(ARITHMETIC_SOURCE);
if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));

const bus = new TestBus();
installProgram(bus, result.lines, 0x0400);
const recorder = new WriteRecorder(bus);
const cpu = new Cpu6502(recorder);
cpu.reset();

const state = (): string => {
  const r = cpu.regs;
  return `A=${hex8(r.a)}  N=${flag(r.n)} V=${flag(r.v)} Z=${flag(r.z)} C=${flag(r.c)}`;
};
const pair = (address: number): string => `${hex8(bus.read(address))} ${hex8(bus.read(address + 1))}`;

console.log('');
console.log('The Stage 10 example: 1000 + 300 = 1300 in 16 bits, then 1300 - 1000 = 300.');
console.log('');
console.log('addr  bytes     source            cyc  after                       wrote');
console.log('----  --------  ----------------  ---  --------------------------  -----');
for (const line of result.lines) {
  recorder.clear();
  const cycles = cpu.step();
  const wrote = recorder
    .recorded()
    .map((w) => `&${hex16(w.address)}←${hex8(w.value)}`)
    .join(' ');
  const bytes = line.bytes.map(hex8).join(' ').padEnd(8);
  const source = line.source.replace(/^start:\s*/, '');
  console.log(`${hex16(line.address)}  ${bytes}  ${source.padEnd(16)}  ${String(cycles).padStart(3)}  ${state()}  ${wrote}`.trimEnd());
}
console.log('');
console.log(`sum  at &80/&81 = ${pair(0x80)}  →  &${hex8(bus.read(0x81))}${hex8(bus.read(0x80))}`);
console.log(`diff at &82/&83 = ${pair(0x82)}  →  &${hex8(bus.read(0x83))}${hex8(bus.read(0x82))}`);
