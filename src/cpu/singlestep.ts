// Running Tom Harte's SingleStepTests against our CPU.
//
// Each test case is one instruction: a full starting state (registers plus
// every byte of RAM it touches), the full state after, and the bus activity
// cycle by cycle (https://github.com/SingleStepTests/65x02, 6502/README.md).
// We load the start, run one step(), and compare:
//   - PC, S, A, X, Y and P
//   - every byte in the final ram list
//   - the cycle count, against the length of the cycles list (one bus
//     access per cycle on the 6502)
//   - every write, in order (we model all of them, dummy writes included)
//   - that nothing outside the listed addresses was touched
// We can't compare the reads one for one, because the real chip does dummy
// reads that our instruction-stepped core skips; we only count them.
//
// DOM-free and fs-free: reading the files is singlestep-files.ts's job.

import type { Bus } from '../memory/bus';
import { hex16, hex8 } from '../util/bits';
import { Cpu6502 } from './cpu6502';
import { disassemble } from './disassembler';
import { packP, unpackP } from './flags';
import { formatFlags } from './trace';

/** [address, value]: one byte of a case's memory. */
export type RamEntry = readonly [address: number, value: number];
/** One clock cycle on the bus: [address, value, read or write]. */
export type BusCycle = readonly [address: number, value: number, kind: 'read' | 'write'];

export interface CpuState {
  readonly pc: number;
  readonly s: number;
  readonly a: number;
  readonly x: number;
  readonly y: number;
  /** As the pushed byte: bit 5 set, B clear, in every file. */
  readonly p: number;
  readonly ram: readonly RamEntry[];
}

export interface SingleStepCase {
  /** The instruction's bytes in hex, e.g. "ee 8f 74". */
  readonly name: string;
  readonly initial: CpuState;
  readonly final: CpuState;
  readonly cycles: readonly BusCycle[];
}

// --- Parsing: the I/O boundary -------------------------------------------------
// JSON.parse gives `unknown`. Rather than cast it, check every field, so a
// truncated or wrong file fails here with a clear message instead of as
// thousands of confusing mismatches. There are about 300,000 numbers per file,
// so the checks are plain booleans, and the "case 12.final.ram[3][1]" text is
// only built when one fails.

/**
 * Looked up once. Under Jest, reaching a global (Array, Number, Math) goes
 * through the test sandbox's global object, which is slow enough to matter
 * when it happens a million times per file.
 */
const isArray = Array.isArray;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !isArray(value);
}

/**
 * Is value a whole number from 0 to mask (&FF or &FFFF)? (value & mask) ===
 * value is only true for those: -1 & &FF is 255, 1.5 & &FF is 1, NaN & &FF is
 * 0. Plain operators, not Number.isInteger: see isArray above (with
 * 300,000 numbers per file, the global lookup made parsing 10 times slower).
 */
function isInteger(value: unknown, mask: 0xff | 0xffff): value is number {
  return typeof value === 'number' && (value & mask) === value;
}

function fail(where: string, expected: string, got: unknown): never {
  throw new Error(`${where}: expected ${expected}, got ${JSON.stringify(got)}`);
}

function integer(value: unknown, mask: 0xff | 0xffff, where: string, field: string): number {
  return isInteger(value, mask) ? value : fail(`${where}.${field}`, `an integer 0-${String(mask)}`, value);
}

function array(value: unknown, where: string): readonly unknown[] {
  return isArray(value) ? value : fail(where, 'an array', value);
}

function parseRamEntry(entry: unknown, where: string, i: number): RamEntry {
  if (isArray(entry) && entry.length === 2) {
    const address: unknown = entry[0];
    const value: unknown = entry[1];
    if (isInteger(address, 0xffff) && isInteger(value, 0xff)) return [address, value];
  }
  return fail(`${where}.ram[${String(i)}]`, '[address 0-65535, value 0-255]', entry);
}

function parseState(value: unknown, where: string): CpuState {
  if (!isRecord(value)) return fail(where, 'an object', value);
  const ram = array(value.ram, `${where}.ram`).map((entry, i) => parseRamEntry(entry, where, i));
  return {
    pc: integer(value.pc, 0xffff, where, 'pc'),
    s: integer(value.s, 0xff, where, 's'),
    a: integer(value.a, 0xff, where, 'a'),
    x: integer(value.x, 0xff, where, 'x'),
    y: integer(value.y, 0xff, where, 'y'),
    p: integer(value.p, 0xff, where, 'p'),
    ram,
  };
}

