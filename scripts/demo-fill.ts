// Stage 14 demo: compares, branches, and the first real loop.
//
//   npm run demo:fill
//
// 1. CMP's three answers (less, equal, greater) as flags.
// 2. What a branch costs: 2, 3 or 4 cycles, measured on the emulated 6502.
// 3. The playground's fill example, Run a frame at a time exactly as the
//    workbench's Run button does it, until it stops at its BRK.

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { FILL_SOURCE } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8 } from '../src/util/bits';
import { playgroundTarget } from '../src/web/workbench/debug-target';
import { formatCycles } from '../src/web/workbench/registers-view-model';
import { RUN_START, advanceRun, describeRunState, type RunState } from '../src/web/workbench/run-model';

/** A bare CPU with bytes at start and PC on them. */
function cpuAt(start: number, bytes: readonly number[]): Cpu6502 {
  const bus = new TestBus();
  bus.load(0xfffc, [start & 0xff, start >> 8]);
  bus.load(start, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return cpu;
}

const bit = (flag: boolean): string => (flag ? '1' : '0');

console.log('Stage 14: compare & branch.');
console.log('');
console.log('1. CMP #&30 subtracts &30 from A, keeps the flags and throws the answer away:');
console.log('');
console.log('     A    A - &30    C  Z  N   so A is ...');
console.log('  ----   --------    -  -  -   -----------');
for (const a of [0x20, 0x30, 0x40, 0xff, 0x01]) {
  const cpu = cpuAt(0x0400, [0xc9, 0x30]); // CMP #&30
  cpu.regs.a = a;
  cpu.step();
  const { c, z, n } = cpu.regs;
  const verdict = z ? 'equal' : c ? 'greater' : 'less';
  const note = (a > 0x30) === n && !z ? '   (N=1 here, but A is bigger: use C, not N)' : '';
  console.log(`   &${hex8(a)}        &${hex8((a - 0x30) & 0xff)}    ${bit(c)}  ${bit(z)}  ${bit(n)}   ${verdict}${note}`);
}
console.log('');
console.log('   A is untouched every time: only the flags change.');

console.log('');
console.log('2. What a branch costs. BNE, measured on the emulated 6502:');
console.log('');
const cases = [
  { what: 'not taken (Z=1)', at: 0x0400, offset: 0x10, z: true },
  { what: 'taken, same page', at: 0x0400, offset: 0x10, z: false },
  { what: 'taken backwards, same page', at: 0x0411, offset: 0xfd, z: false },
  { what: 'taken into the next page', at: 0x04f0, offset: 0x20, z: false },
  { what: 'taken back across a page', at: 0x04fe, offset: 0xf0, z: false },
];
console.log('  BNE at   offset   next    lands on   cycles   case');
console.log('  ------   ------   -----   --------   ------   ----');
for (const c of cases) {
  const cpu = cpuAt(c.at, [0xd0, c.offset]);
  cpu.regs.z = c.z;
  const cycles = cpu.step();
  console.log(
    `  &${hex16(c.at)}   &${hex8(c.offset)}      &${hex16((c.at + 2) & 0xffff)}   &${hex16(cpu.regs.pc)}      ${String(cycles)}        ${c.what}`,
  );
}
console.log('');
console.log('   The offset is signed (&FD = -3, &F0 = -16) and counts from the NEXT instruction.');
console.log('   The page check compares the target with "next", not with the BNE itself.');

console.log('');
console.log('3. The fill example: fill screen memory &7C00-&7FFF with "A", wait, then "B" ... "Z".');
console.log('');
const result = assemble(FILL_SOURCE);
if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
for (const line of result.lines) {
  if (line.bytes.length === 0) continue;
  const bytes = line.bytes.map(hex8).join(' ');
  // Labels in a column of their own, as an assembler listing prints them.
  const match = /^(\w+:)\s*(.*)$/.exec(line.source);
  const label = match?.[1] ?? '';
  const code = match?.[2] ?? line.source;
  console.log(`  &${hex16(line.address)}  ${bytes.padEnd(9)} ${label.padEnd(7)}${code}`.trimEnd());
}

const bus = new TestBus();
installProgram(bus, result.lines, result.entry ?? 0x0400);
const target = playgroundTarget(bus);
target.reset();

console.log('');
console.log('Run, a frame (40,000 cycles = one 50 Hz video frame) at a time, as the Run button does:');
console.log('');
console.log('  frame   char at &7C00   char at &7FFF   cycles so far');
console.log('  -----   -------------   -------------   -------------');
const show = (frame: number, state: RunState): void => {
  const first = String.fromCharCode(bus.read(0x7c00));
  const last = String.fromCharCode(bus.read(0x7fff));
  console.log(`  ${String(frame).padStart(5)}   ${`"${first}"`.padStart(13)}   ${`"${last}"`.padStart(13)}   ${state.cycles.toLocaleString('en-GB').padStart(13)}`);
};
let state = RUN_START;
let frame = 0;
let lastFirst = -1;
let skipped = false;
while (state.end === undefined) {
  state = advanceRun(target, state);
  frame++;
  // One line each time the screen moves on to a new letter: A to C, then X to Z.
  const first = bus.read(0x7c00);
  if (first !== lastFirst || state.end !== undefined) {
    if (first <= 0x43 || first >= 0x58 || state.end !== undefined) show(frame, state);
    else if (!skipped) {
      console.log('    ...');
      skipped = true;
    }
    lastFirst = first;
  }
}
console.log('');
console.log(`  ${describeRunState(state, target.registers.pc)}`);
console.log(`  That's ${String(frame)} frames: on a real Model B this loop would take about ${(frame / 50).toFixed(1)} seconds.`);
console.log('');
console.log(`  Where the time went, per pass of the 26 (from the stage doc, checked by the tests):`);
console.log(`    fill four pages   ${formatCycles(11_311)}`);
console.log(`    the wait loop     ${formatCycles(328_705)}`);
console.log('');
console.log('  Row 0 of the Mode 7 screen (&7C00-&7C27) now reads:');
let row = '';
for (let i = 0; i < 40; i++) row += String.fromCharCode(bus.read(0x7c00 + i));
console.log(`    ${row}`);
