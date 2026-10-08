import { readFileSync } from 'node:fs';
import { OPCODES } from './opcodes';
import { Cpu6502 } from './cpu6502';
import { SingleStepRunner, SparseBus, formatCaseDiff, parseCases, summariseOpcode, type SingleStepCase } from './singlestep';
import { documentedOpcodes, loadSingleStepCases, singleStepFile, singleStepFileExists } from './singlestep-files';

/**
 * A real case from ee.json (INC &748F), hex instead of the file's decimal.
 * Six cycles: three fetches, read the old value, write it back (the NMOS
 * dummy write), write the new one.
 */
const INC_ABSOLUTE: SingleStepCase = {
  name: 'ee 8f 74',
  initial: {
    pc: 0xa3cc, s: 0xa1, a: 0x8a, x: 0xe9, y: 0xda, p: 0x6b,
    ram: [[0xa3cc, 0xee], [0xa3cd, 0x8f], [0xa3ce, 0x74], [0x748f, 0x9a], [0xa3cf, 0x44]],
  },
  final: {
    pc: 0xa3cf, s: 0xa1, a: 0x8a, x: 0xe9, y: 0xda, p: 0xe9,
    ram: [[0x748f, 0x9b], [0xa3cc, 0xee], [0xa3cd, 0x8f], [0xa3ce, 0x74], [0xa3cf, 0x44]],
  },
  cycles: [
    [0xa3cc, 0xee, 'read'], [0xa3cd, 0x8f, 'read'], [0xa3ce, 0x74, 'read'],
    [0x748f, 0x9a, 'read'], [0x748f, 0x9a, 'write'], [0x748f, 0x9b, 'write'],
  ],
};

/** A copy of INC_ABSOLUTE with parts of its expected final state replaced. */
function withFinal(changes: Partial<SingleStepCase['final']>): SingleStepCase {
  return { ...INC_ABSOLUTE, final: { ...INC_ABSOLUTE.final, ...changes } };
}

/** The case as it appears in the JSON files: plain arrays, decimal numbers. */
function asJson(testCase: SingleStepCase): unknown {
  return JSON.parse(JSON.stringify(testCase));
}

describe('parseCases (the JSON boundary)', () => {
  test('reads a well-formed case into typed fields', () => {
    const [parsed] = parseCases([asJson(INC_ABSOLUTE)]);
    expect(parsed).toEqual(INC_ABSOLUTE);
  });

  test('rejects a file that is not an array of cases, naming the case and the field', () => {
    expect(() => parseCases({})).toThrow(/array/);
    const broken = asJson(withFinal({ a: 300 }));
    expect(() => parseCases([asJson(INC_ABSOLUTE), broken])).toThrow(/case 1.*final\.a/);
    const badKind = { ...INC_ABSOLUTE, cycles: [[0, 0, 'fetch']] };
    expect(() => parseCases([badKind])).toThrow(/cycles\[0\]/);
  });
});

describe('SparseBus', () => {
  test('acts as 64K of RAM and counts reads and writes', () => {
    const bus = new SparseBus();
    bus.load([[0x1234, 0x56]]);
    expect(bus.read(0x1234)).toBe(0x56);
    bus.write(0x11234, 0x1ab); // masked to 16-bit address, 8-bit value
    expect(bus.read(0x1234)).toBe(0xab);
    expect(bus.reads).toBe(2);
    expect(bus.writeCount).toBe(1);
    expect(bus.writeAddress(0)).toBe(0x1234);
    expect(bus.writeValue(0)).toBe(0xab);
  });

  test('an access outside the listed addresses is counted as a stray, with the first one remembered', () => {
    const bus = new SparseBus();
    bus.load([[0x0010, 0x01]]);
    bus.read(0x0010);
    expect(bus.strays).toBe(0);
    bus.read(0x0011);
    bus.write(0x0012, 0x00);
    expect(bus.strays).toBe(2);
    expect(bus.firstStray).toBe(0x0011);
  });

  test('load() clears only what the last case used: earlier bytes, strays and counters are gone', () => {
    const bus = new SparseBus();
    bus.load([[0x0010, 0x01]]);
    bus.write(0x2000, 0x77); // a stray write, which must not leak into the next case
    bus.load([[0x0020, 0x02]]);
    expect(bus.peek(0x0010)).toBe(0x00);
    expect(bus.peek(0x2000)).toBe(0x00);
    expect(bus.peek(0x0020)).toBe(0x02);
    expect(bus.reads + bus.writeCount + bus.strays).toBe(0);
  });
});