function parseCycle(cycle: unknown, where: string, i: number): BusCycle {
  if (isArray(cycle) && cycle.length === 3) {
    const address: unknown = cycle[0];
    const value: unknown = cycle[1];
    const kind: unknown = cycle[2];
    if (isInteger(address, 0xffff) && isInteger(value, 0xff) && (kind === 'read' || kind === 'write')) return [address, value, kind];
  }
  return fail(`${where}.cycles[${String(i)}]`, '[address, value, "read" or "write"]', cycle);
}

/** Checks and converts one file's parsed JSON. Throws naming the case and field on anything unexpected. */
export function parseCases(json: unknown): SingleStepCase[] {
  return array(json, 'test file (expected an array of cases)').map((value, index): SingleStepCase => {
    const where = `case ${String(index)}`;
    if (!isRecord(value)) return fail(where, 'an object', value);
    if (typeof value.name !== 'string') return fail(`${where}.name`, 'a string', value.name);
    return {
      name: value.name,
      initial: parseState(value.initial, `${where}.initial`),
      final: parseState(value.final, `${where}.final`),
      cycles: array(value.cycles, `${where}.cycles`).map((cycle, i) => parseCycle(cycle, where, i)),
    };
  });
}

// --- The sparse bus ----------------------------------------------------------------

/** More writes than any documented instruction does (BRK's 3 is the most). Writes past this are counted, not kept. */
const WRITE_LOG_CAPACITY = 8;
/** Addresses one case can dirty before load() gives up tracking and clears all 64K. */
const TOUCHED_CAPACITY = 256;

/**
 * 64K of RAM that's cheap to reset between cases. A case only uses a handful
 * of addresses, so load() zeroes just the ones the last case dirtied, instead
 * of all 65,536 bytes. It also marks the listed addresses (in either list),
 * so any access outside them (which the README says must never happen)
 * counts as a stray.
 */
export class SparseBus implements Bus {
  private readonly memory = new Uint8Array(0x10000);
  /** 1 at each address in the current case's ram list. */
  private readonly listed = new Uint8Array(0x10000);
  /** Every address load() or a stray write set, so the next load() can clear it. */
  private readonly touched = new Uint16Array(TOUCHED_CAPACITY);
  private touchedCount = 0;
  private readonly writeAddresses = new Uint16Array(WRITE_LOG_CAPACITY);
  private readonly writeValues = new Uint8Array(WRITE_LOG_CAPACITY);

  /** Bus reads since load(). */
  reads = 0;
  /** Bus writes since load(); the first WRITE_LOG_CAPACITY are logged. */
  writeCount = 0;
  /** Accesses to addresses not in the ram list since load(). */
  strays = 0;
  /** The first of them, or -1. */
  firstStray = -1;

  /**
   * Clears the last case and loads this one's bytes. Resets the counters and
   * the write log. alsoListed are addresses the case may touch without giving
   * them a starting value: a store's target appears only in the final list.
   */
  load(ram: readonly RamEntry[], alsoListed: readonly RamEntry[] = []): void {
    if (this.touchedCount > TOUCHED_CAPACITY) {
      this.memory.fill(0);
      this.listed.fill(0);
    } else {
      for (let i = 0; i < this.touchedCount; i++) {
        const address = this.touched[i] ?? 0;
        this.memory[address] = 0;
        this.listed[address] = 0;
      }
    }
    this.touchedCount = 0;
    for (const [address, value] of ram) {
      this.memory[address & 0xffff] = value & 0xff;
      this.listed[address & 0xffff] = 1;
      this.touch(address & 0xffff);
    }
    for (const [address] of alsoListed) {
      this.listed[address & 0xffff] = 1;
      this.touch(address & 0xffff);
    }
    this.reads = 0;
    this.writeCount = 0;
    this.strays = 0;
    this.firstStray = -1;
  }

  read(address: number): number {
    const a = address & 0xffff;
    this.reads++;
    if (this.listed[a] === 0) this.stray(a);
    return this.memory[a] ?? 0;
  }

