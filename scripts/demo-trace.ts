// Stage 18 demo: traces.
//
//   npm run demo:trace                  the Stage 18 example, traced, then a bug hunt
//   npm run demo:trace -- subroutines   trace any example by its id instead
//
// Part 1 prints every step of an assembled program as a trace line (the state
// BEFORE each step, so an instruction's result is on the next line), then
// compares the source listing, memory now and the trace at one address.
//
// Part 2 shows what traces are for. It runs the Stage 16 multiply program on our
// CPU, and again on a CPU with a planted bug, diffs the two traces, and prints
// the first line where they differ.

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { disassemble } from '../src/cpu/disassembler';
import { TRACE_HEADER, Tracer, formatTraceLine } from '../src/cpu/trace';
import { TestBus } from '../src/memory/test-bus';
import { SUBROUTINES_SOURCE, findExample } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8, word } from '../src/util/bits';
import { labelsFromSymbols } from '../src/web/workbench/disassembly-view-model';

const BRK = 0x00;
const ROR_A = 0x6a;
/** Stop a program that never reaches a BRK. */
const STEP_LIMIT = 5000;

interface Run {
  readonly bus: TestBus;
  readonly cpu: Cpu6502;
  readonly tracer: Tracer;
  readonly labels: ReadonlyMap<number, string>;
  readonly lines: readonly { readonly address: number; readonly bytes: readonly number[]; readonly source: string }[];
}

/**
 * Assembles source, installs it as the playground does, and runs it traced
 * until PC reaches a BRK (Run stops there too). bug, if given, runs after each step: Part 2 plants one with it.
 */
function run(source: string, bug?: (cpu: Cpu6502, opcode: number, carryBefore: boolean) => void): Run {
  const result = assemble(source);
  if (!result.ok) {
    console.error(result.errors.map(formatError).join('\n'));
    process.exit(1);
  }
  const bus = new TestBus();
  installProgram(bus, result.lines, result.entry ?? 0x0400);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  const tracer = new Tracer((a) => bus.read(a), 4096);
  for (let i = 0; i < STEP_LIMIT && bus.read(cpu.regs.pc) !== BRK; i++) {
    const opcode = bus.read(cpu.regs.pc);
    const carry = cpu.regs.c;
    tracer.record(cpu);
    cpu.step();
    bug?.(cpu, opcode, carry);
  }
  return { bus, cpu, tracer, labels: labelsFromSymbols(result.symbols), lines: result.lines };
}

// --- Part 1: a trace ----------------------------------------------------------

const exampleId = process.argv[2] ?? 'trace';
const example = findExample(exampleId);
const traced = run(example.source);
const entries = traced.tracer.recent(traced.tracer.capacity);

console.log(`Stage 18: a trace of "${example.title}".`);
console.log('One line per step. A X Y S and the flags are the state BEFORE the step: read an instruction’s');
console.log('result on the line below it. Flags: capital = 1. Bits 5 and 4 are "-": the 6502 doesn’t store them.');
console.log('');
console.log(TRACE_HEADER);
for (const entry of entries) console.log(formatTraceLine(entry, traced.labels));
const pc = traced.cpu.regs.pc;
console.log(`        &${hex16(pc)}  ${hex8(traced.bus.read(pc))}        ${disassemble((a) => traced.bus.read(a), pc).text.padEnd(18)}← stop: Run stops before a BRK`);
console.log('');
console.log(`${String(traced.tracer.recorded)} steps, ${String(traced.cpu.cycles - 7)} cycles after the 7-cycle reset.`);

