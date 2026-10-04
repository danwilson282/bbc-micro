import { assemble, formatError } from '../asm/assembler';
import { Cpu6502, UnimplementedOpcodeError } from '../cpu/cpu6502';
import { TestBus } from '../memory/test-bus';
import { ARITHMETIC_SOURCE, DECIMAL_SOURCE, EXAMPLES, INCDEC_SOURCE, LABELS_SOURCE, findExample } from './examples';
import { LOADS_PROGRAM } from './loads-program';
import { installProgram } from './setup';
import { STORES_PROGRAM } from './stores-program';

function assembled(source: string): Extract<ReturnType<typeof assemble>, { ok: true }> {
  const result = assemble(source);
  if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
  return result;
}

describe('the assembler agrees with our hand assembly', () => {
  it.each([
    ['stores', STORES_PROGRAM],
    ['loads', LOADS_PROGRAM],
  ] as const)('the Stage %s program assembles to the same addresses, bytes, source and comments', (id, listing) => {
    const result = assembled(findExample(id).source);
    expect(result.lines.map(({ address, bytes, source, comment }) => ({ address, bytes, source, comment }))).toEqual(
      listing.map(({ address, bytes, source, comment }) => ({ address, bytes, source, comment })),
    );
  });
});

describe('the Stage 08 labels example', () => {
  it('lays out code at &0400 and data straight after it', () => {
    const result = assembled(LABELS_SOURCE);
    expect(result.symbols).toEqual(
      new Map([
        ['screen', 0x7c00],
        ['row2', 0x7c50],
        ['ptr', 0x80],
        ['start', 0x0400],
        ['target', 0x041f],
        ['message', 0x0421],
      ]),
    );
    expect(result.entry).toBe(0x0400);
  });

  it('assembles the forward reference as absolute and the known constant as zero page', () => {
    const { lines } = assembled(LABELS_SOURCE);
    expect(lines.at(0)?.bytes).toEqual([0xad, 0x1f, 0x04]);
    expect(lines.at(1)?.bytes).toEqual([0x85, 0x80]);
  });

  it('stores .word row2 low byte first', () => {
    const target = assembled(LABELS_SOURCE).lines.find((line) => line.source.startsWith('target:'));
    expect(target?.bytes).toEqual([0x50, 0x7c]);
  });

  it('runs: writes "BBC" to row 2 of the screen, then stops at the data (&50 is not implemented)', () => {
    const bus = new TestBus();
    const result = assembled(LABELS_SOURCE);
    installProgram(bus, result.lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    let error: unknown;
    for (let i = 0; i < 20 && error === undefined; i++) {
      try {
        cpu.step();
      } catch (e) {
        error = e;
      }
    }
    expect(error).toBeInstanceOf(UnimplementedOpcodeError);
    expect(cpu.regs.pc).toBe(0x041f);
    expect([0x7c50, 0x7c51, 0x7c52].map((a) => bus.read(a))).toEqual([0x42, 0x42, 0x43]);
  });
});

describe('the Stage 09 increment & decrement example', () => {
  /** Runs the example one step at a time, noting X, &80 and the flags after each. */
  interface After {
    readonly x: number;
    readonly count: number;
    readonly n: boolean;
    readonly z: boolean;
    readonly c: boolean;
  }

  function trace(): { cpu: Cpu6502; bus: TestBus; after: After[] } {
    const bus = new TestBus();
    installProgram(bus, assembled(INCDEC_SOURCE).lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const after: After[] = [];
    for (let i = 0; i < 16; i++) {
      cpu.step();
      after.push({ x: cpu.regs.x, count: bus.read(0x80), n: cpu.regs.n, z: cpu.regs.z, c: cpu.regs.c });
    }
    return { cpu, bus, after };
  }

  it('X wraps &FE → &FF → &00 → &FF, with Z on only at &00', () => {
    const { after } = trace();
    expect(after.slice(0, 4).map(({ x, n, z }) => ({ x, n, z }))).toEqual([
      { x: 0xfe, n: true, z: false },
      { x: 0xff, n: true, z: false },
      { x: 0x00, n: false, z: true },
      { x: 0xff, n: true, z: false },
    ]);
  });

  it('the counter at &80 wraps &FE → &FF → &00 → &FF in memory', () => {
    const { after } = trace();
    expect(after.slice(8, 12).map(({ count, z }) => ({ count, z }))).toEqual([
      { count: 0xfe, z: false },
      { count: 0xff, z: false },
      { count: 0x00, z: true },
      { count: 0xff, z: false },
    ]);
  });

  it('never changes C, and leaves "H" on the screen after INC then DEC', () => {
    const { cpu, bus, after } = trace();
    expect(after.every(({ c }) => !c)).toBe(true);
    expect(bus.read(0x7c00)).toBe(0x48);
    expect(cpu.regs.a).toBe(0xfe);
    expect(cpu.cycles).toBe(7 + 51);
  });
});

describe('the Stage 10 binary arithmetic example', () => {
  interface After {
    readonly a: number;
    readonly c: boolean;
    readonly v: boolean;
  }

  function trace(): { cpu: Cpu6502; bus: TestBus; after: After[] } {
    const bus = new TestBus();
    installProgram(bus, assembled(ARITHMETIC_SOURCE).lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const after: After[] = [];
    for (let i = 0; i < 17; i++) {
      cpu.step();
      after.push({ a: cpu.regs.a, c: cpu.regs.c, v: cpu.regs.v });
    }
    return { cpu, bus, after };
  }

  it('adds &03E8 + &012C: the low ADC carries out (C=1) and the high ADC takes it in', () => {
    const { after } = trace();
    expect(after[1]).toEqual({ a: 0x14, c: true, v: false });
    expect(after[4]).toEqual({ a: 0x05, c: false, v: false });
  });

  it('stores the 16-bit sum &0514 (1300) low byte first at &80/&81', () => {
    const { bus } = trace();
    expect([bus.read(0x80), bus.read(0x81)]).toEqual([0x14, 0x05]);
  });

  it('shows two signed overflows: &50 + &50 (V=1, C=0) and &D0 + &90 (V=1, C=1)', () => {
    const { after } = trace();
    expect(after[7]).toEqual({ a: 0xa0, c: false, v: true });
    expect(after[9]).toEqual({ a: 0x60, c: true, v: true });
  });

  it('subtracts back to &012C (300) at &82/&83, borrowing from the high byte', () => {
    const { bus, after } = trace();
    expect(after[11]).toEqual({ a: 0x2c, c: false, v: false });
    expect(after[14]).toEqual({ a: 0x01, c: true, v: false });
    expect([bus.read(0x82), bus.read(0x83)]).toEqual([0x2c, 0x01]);
  });
});

describe('the Stage 11 decimal mode example', () => {
  interface After {
    readonly a: number;
    readonly n: boolean;
    readonly z: boolean;
    readonly c: boolean;
    readonly d: boolean;
  }

  function trace(): { bus: TestBus; after: After[] } {
    const bus = new TestBus();
    installProgram(bus, assembled(DECIMAL_SOURCE).lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const after: After[] = [];
    for (let i = 0; i < 22; i++) {
      cpu.step();
      const { a, n, z, c, d } = cpu.regs;
      after.push({ a, n, z, c, d });
    }
    return { bus, after };
  }

  it('turns decimal mode on, and &09 + &01 gives &10', () => {
    const { after } = trace();
    expect(after[0]?.d).toBe(true);
    expect(after[2]).toMatchObject({ a: 0x10, c: false });
  });

  it('adds 10 points to 0995: the low byte carries the hundred, and &80/&81 hold 05 10', () => {
    const { after } = trace();
    expect(after[4]).toMatchObject({ a: 0x05, c: true });
    expect(after[8]).toMatchObject({ a: 0x10, c: false });
  });

  it('shows the Z quirk both ways: &80 + &80 = &60 with Z=1, and &98 + &01 + 1 = &00 with Z=0 and N=1', () => {
    const { after } = trace();
    expect(after[10]).toEqual({ a: 0x60, n: false, z: true, c: true, d: true });
    expect(after[18]).toEqual({ a: 0x00, n: true, z: false, c: true, d: true });
  });

  it('takes 6 points off 1005, borrowing across the bytes: &80/&81 end as 99 09 (0999)', () => {
    const { bus, after } = trace();
    expect(after[12]).toMatchObject({ a: 0x99, c: false });
    expect(after[15]).toMatchObject({ a: 0x09, c: true });
    expect([bus.read(0x80), bus.read(0x81)]).toEqual([0x99, 0x09]);
  });

  it('after CLD, &10 − &01 is binary again: &0F', () => {
    const { after } = trace();
    expect(after[19]?.d).toBe(false);
    expect(after[21]?.a).toBe(0x0f);
  });
});

describe('the examples', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s assembles without errors', (_id, example) => {
    expect(assemble(example.source).ok).toBe(true);
  });

  it('falls back to the first example for an unknown or missing id', () => {
    expect(findExample('nope').id).toBe('decimal');
    expect(findExample(null).id).toBe('decimal');
  });
});