  write(address: number, value: number): void {
    const a = address & 0xffff;
    const v = value & 0xff;
    if (this.writeCount < WRITE_LOG_CAPACITY) {
      this.writeAddresses[this.writeCount] = a;
      this.writeValues[this.writeCount] = v;
    }
    this.writeCount++;
    if (this.listed[a] === 0) {
      this.stray(a);
      this.touch(a);
    }
    this.memory[a] = v;
  }

  /** The byte at address, without counting it as an access. */
  peek(address: number): number {
    return this.memory[address & 0xffff] ?? 0;
  }

  /** The nth write's address (0-based), or -1 if it wasn't logged. */
  writeAddress(n: number): number {
    return n < this.writeCount && n < WRITE_LOG_CAPACITY ? (this.writeAddresses[n] ?? -1) : -1;
  }

  /** The nth write's value (0-based), or -1 if it wasn't logged. */
  writeValue(n: number): number {
    return n < this.writeCount && n < WRITE_LOG_CAPACITY ? (this.writeValues[n] ?? -1) : -1;
  }

  private stray(address: number): void {
    if (this.strays === 0) this.firstStray = address;
    this.strays++;
  }

  private touch(address: number): void {
    if (this.touchedCount < TOUCHED_CAPACITY) this.touched[this.touchedCount] = address;
    this.touchedCount++;
  }
}

// --- Running a case --------------------------------------------------------------------

/** One field that differs. Values are text ("&9B", "6", "&748F = &9B") so any field prints the same way. */
export interface Mismatch {
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
}

export interface CaseResult {
  readonly passed: boolean;
  /** Empty when passed. */
  readonly mismatches: readonly Mismatch[];
  /** What step() returned (0 if it threw). */
  readonly cycles: number;
  /** Bus reads our CPU did. */
  readonly reads: number;
  /** Reads in the case's cycles list: what the real chip did, dummy reads included. */
  readonly realReads: number;
}

/** How to run one instruction. Normally cpu.step(); the tests and the demo pass one with a planted bug. */
export type StepFunction = (cpu: Cpu6502) => number;

const NO_MISMATCHES: readonly Mismatch[] = [];

function byte(value: number): string {
  return `&${hex8(value)}`;
}

function pFlags(p: number): string {
  return `&${hex8(p)} ${formatFlags(p)}`;
}

function busWrite(address: number, value: number): string {
  return `&${hex16(address)} = &${hex8(value)}`;
}

/**
 * Runs cases one at a time. The bus is reused (it's the expensive part); each
 * case gets a brand-new Cpu6502, so nothing (a latched NMI, the IRQ line,
 * pageCrossed) can carry over from the case before.
 */
export class SingleStepRunner {
  readonly bus = new SparseBus();

  constructor(private readonly step: StepFunction = (cpu) => cpu.step()) {}

  run(testCase: SingleStepCase): CaseResult {
    const { initial, final } = testCase;
    const bus = this.bus;
    bus.load(initial.ram, final.ram);
    const cpu = new Cpu6502(bus);
    const r = cpu.regs;
    r.pc = initial.pc;
    r.s = initial.s;
    r.a = initial.a;
    r.x = initial.x;
    r.y = initial.y;
    unpackP(r, initial.p);

    let realReads = 0;
    for (const [, , kind] of testCase.cycles) if (kind === 'read') realReads++;

    let cycles: number;
    try {
      cycles = this.step(cpu);
    } catch (error) {
      const actual = error instanceof Error ? error.message : String(error);
      return { passed: false, mismatches: [{ field: 'step', expected: 'one instruction', actual }], cycles: 0, reads: bus.reads, realReads };
    }

    // Allocated only on the first difference: a pass costs nothing.
    let mismatches: Mismatch[] | undefined;
    const differ = (field: string, expected: string, actual: string): void => {
      (mismatches ??= []).push({ field, expected, actual });
    };
    const register = (field: string, expected: number, actual: number, show: (value: number) => string): void => {
      if (expected !== actual) differ(field, show(expected), show(actual));
    };

    register('PC', final.pc, r.pc, (v) => `&${hex16(v)}`);
    register('S', final.s, r.s, byte);
    register('A', final.a, r.a, byte);
    register('X', final.x, r.x, byte);
    register('Y', final.y, r.y, byte);
    register('P', final.p, packP(r, false), pFlags);
    for (const [address, value] of final.ram) {
      // Compare first: the "&748F" label is only worth making for a byte that's wrong.
      if (bus.peek(address) !== value) differ(`&${hex16(address)}`, byte(value), byte(bus.peek(address)));
    }
    register('cycles', testCase.cycles.length, cycles, String);

    const expectedWrites = testCase.cycles.filter(([, , kind]) => kind === 'write');
    register('writes', expectedWrites.length, bus.writeCount, String);
    expectedWrites.forEach(([address, value], n) => {
      if (n >= bus.writeCount) return;
      const ourAddress = bus.writeAddress(n);
      const ourValue = bus.writeValue(n);
      if (ourAddress !== address || ourValue !== value) differ(`write ${String(n + 1)}`, busWrite(address, value), busWrite(ourAddress, ourValue));
    });

    if (bus.strays > 0) differ('stray access', 'none', `${String(bus.strays)}, first at &${hex16(bus.firstStray)}`);

    const found = mismatches ?? NO_MISMATCHES;
    return { passed: found.length === 0, mismatches: found, cycles, reads: bus.reads, realReads };
  }
}