describe('SingleStepRunner', () => {
  test('INC &748F matches the reference: registers, memory, 6 cycles and both writes in order', () => {
    const result = new SingleStepRunner().run(INC_ABSOLUTE);
    expect(result.mismatches).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.cycles).toBe(6);
    // 3 fetches + 1 operand read: the same 4 reads as the real chip here.
    expect(result.reads).toBe(4);
    expect(result.realReads).toBe(4);
  });

  test('a wrong register is reported as expected vs actual', () => {
    const result = new SingleStepRunner().run(withFinal({ a: 0x8b }));
    expect(result.passed).toBe(false);
    expect(result.mismatches).toEqual([{ field: 'A', expected: '&8B', actual: '&8A' }]);
  });

  test('P is compared as the pushed byte, bit 5 set and B clear', () => {
    // Expecting &F9 (the same but with B set) must fail: the chip has no B to set.
    const result = new SingleStepRunner().run(withFinal({ p: 0xf9 }));
    expect(result.mismatches).toEqual([{ field: 'P', expected: '&F9 NV--DizC', actual: '&E9 NV--DizC' }]);
  });

  test('a wrong memory byte is reported by address', () => {
    const result = new SingleStepRunner().run(withFinal({ ram: [[0x748f, 0x9c]] }));
    expect(result.mismatches).toEqual([{ field: '&748F', expected: '&9C', actual: '&9B' }]);
  });

  test('a cycle count that differs from the length of the cycles list fails', () => {
    const fiveCycles = { ...INC_ABSOLUTE, cycles: INC_ABSOLUTE.cycles.slice(0, 5) };
    const result = new SingleStepRunner().run(fiveCycles);
    expect(result.mismatches).toContainEqual({ field: 'cycles', expected: '5', actual: '6' });
  });

  test('writes are compared in order: a missing dummy write is caught even when memory ends up right', () => {
    // A planted bug: INC without the dummy write (the 65C02's behaviour).
    const noDummyWrite = (cpu: Cpu6502): number => {
      const value = (cpu.bus.read(0x748f) + 1) & 0xff;
      cpu.bus.read(0xa3cc);
      cpu.bus.read(0xa3cd);
      cpu.bus.read(0xa3ce);
      cpu.bus.write(0x748f, value);
      cpu.regs.pc = 0xa3cf;
      cpu.regs.n = true;
      cpu.regs.z = false;
      return 6;
    };
    const result = new SingleStepRunner(noDummyWrite).run(INC_ABSOLUTE);
    expect(result.mismatches).toEqual([
      { field: 'writes', expected: '2', actual: '1' },
      { field: 'write 1', expected: '&748F = &9A', actual: '&748F = &9B' },
    ]);
  });

  test('an access outside the listed addresses fails the case', () => {
    const strayRead = (cpu: Cpu6502): number => {
      cpu.bus.read(0x0000);
      return cpu.step();
    };
    const result = new SingleStepRunner(strayRead).run(INC_ABSOLUTE);
    expect(result.mismatches).toContainEqual({ field: 'stray access', expected: 'none', actual: '1, first at &0000' });
  });

  test('each case gets a fresh CPU: a pending NMI cannot leak from one case into the next', () => {
    const runner = new SingleStepRunner((cpu) => {
      const cycles = cpu.step();
      cpu.setNmi(true); // left latched after the step
      return cycles;
    });
    expect(runner.run(INC_ABSOLUTE).passed).toBe(true);
    expect(runner.run(INC_ABSOLUTE).passed).toBe(true);
  });

  test('an unimplemented opcode is a failed case, not a crash', () => {
    const jam: SingleStepCase = {
      name: '02',
      initial: { ...INC_ABSOLUTE.initial, ram: [[0xa3cc, 0x02]] },
      final: INC_ABSOLUTE.final,
      cycles: [],
    };
    const result = new SingleStepRunner().run(jam);
    expect(result.passed).toBe(false);
    expect(result.mismatches[0]?.field).toBe('step');
    expect(result.mismatches[0]?.actual).toMatch(/unimplemented opcode &02/);
  });
});