if (exampleId === 'trace') {
  const store = 0x040d;
  const listed = traced.lines.find((line) => line.address === store);
  const peek = (a: number): number => traced.bus.read(a);
  const now = disassemble(peek, store);
  const ran = entries.filter((e) => e.pc === store).map((e) => formatTraceLine(e).slice(26, 44).trim());
  console.log('');
  console.log(`Three views of the bytes at &${hex16(store)}:`);
  console.log(`  the source listing says  ${listed?.bytes.map(hex8).join(' ') ?? ''}  ${listed?.source ?? ''}   (what you typed)`);
  console.log(`  memory now decodes as    ${now.bytes.map(hex8).join(' ')}  ${now.text}   (the disassembly: what would run next time)`);
  console.log(`  the trace says it ran    ${ran.join(', ')}   (what did run, each time)`);
  console.log('');
  console.log('And the same five bytes at &0417, decoded from three different starts:');
  for (const from of [0x0417, 0x0418, 0x041a]) {
    const first = disassemble(peek, from);
    const second = disassemble(peek, first.next);
    const show = (i: typeof first): string => `&${hex16(i.address)} ${i.bytes.map(hex8).join(' ').padEnd(8)} ${i.text}`;
    const why = from === 0x0417 ? 'JSR one: the BIT swallows A9 02' : from === 0x0418 ? 'mid-instruction: nonsense, then back in step' : 'JSR two';
    console.log(`  from &${hex16(from)}:  ${show(first).padEnd(28)} ${(from === 0x041a ? '' : show(second)).padEnd(28)} ${why}`);
  }
}

// --- Part 2: what traces are for ---------------------------------------------

console.log('');
console.log('── Part 2: finding a bug with a trace ─────────────────────────────────────────');
console.log('The Stage 16 multiply program, run twice: on our CPU, and on a CPU with a planted bug.');
console.log('The bug: ROR A forgets to rotate the carry into bit 7 (it behaves like LSR A). It only');
console.log('matters when C = 1, which in this program is rare.');

const good = run(SUBROUTINES_SOURCE);
const bad = run(SUBROUTINES_SOURCE, (cpu, opcode, carryBefore) => {
  if (opcode !== ROR_A || !carryBefore) return;
  cpu.regs.a &= 0x7f; // the old carry should have gone into bit 7
  cpu.regs.n = false;
  cpu.regs.z = cpu.regs.a === 0;
});

const answers = (r: Run): string =>
  [0x90, 0x92, 0x94].map((a) => String(word(r.bus.read(a), r.bus.read(a + 1)))).join(', ');
console.log('');
console.log(`  correct CPU:  13 x 11, 12 x 12, 200 x 150 = ${answers(good)}`);
console.log(`  buggy CPU:    13 x 11, 12 x 12, 200 x 150 = ${answers(bad)}`);
console.log('');
console.log('The last answer is wrong, but nothing says why. Diff the traces instead:');

const goodLines = good.tracer.recent(good.tracer.capacity).map((e) => formatTraceLine(e, good.labels));
const badLines = bad.tracer.recent(bad.tracer.capacity).map((e) => formatTraceLine(e, bad.labels));
const first = goodLines.findIndex((line, i) => line !== badLines[i]);
console.log('');
console.log(`  ${String(goodLines.length)} steps each. They agree for ${String(first)} steps, then:`);
console.log('');
console.log(`  ${TRACE_HEADER}`);
for (let i = Math.max(0, first - 3); i < first; i++) console.log(`  ${goodLines[i] ?? ''}`);
console.log(`- ${goodLines[first] ?? ''}   ← correct`);
console.log(`+ ${badLines[first] ?? ''}   ← buggy`);
console.log('');
const culprit = good.tracer.recent(good.tracer.capacity).at(first - 1);
const culpritText = culprit === undefined ? '' : formatTraceLine(culprit).slice(26, 44).trim();
const culpritPc = culprit === undefined ? 0 : culprit.pc;
console.log(`  The first different line is step ${String(first + 1)}. Its registers are the state BEFORE it ran, so the`);
console.log(`  difference was made by the step above: ${culpritText} at &${hex16(culpritPc)}, with C = 1 going in`);
console.log(`  (its flags column ends in a capital C). Right: A = &${goodLines[first]?.slice(44, 46) ?? ''}. Buggy: A = &${badLines[first]?.slice(44, 46) ?? ''}. Bit 7 is missing.`);
console.log('  One instruction to look at, out of hundreds. That is why traces come first.');
