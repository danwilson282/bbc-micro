// Stage 19 demo: our CPU against Tom Harte's SingleStepTests.
//
//   npm run demo:singlestep              all 151 documented opcodes
//   npm run demo:singlestep -- 69 e9     just these opcodes (hex)
//
// Part 1 takes one case apart, field by field. Part 2 runs every case for
// every opcode and prints a pass/fail table (and a diff for any failure).
// Part 3 plants three bugs, one at a time, so you can see what failures look
// like and how to read them.
//
// Needs the fixtures: scripts/fetch-test-fixtures.sh (about 590 MB).

import { Cpu6502 } from '../src/cpu/cpu6502';
import { MODES } from '../src/cpu/addressing';
import { OPCODES } from '../src/cpu/opcodes';
import {
  SingleStepRunner,
  caseInstruction,
  formatBusCycle,
  formatCaseDiff,
  formatState,
  summariseOpcode,
  type OpcodeSummary,
  type SingleStepCase,
  type StepFunction,
} from '../src/cpu/singlestep';
import { loadSingleStepCases, singleStepFile, singleStepFileExists } from '../src/cpu/singlestep-files';
import { hex16, hex8, lo, word } from '../src/util/bits';

const INC_ABSOLUTE = 0xee;
const LDA_ABSOLUTE_X = 0xbd;
const JMP_INDIRECT = 0x6c;
const ADC_IMMEDIATE = 0x69;

function heading(text: string): void {
  console.log('');
  console.log(`── ${text} ──`);
}

function implementedOpcodes(): number[] {
  return OPCODES.flatMap((entry, opcode) => (entry === undefined ? [] : [opcode]));
}

/** "LDA &nnnn,X" for the table. */
function instructionName(opcode: number): string {
  const entry = OPCODES[opcode];
  if (entry === undefined) return '?';
  const syntax = MODES[entry.mode].syntax;
  return syntax === '' ? entry.mnemonic : `${entry.mnemonic} ${syntax}`;
}

function requested(): number[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return implementedOpcodes();
  return args.map((arg) => {
    const opcode = parseInt(arg.replace(/^(&|\$|0x)/i, ''), 16);
    if (!/^(&|\$|0x)?[0-9a-f]{1,2}$/i.test(arg) || OPCODES[opcode] === undefined) {
      console.error(`"${arg}" isn't a documented opcode in hex (e.g. a9, &6C).`);
      process.exit(1);
    }
    return opcode;
  });
}

const opcodes = requested();
const missing = opcodes.filter((opcode) => !singleStepFileExists(opcode));
if (missing.length > 0) {
  console.log(`${singleStepFile(missing[0] ?? 0)} (and ${String(missing.length - 1)} more) not found.`);
  console.log('Download the test cases first:  scripts/fetch-test-fixtures.sh   (about 590 MB)');
  process.exit(0);
}

// --- Part 1 ----------------------------------------------------------------------

/** One case, taken apart: what goes in, what must come out, and what we check. */
function anatomy(testCase: SingleStepCase): void {
  const result = new SingleStepRunner().run(testCase);
  const { initial, final } = testCase;
  console.log(`  "${testCase.name}" is the bytes at PC: ${caseInstruction(testCase)}`);
  console.log('');
  console.log(`  initial  ${formatState(initial)}`);
  console.log(`           RAM ${initial.ram.map(([a, v]) => `&${hex16(a)}=&${hex8(v)}`).join('  ')}`);
  const before = new Map(initial.ram);
  const changed = final.ram.filter(([a, v]) => before.get(a) !== v);
  console.log(`  final    ${formatState(final)}`);
  console.log(`           RAM changes: ${changed.map(([a, v]) => `&${hex16(a)}=&${hex8(v)}`).join('  ') || 'none'}`);
  console.log('  cycles   (what the real chip put on the bus, one line per clock)');
  testCase.cycles.forEach((cycle, n) => {
    console.log(`           ${formatBusCycle(cycle, n)}`);
  });
  console.log('');
  const writes = testCase.cycles.filter(([, , kind]) => kind === 'write').length;
  const mark = result.passed ? '✓' : '✗';
  console.log(`  ${mark} registers and P   ${mark} ${String(final.ram.length)} RAM bytes   ${mark} ${String(result.cycles)} cycles   ${mark} ${String(writes)} writes in order   ${mark} no stray access`);
  console.log(`    reads: we did ${String(result.reads)}, the chip did ${String(result.realReads)}`);
}

heading('Part 1: one test case, taken apart');
const showOpcode = opcodes.includes(INC_ABSOLUTE) ? INC_ABSOLUTE : (opcodes[0] ?? INC_ABSOLUTE);
const showCases = loadSingleStepCases(showOpcode);
const firstCase = showCases.at(0);
if (firstCase !== undefined) anatomy(firstCase);

// --- Part 2 ----------------------------------------------------------------------

heading(`Part 2: ${String(opcodes.length)} opcode${opcodes.length === 1 ? '' : 's'}, 10,000 cases each`);
console.log('  op  instruction      passed        cycles  reads per case: ours / real (dummy reads skipped)');

