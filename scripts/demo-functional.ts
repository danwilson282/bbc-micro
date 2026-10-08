// Stage 20 demo: whole-CPU validation, and how fast the CPU runs.
//
//   npm run demo:functional
//
// Part 1 runs Klaus Dormann's functional test (needs the fixture:
// npm run fetch-fixtures). Part 2 runs Bruce Clark's decimal test, which is
// assembled from source and always available. Part 3 plants bugs to show what
// a failure looks like. Part 4 times the CPU with and without tracing.

import type { Cpu6502 } from '../src/cpu/cpu6502';
import {
  ALL_FLAGS,
  A_AND_C_ONLY,
  runDecimalTest,
  type DecimalChecks,
  type DecimalTestResult,
} from '../src/cpu/decimal-test';
import { describeFunctionalResult, listingSource, runFunctionalTest } from '../src/cpu/dormann';
import {
  FUNCTIONAL_TEST_BIN,
  functionalTestExists,
  loadFunctionalTestImage,
  loadFunctionalTestListing,
} from '../src/cpu/dormann-files';
import type { StepFunction } from '../src/cpu/singlestep';
import { CYCLES_PER_FRAME, formatSpeed, frameShare } from '../src/cpu/speed';
import { P_C, P_N, P_V, P_Z, packP } from '../src/cpu/flags';
import { Tracer } from '../src/cpu/trace';
import { hex8 } from '../src/util/bits';

const BIT_ZERO_PAGE = 0x24;
const BIT_ABSOLUTE = 0x2c;
const ADC_OPCODES = [0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71];

function heading(text: string): void {
  console.log('');
  console.log(`── ${text} ──`);
}

/** "96,241,367" */
function count(n: number): string {
  return n.toLocaleString('en-GB');
}