describe('summariseOpcode and formatCaseDiff', () => {
  test('counts passes and keeps only the first few failures', () => {
    const cases = [INC_ABSOLUTE, withFinal({ a: 0 }), withFinal({ x: 0 }), INC_ABSOLUTE];
    const summary = summariseOpcode(0xee, cases, new SingleStepRunner(), 1);
    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(2);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]?.testCase.final.a).toBe(0);
    expect(summary.minCycles).toBe(6);
    expect(summary.maxCycles).toBe(6);
  });

  test('a diff names the instruction, the starting state, each mismatch and the real bus cycles', () => {
    const testCase = withFinal({ a: 0x8b });
    const result = new SingleStepRunner().run(testCase);
    const text = formatCaseDiff(testCase, result);
    expect(text).toContain('✗ ee 8f 74   INC &748F');
    expect(text).toContain('PC=&A3CC A=&8A X=&E9 Y=&DA S=&A1 P=&6B nV--DiZC');
    expect(text).toMatch(/A\s+expected &8B\s+got &8A/);
    expect(text).toContain('5 &748F &9A write');
  });
});

// ---------------------------------------------------------------------------
// The fixtures: 10,000 cases for each of the 151 documented opcodes.
// Fetch them with scripts/fetch-test-fixtures.sh. Each opcode skips if its
// file is missing, so the suite never fails just because they aren't there.

test('the fetch script downloads exactly the opcodes the CPU implements', () => {
  const implemented = OPCODES.flatMap((entry, opcode) => (entry === undefined ? [] : [opcode]));
  expect(documentedOpcodes(readFileSync('scripts/fetch-test-fixtures.sh', 'utf8'))).toEqual(implemented);
});

describe('SingleStepTests (NMOS 6502, v1)', () => {
  const opcodes = OPCODES.flatMap((entry, opcode) => (entry === undefined ? [] : [opcode]));
  const missing = opcodes.filter((opcode) => !singleStepFileExists(opcode));
  if (missing.length > 0) {
    console.log(
      `SingleStepTests: skipping ${String(missing.length)} of ${String(opcodes.length)} opcodes, ` +
        `${singleStepFile(missing[0] ?? 0)} and others not found. Run scripts/fetch-test-fixtures.sh to download them.`,
    );
  }
  const runner = new SingleStepRunner();

  for (const opcode of opcodes) {
    const entry = OPCODES[opcode];
    const name = `&${opcode.toString(16).toUpperCase().padStart(2, '0')} ${entry?.mnemonic ?? '?'} ${entry?.mode ?? ''}`;
    const run = singleStepFileExists(opcode) ? test : test.skip;
    run(`${name}: all 10,000 cases match registers, memory, cycle count and writes`, () => {
      const summary = summariseOpcode(opcode, loadSingleStepCases(opcode), runner, 3);
      const diffs = summary.failures.map((failure) => formatCaseDiff(failure.testCase, failure.result)).join('\n\n');
      expect(`${String(summary.passed)}/${String(summary.total)} passed\n${diffs}`).toBe(`${String(summary.total)}/${String(summary.total)} passed\n`);
    });
  }
});