const runner = new SingleStepRunner();
const started = performance.now();
const summaries: OpcodeSummary[] = [];
for (const opcode of opcodes) {
  const summary = summariseOpcode(opcode, opcode === showOpcode ? showCases : loadSingleStepCases(opcode), runner, 3);
  summaries.push(summary);
  const ok = summary.passed === summary.total;
  const cycles = summary.minCycles === summary.maxCycles ? String(summary.minCycles) : `${String(summary.minCycles)}-${String(summary.maxCycles)}`;
  const ours = summary.reads / summary.total;
  const real = summary.realReads / summary.total;
  const skipped = real - ours;
  console.log(
    `  ${hex8(opcode)}  ${instructionName(opcode).padEnd(15)}  ${ok ? '✓' : '✗'} ${`${String(summary.passed)}/${String(summary.total)}`.padEnd(11)}  ${cycles.padStart(6)}  ` +
      `${ours.toFixed(2)} / ${real.toFixed(2)}${skipped > 0.005 ? `  (${skipped.toFixed(2)})` : ''}`,
  );
}
const seconds = (performance.now() - started) / 1000;

const cases = summaries.reduce((sum, s) => sum + s.total, 0);
const passedCases = summaries.reduce((sum, s) => sum + s.passed, 0);
const passedOpcodes = summaries.filter((s) => s.passed === s.total).length;
const ourReads = summaries.reduce((sum, s) => sum + s.reads, 0);
const realReads = summaries.reduce((sum, s) => sum + s.realReads, 0);
console.log('');
console.log(`  ${String(passedOpcodes)}/${String(summaries.length)} opcodes, ${passedCases.toLocaleString('en-GB')}/${cases.toLocaleString('en-GB')} cases passed in ${seconds.toFixed(1)}s.`);
console.log(`  The real chip did ${realReads.toLocaleString('en-GB')} reads; we did ${ourReads.toLocaleString('en-GB')}. The other ${(realReads - ourReads).toLocaleString('en-GB')} are dummy reads we don't model.`);

for (const summary of summaries) {
  for (const failure of summary.failures) {
    console.log('');
    console.log(formatCaseDiff(failure.testCase, failure.result));
  }
}

// --- Part 3 ----------------------------------------------------------------------

interface PlantedBug {
  readonly opcode: number;
  readonly title: string;
  readonly explain: string;
  readonly step: (runner: SingleStepRunner) => StepFunction;
}

const BUGS: readonly PlantedBug[] = [
  {
    opcode: LDA_ABSOLUTE_X,
    title: 'forget the page-crossing cycle',
    explain: 'Cycle 4 read the right low byte with the old high byte; cycle 5 is the fix-up. Only the count is wrong.',
    step: (r) => (cpu) => {
      const opcode = r.bus.peek(cpu.regs.pc);
      const cycles = cpu.step();
      return opcode === LDA_ABSOLUTE_X && cpu.pageCrossed ? cycles - 1 : cycles;
    },
  },
  {
    opcode: JMP_INDIRECT,
    title: '"fix" the JMP (&xxFF) bug',
    explain: 'Only cases whose pointer ends in &FF fail. The "fixed" CPU reads the next page, which the real chip never touches: a stray.',
    step: (r) => (cpu) => {
      const pc = cpu.regs.pc;
      const opcode = r.bus.peek(pc);
      const pointer = word(r.bus.peek((pc + 1) & 0xffff), r.bus.peek((pc + 2) & 0xffff));
      const cycles = cpu.step();
      if (opcode === JMP_INDIRECT && lo(pointer) === 0xff) {
        cpu.regs.pc = word(cpu.bus.read(pointer), cpu.bus.read((pointer + 1) & 0xffff));
      }
      return cycles;
    },
  },
  {
    opcode: ADC_IMMEDIATE,
    title: 'decimal ADC sets Z from the decimal result (the 65C02 way)',
    explain: 'On the NMOS 6502, Z comes from the binary sum (Stage 11), so &99 + &01 gives A=&00 with Z clear.',
    step: (r) => (cpu) => {
      const opcode = r.bus.peek(cpu.regs.pc);
      const cycles = cpu.step();
      if (opcode === ADC_IMMEDIATE && cpu.regs.d) cpu.regs.z = cpu.regs.a === 0;
      return cycles;
    },
  },
];

heading('Part 3: planting bugs, to see what a failure looks like');
for (const bug of BUGS) {
  if (!opcodes.includes(bug.opcode)) continue;
  const buggy = new SingleStepRunner((cpu: Cpu6502) => planted(cpu));
  const planted = bug.step(buggy);
  const summary = summariseOpcode(bug.opcode, loadSingleStepCases(bug.opcode), buggy, 1);
  const failed = summary.total - summary.passed;
  console.log('');
  console.log(`  Bug: ${bug.title}  →  ${instructionName(bug.opcode)} fails ${failed.toLocaleString('en-GB')} of ${summary.total.toLocaleString('en-GB')} cases`);
  console.log(`  ${bug.explain}`);
  const failure = summary.failures.at(0);
  if (failure !== undefined) {
    console.log('');
    console.log(formatCaseDiff(failure.testCase, failure.result).replace(/^/gm, '  '));
  }
}
