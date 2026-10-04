// Stage 11 demo: a BCD score counter. The same two instructions, ADC #&01 and
// STA score, run 100 times with D set and then with D clear, so you can see
// decimal and binary counting side by side. Then a table of decimal ADCs that
// shows the NMOS flag quirks, each one run on the emulated CPU.
//
//   npm run demo:score
//
// There are no branches until Stage 14, so this script is the loop: after each
// STA it puts PC back on the ADC.

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { installProgram } from '../src/playground/setup';
import { hex8 } from '../src/util/bits';

const flag = (on: boolean): string => (on ? '1' : '0');

/** The counter. The first line is SED or CLD, so the only difference is D. */
function counterSource(modeLine: 'SED' | 'CLD'): string {
  return `score = &80
        *= &0400
start:  ${modeLine}
lap:    ADC #&01
        STA score
`;
}

interface Count {
  /** The score after each of the 100 laps. */
  readonly scores: readonly number[];
  readonly cpu: Cpu6502;
}

function count(modeLine: 'SED' | 'CLD'): Count {
  const result = assemble(counterSource(modeLine));
  if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
  const lap = result.symbols.get('lap');
  if (lap === undefined) throw new Error('no lap label');

  const bus = new TestBus();
  installProgram(bus, result.lines, 0x0400);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.step(); // SED or CLD
  const scores: number[] = [];
  for (let i = 0; i < 100; i++) {
    cpu.regs.pc = lap; // the loop that Stage 14's branches will do for real
    cpu.step(); // ADC #&01
    cpu.step(); // STA score
    scores.push(bus.read(0x80));
  }
  return { scores, cpu };
}

const decimal = count('SED');
const binary = count('CLD');

console.log('Stage 11: decimal mode.');
console.log('');
console.log('A score counter: ADC #&01, STA score, 100 times. Each grid shows the');
console.log('byte at &80 after each lap, as hex, the way the memory panel shows it.');
console.log('');
console.log('  SED (decimal)                    CLD (binary)');
for (let row = 0; row < 10; row++) {
  const line = (scores: readonly number[]): string => scores.slice(row * 10, row * 10 + 10).map(hex8).join(' ');
  console.log(`  ${line(decimal.scores)}    ${line(binary.scores)}`);
}
console.log('');
console.log('Decimal skips &0A-&0F, &1A-&1F, ...: every byte reads as its decimal value.');
console.log('Binary uses all 16 values per digit, so 100 laps reach &64.');
const r = decimal.cpu.regs;
console.log('');
console.log(`Lap 100 in decimal: &99 + &01 → A=&${hex8(r.a)} with C=${flag(r.c)}: the hundred has gone into C.`);
console.log(`But N=${flag(r.n)} and Z=${flag(r.z)}, although A is zero. That's the NMOS quirk below.`);

// The quirk table: one ADC #m per row, on a fresh CPU with D=1.
const ROWS: readonly (readonly [number, number, boolean, string])[] = [
  [0x09, 0x01, false, 'low digit fixed up'],
  [0x58, 0x46, false, 'both digits fixed up: 104'],
  [0x99, 0x01, false, 'A=00 but Z=0 and N=1'],
  [0x80, 0x80, false, 'A=60 but Z=1'],
  [0x79, 0x00, true, 'V=1 from the half-fixed &80'],
  [0x0f, 0x00, false, 'invalid BCD'],
  [0x1a, 0x00, false, 'invalid BCD'],
];

console.log('');
console.log('Decimal ADC #&nn on the emulated NMOS 6502. A and C are the decimal answer.');
console.log('N and V come from the sum half-way through the fix-up, and Z from the binary sum.');
console.log('');
console.log('A  + M  + C   A   C  N V Z   binary sum   note');
console.log('--   --   -   --  -  - - -   ----------   ----');
for (const [a, m, c, note] of ROWS) {
  const bus = new TestBus();
  bus.load(0xfffc, [0x00, 0x04]);
  bus.load(0x0400, [0x69, m]); // ADC #m
  const cpu = new Cpu6502(bus);
  cpu.reset();
  Object.assign(cpu.regs, { a, c, d: true });
  cpu.step();
  const q = cpu.regs;
  const sum = a + m + (c ? 1 : 0);
  const binarySum = sum > 0xff ? `&${sum.toString(16).toUpperCase()}` : `&${hex8(sum)}`;
  console.log(`${hex8(a)} + ${hex8(m)} + ${flag(c)}   ${hex8(q.a)}  ${flag(q.c)}  ${flag(q.n)} ${flag(q.v)} ${flag(q.z)}   ${binarySum.padEnd(10)}   ${note}`);
}