/** Runs fn and returns its result with the wall-clock time it took. */
function timed<T>(fn: () => T): { readonly value: T; readonly ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

/** A step function that runs the real step, then lets `after` break something for the listed opcodes. */
function plant(opcodes: readonly number[], after: (cpu: Cpu6502) => void): StepFunction {
  return (cpu) => {
    const opcode = cpu.bus.read(cpu.regs.pc);
    const cycles = cpu.step();
    if (opcodes.includes(opcode)) after(cpu);
    return cycles;
  };
}

// --- Part 1 ----------------------------------------------------------------

const haveFunctional = functionalTestExists();
const image = haveFunctional ? loadFunctionalTestImage() : undefined;

heading("Part 1: Klaus Dormann's 6502 functional test");
if (image === undefined) {
  console.log(`  skipped: ${FUNCTIONAL_TEST_BIN} is missing. Run: npm run fetch-fixtures`);
} else {
  console.log('  64 KB image, PC = &0400, run until PC stops moving...');
  const { value: result, ms } = timed(() => runFunctionalTest(image));
  const t = result.trap;
  console.log(`  ${describeFunctionalResult(result)}`);
  if (result.passed) {
    console.log(`  functional test PASSED in ${count(t.cycles)} cycles (${count(t.instructions)} instructions)`);
    console.log(`  ${(ms / 1000).toFixed(2)} s here; ${(t.cycles / 2_000_000).toFixed(1)} s on a real 2 MHz Model B`);
    console.log(`  running at ${formatSpeed(t.cycles, ms)}`);
  }
}

// --- Part 2 ----------------------------------------------------------------

function flagNames(checks: DecimalChecks): string {
  return ['A', 'C', checks.n ? 'N' : '', checks.v ? 'V' : '', checks.z ? 'Z' : ''].filter((s) => s !== '').join(' ');
}

/** The four flags Clark predicts, capital when set: "NvZC". */
function nvzc(p: number): string {
  const flag = (mask: number, letter: string): string => ((p & mask) !== 0 ? letter : letter.toLowerCase());
  return flag(P_N, 'N') + flag(P_V, 'V') + flag(P_Z, 'Z') + flag(P_C, 'C');
}

function describeDecimal(result: DecimalTestResult): string[] {
  const t = result.trap;
  if (result.passed) return [`PASSED: ${count(t.cycles)} cycles, ${count(t.instructions)} instructions`];
  const op = result.error === 1 ? 'ADC' : 'SBC';
  const sign = result.error === 1 ? '+' : '-';
  return [
    `FAILED: ERROR = ${String(result.error)} (${op} was wrong), trapped at &${t.pc.toString(16).toUpperCase().padStart(4, '0')}`,
    `  the case:   &${hex8(result.n1)} ${sign} &${hex8(result.n2)} with C=${result.carryIn ? '1' : '0'}, in decimal mode`,
    `  actual:     A=&${hex8(result.actualA)}  NVZC ${nvzc(result.actualP)}`,
    `  predicted:  A=&${hex8(result.predictedA)}  NVZC ${nvzc(result.predictedP)}`,
  ];
}

heading("Part 2: Bruce Clark's decimal test (assembled from source by our Stage 08 assembler)");
for (const checks of [ALL_FLAGS, A_AND_C_ONLY]) {
  const { value: result, ms } = timed(() => runDecimalTest(checks));
  const [first = '', ...rest] = describeDecimal(result);
  console.log(`  checking ${flagNames(checks).padEnd(9)}  ${first}  (${formatSpeed(result.trap.cycles, ms)})`);
  for (const line of rest) console.log(`  ${line}`);
}

// --- Part 3 ----------------------------------------------------------------

heading('Part 3: planted bugs, and how the tests point at them');

if (image !== undefined) {
  console.log('');
  console.log('  Bug 1: BIT forgets to copy bit 6 of memory into V.');
  const bitBug = plant([BIT_ZERO_PAGE, BIT_ABSOLUTE], (cpu) => {
    cpu.regs.v = false;
  });
  const result = runFunctionalTest(image, bitBug);
  console.log(`  functional test: ${describeFunctionalResult(result)}`);
  console.log(`  after ${count(result.trap.cycles)} cycles. The listing's source leading up to that address:`);
  for (const line of listingSource(loadFunctionalTestListing(), result.trap.pc, 6)) console.log(`    ${line}`);
}

console.log('');
console.log('  Bug 2: decimal ADC sets Z from the decimal result, as a 65C02 does (not an NMOS 6502).');
const zBug = plant(ADC_OPCODES, (cpu) => {
  if (cpu.regs.d) cpu.regs.z = cpu.regs.a === 0;
});
for (const checks of [ALL_FLAGS, A_AND_C_ONLY]) {
  const [first = '', ...rest] = describeDecimal(runDecimalTest(checks, zBug));
  console.log(`  checking ${flagNames(checks).padEnd(9)}  ${first}`);
  for (const line of rest) console.log(`  ${line}`);
}

// --- Part 4 ----------------------------------------------------------------

heading('Part 4: speed, and what the hot path costs');

/** Stage 18's tracer: typed arrays, nothing allocated per step. Made on first use, when the bus exists. */
function withTracer(): StepFunction {
  let tracer: Tracer | undefined;
  return (cpu) => {
    tracer ??= new Tracer((address) => cpu.bus.read(address));
    tracer.record(cpu);
    return cpu.step();
  };
}

// The same record as Tracer.record makes, but as a new object per step,
// kept in a 1,024-slot ring: the obvious way to write a tracer.

interface TraceObject {
  readonly kind: number;
  readonly pc: number;
  readonly bytes0: number;
  readonly bytes1: number;
  readonly bytes2: number;
  readonly a: number;
  readonly x: number;
  readonly y: number;
  readonly s: number;
  readonly p: number;
  readonly cycles: number;
}

function withObjectTracer(): StepFunction {
  const ring: TraceObject[] = [];
  let next = 0;
  return (cpu) => {
    const r = cpu.regs;
    const pending = cpu.pendingInterrupt;
    ring[next] = {
      kind: pending === 'nmi' ? 2 : pending === 'irq' ? 1 : 0,
      pc: r.pc,
      bytes0: cpu.bus.read(r.pc),
      bytes1: cpu.bus.read((r.pc + 1) & 0xffff),
      bytes2: cpu.bus.read((r.pc + 2) & 0xffff),
      a: r.a,
      x: r.x,
      y: r.y,
      s: r.s,
      p: packP(r, false),
      cycles: cpu.cycles,
    };
    next = (next + 1) & 1023;
    return cpu.step();
  };
}

// Two smaller patterns: each does almost no work, so the difference from
// cpu.step() alone is the cost of the pattern itself.

interface Snapshot {
  readonly pc: number;
  readonly a: number;
  readonly cycles: number;
}

let sink = 0;

/** A new object per step that never leaves the function: V8 can see that and skip making it. */
function withThrownAwayObjects(): StepFunction {
  return (cpu) => {
    const snapshot: Snapshot = { pc: cpu.regs.pc, a: cpu.regs.a, cycles: cpu.cycles };
    sink ^= snapshot.pc;
    return cpu.step();
  };
}

/** A new little function per step (a closure over cpu), the way a helper is often written inline. */
function withClosures(): StepFunction {
  return (cpu) => {
    const peek = (offset: number): number => cpu.bus.read((cpu.regs.pc + offset) & 0xffff);
    sink ^= peek(0);
    return cpu.step();
  };
}

/** One workload, timed: the functional test if it's here, otherwise the decimal test. */
function workload(step?: StepFunction): number {
  if (image !== undefined) return runFunctionalTest(image, step).trap.cycles;
  return runDecimalTest(ALL_FLAGS, step).trap.cycles;
}

// Best of 2, because the first run of a variant includes V8 compiling it. The
// closure variant runs once: it's ten times slower, far more than the noise.
const variants: readonly { readonly name: string; readonly runs: number; readonly make: () => StepFunction | undefined }[] = [
  { name: 'cpu.step() alone', runs: 2, make: () => undefined },
  { name: '+ Tracer.record (typed arrays)', runs: 2, make: withTracer },
  { name: '+ the same record, as an object per step', runs: 2, make: withObjectTracer },
  { name: '+ a small object per step, thrown away', runs: 2, make: withThrownAwayObjects },
  { name: '+ a closure per step', runs: 1, make: withClosures },
];

console.log(`  workload: ${image !== undefined ? 'the functional test' : 'the decimal test'}; best of 2 runs (the closure: 1)`);
console.log('');
let baseline: number | undefined;
for (const variant of variants) {
  let best = Infinity;
  let cycles = 0;
  for (let run = 0; run < variant.runs; run++) {
    const { value, ms } = timed(() => workload(variant.make()));
    cycles = value;
    best = Math.min(best, ms);
  }
  baseline ??= best;
  const slower = best / baseline;
  console.log(
    `  ${variant.name.padEnd(42)} ${String(Math.round(best)).padStart(5)} ms   ${formatSpeed(cycles, best).padEnd(28)} ${slower.toFixed(2)}× the time`,
  );
  if (variant.name === 'cpu.step() alone') {
    const frameMs = 20 * frameShare(cycles, best);
    console.log(
      `    → one 20 ms frame's ${count(CYCLES_PER_FRAME)} cycles take ${frameMs.toFixed(2)} ms: ` +
        `${(100 * frameShare(cycles, best)).toFixed(1)}% of the frame, the rest is left for video, sound and the browser`,
    );
  }
}
console.log('');
console.log('  Speeds vary from machine to machine and run to run; the ratios are what matter.');
if (sink === -1) console.log(''); // uses sink, so the work feeding it can't be skipped entirely