// --- Summaries and diffs -----------------------------------------------------------------

export interface CaseFailure {
  readonly testCase: SingleStepCase;
  readonly result: CaseResult;
}

export interface OpcodeSummary {
  readonly opcode: number;
  readonly total: number;
  readonly passed: number;
  /** The first few failures, in file order. */
  readonly failures: readonly CaseFailure[];
  /** Fewest and most cycles in the cases' cycles lists (e.g. 4-5 for LDA &nnnn,X). */
  readonly minCycles: number;
  readonly maxCycles: number;
  /** Totals over every case: our reads, and the real chip's. */
  readonly reads: number;
  readonly realReads: number;
}

/** Runs every case for one opcode and keeps up to keepFailures of the failures. */
export function summariseOpcode(opcode: number, cases: readonly SingleStepCase[], runner: SingleStepRunner, keepFailures: number): OpcodeSummary {
  const failures: CaseFailure[] = [];
  let passed = 0;
  let minCycles = Infinity;
  let maxCycles = 0;
  let reads = 0;
  let realReads = 0;
  for (const testCase of cases) {
    const result = runner.run(testCase);
    if (result.passed) passed++;
    else if (failures.length < keepFailures) failures.push({ testCase, result });
    const length = testCase.cycles.length;
    if (length < minCycles) minCycles = length;
    if (length > maxCycles) maxCycles = length;
    reads += result.reads;
    realReads += result.realReads;
  }
  return { opcode, total: cases.length, passed, failures, minCycles: cases.length === 0 ? 0 : minCycles, maxCycles, reads, realReads };
}

/** The instruction the case starts on, disassembled from its initial RAM. */
export function caseInstruction(testCase: SingleStepCase): string {
  const ram = new Map(testCase.initial.ram);
  return disassemble((address) => ram.get(address) ?? 0, testCase.initial.pc).text;
}

/** "PC=&A3CC A=&8A X=&E9 Y=&DA S=&A1 P=&6B nV--DiZC" */
export function formatState(state: CpuState): string {
  return `PC=&${hex16(state.pc)} A=${byte(state.a)} X=${byte(state.x)} Y=${byte(state.y)} S=${byte(state.s)} P=${pFlags(state.p)}`;
}

/** "1 &A3CC &EE read" */
export function formatBusCycle(cycle: BusCycle, n: number): string {
  const [address, value, kind] = cycle;
  return `${String(n + 1)} &${hex16(address)} &${hex8(value)} ${kind}`;
}

/**
 * A failed case as a diff: the instruction and where it started, each field
 * that differs (expected vs got), then what the real chip put on the bus.
 */
export function formatCaseDiff(testCase: SingleStepCase, result: CaseResult): string {
  const lines = [`✗ ${testCase.name}   ${caseInstruction(testCase)}   from ${formatState(testCase.initial)}`];
  for (const { field, expected, actual } of result.mismatches) {
    lines.push(`    ${field.padEnd(13)} expected ${expected.padEnd(16)} got ${actual}`);
  }
  lines.push('  real bus:');
  testCase.cycles.forEach((cycle, n) => lines.push(`    ${formatBusCycle(cycle, n)}`));
  return lines.join('\n');
}
