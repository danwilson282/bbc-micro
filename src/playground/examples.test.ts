import { assemble, formatError } from '../asm/assembler';
import { Cpu6502, UnimplementedOpcodeError } from '../cpu/cpu6502';
import { TestBus } from '../memory/test-bus';
import { ARITHMETIC_SOURCE, DECIMAL_SOURCE, EXAMPLES, FILL_SOURCE, INCDEC_SOURCE, INTERRUPTS_SOURCE, LABELS_SOURCE, LOGIC_SOURCE, SHIFTS_SOURCE, STACK_SOURCE, SUBROUTINES_SOURCE, findExample } from './examples';
import { Doorbell } from './doorbell';
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

  it('runs: writes "BBC" to row 2, then runs into its data. &50 7C is BVC +&7C (Stage 14), into the NOPs and on to the BRK at &0500', () => {
    const bus = new TestBus();
    const result = assembled(LABELS_SOURCE);
    installProgram(bus, result.lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    let afterData: number | undefined;
    for (let i = 0; i < 200 && cpu.regs.pc !== 0x0500; i++) {
      const pc = cpu.regs.pc;
      cpu.step();
      if (pc === 0x041f) afterData = cpu.regs.pc;
    }
    expect(afterData).toBe(0x049d); // &0421 + &7C
    expect(cpu.regs.pc).toBe(0x0500);
    expect(bus.read(0x0500)).toBe(0x00);
    expect([0x7c50, 0x7c51, 0x7c52].map((a) => bus.read(a))).toEqual([0x42, 0x42, 0x43]);
  });

  it('runs off the end: the BRK at &0500 goes through the empty vector at &FFFE to &0000, where &7C is undocumented', () => {
    const bus = new TestBus();
    installProgram(bus, assembled(LABELS_SOURCE).lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    while (cpu.regs.pc !== 0x0500) cpu.step();
    expect(cpu.step()).toBe(7); // BRK
    expect(cpu.regs.pc).toBe(0x0000);
    expect(() => cpu.step()).toThrow(new UnimplementedOpcodeError(0x7c, 0x0000));
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

describe('the Stage 12 logic example', () => {
  interface After {
    readonly a: number;
    readonly n: boolean;
    readonly v: boolean;
    readonly z: boolean;
  }

  function trace(): { bus: TestBus; after: After[] } {
    const bus = new TestBus();
    installProgram(bus, assembled(LOGIC_SOURCE).lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const after: After[] = [];
    for (let i = 0; i < 24; i++) {
      cpu.step();
      const { a, n, v, z } = cpu.regs;
      after.push({ a, n, v, z });
    }
    return { bus, after };
  }

  it('masks A: &B5 → &05 → &C5 → &3A → &C5 → &00 (Z=1)', () => {
    const { after } = trace();
    expect(after.slice(0, 6).map((x) => x.a)).toEqual([0xb5, 0x05, 0xc5, 0x3a, 0xc5, 0x00]);
    expect(after[5]?.z).toBe(true);
  });

  it('swaps, lowers and raises case on the screen: "HELLO" ends as "HeLLO"', () => {
    const { bus, after } = trace();
    expect([after[7]?.a, after[10]?.a, after[13]?.a]).toEqual([0x68, 0x65, 0x48]);
    expect(String.fromCharCode(...[0, 1, 2, 3, 4].map((i) => bus.read(0x7c00 + i)))).toBe('HeLLO');
  });

  it('BIT &80 (&C1) with A=&01: Z=0, N=1, V=1, and A unchanged', () => {
    expect(trace().after[18]).toEqual({ a: 0x01, n: true, v: true, z: false });
  });

  it('BIT &80 (&C1) with A=&02: Z=1, with N and V still from memory', () => {
    expect(trace().after[20]).toEqual({ a: 0x02, n: true, v: true, z: true });
  });

  it('BIT on the space (&20) with A=&FF: N=0 and V=0 although A is negative', () => {
    expect(trace().after[22]).toEqual({ a: 0xff, n: false, v: false, z: false });
  });
});

describe('the Stage 13 shifts example', () => {
  interface After {
    readonly a: number;
    readonly n: boolean;
    readonly z: boolean;
    readonly c: boolean;
  }

  function trace(): { bus: TestBus; after: After[]; cycles: number[] } {
    const bus = new TestBus();
    installProgram(bus, assembled(SHIFTS_SOURCE).lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const after: After[] = [];
    const cycles: number[] = [];
    for (let i = 0; i < 22; i++) {
      cycles.push(cpu.step());
      const { a, n, z, c } = cpu.regs;
      after.push({ a, n, z, c });
    }
    return { bus, after, cycles };
  }

  it('multiplies 23 by 10 with shifts: &17 → &2E → &5C → &B8, then + &2E = &E6 (230)', () => {
    const { bus, after } = trace();
    expect([0, 2, 4, 5, 6].map((i) => after[i]?.a)).toEqual([0x17, 0x2e, 0x5c, 0xb8, 0xe6]);
    expect(after[5]?.c).toBe(false); // the last ASL leaves C=0 for the ADC
    expect(bus.read(0x82)).toBe(230);
  });

  it('halves with LSR, the remainder landing in C: 230 → 115 (C=0) → 57 (C=1)', () => {
    const { after } = trace();
    expect(after[8]).toEqual({ a: 115, n: false, z: false, c: false });
    expect(after[9]).toEqual({ a: 57, n: false, z: false, c: true });
  });

  it('ASL num doubles the byte in memory, in 5 cycles', () => {
    const { bus, cycles } = trace();
    expect(bus.read(0x80)).toBe(46);
    expect(cycles[10]).toBe(5);
  });

  it('ASL then ROL doubles the 16-bit word: &01C0 → &0380', () => {
    const { bus } = trace();
    expect([bus.read(0x84), bus.read(0x85)]).toEqual([0x80, 0x03]);
  });

  it('walks one bit round the 9-bit ring: C, then bit 7, then C, then bit 0', () => {
    const { after } = trace();
    expect(after.slice(18, 22)).toEqual([
      { a: 0x00, n: false, z: true, c: true },
      { a: 0x80, n: true, z: false, c: false },
      { a: 0x00, n: false, z: true, c: true },
      { a: 0x01, n: false, z: false, c: false },
    ]);
  });
});

describe('the Stage 14 fill example', () => {
  const SCREEN = 0x7c00;
  const SCREEN_END = 0x8000;

  /** Assembles and installs the example, and finds a label's address. */
  function setUp(): { cpu: Cpu6502; bus: TestBus; label: (name: string) => number } {
    const bus = new TestBus();
    const result = assembled(FILL_SOURCE);
    installProgram(bus, result.lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const label = (name: string): number => {
      const address = result.symbols.get(name);
      if (address === undefined) throw new Error(`no label ${name}`);
      return address;
    };
    return { cpu, bus, label };
  }

  /** Steps until PC reaches address (or a step limit), returning the cycles taken. */
  function runTo(cpu: Cpu6502, address: number, limit = 10_000_000): number {
    let cycles = 0;
    for (let i = 0; i < limit && cpu.regs.pc !== address; i++) cycles += cpu.step();
    return cycles;
  }

  function screen(bus: TestBus): Set<number> {
    const bytes = new Set<number>();
    for (let a = SCREEN; a < SCREEN_END; a++) bytes.add(bus.read(a));
    return bytes;
  }

  it('fills all four pages of screen memory with "A" on the first pass, in 10 + 10 + 11,311 cycles', () => {
    const { cpu, bus, label } = setUp();
    const cycles = runTo(cpu, label('wait') - 2); // the LDX #0 before wait
    expect(screen(bus)).toEqual(new Set([0x41]));
    expect(bus.read(SCREEN_END)).toBe(0x00); // and not a byte further
    // start (10), pass set-up (10), then 4 pages of 2,815 + 10 for INC/LDX/CPX, and BCC: 3 taken, 1 not
    expect(cycles).toBe(10 + 10 + 4 * (2815 + 10) + 3 * 3 + 2);
  });

  it('the wait loop takes 328,705 cycles: 256 × (256 × 5 − 1 + 5) − 1, plus LDX #0', () => {
    const { cpu, label } = setUp();
    runTo(cpu, label('wait') - 2);
    expect(runTo(cpu, label('next'))).toBe(2 + 256 * (256 * 5 - 1 + 5) - 1);
  });

  it('runs to its BRK with the screen full of "Z", in 8,841,075 cycles', () => {
    const { cpu, bus, label } = setUp();
    const brk = label('done');
    expect(bus.read(brk)).toBe(0x00);
    const cycles = runTo(cpu, brk);
    expect(cpu.regs.pc).toBe(brk);
    expect(screen(bus)).toEqual(new Set([0x5a]));
    expect(bus.read(0x82)).toBe(0x5b);
    // 10 at the start, 26 passes of 340,041 cycles, and the last BNE not taken (−1)
    expect(cycles).toBe(10 + 26 * 340_041 - 1);
  });
});

describe('the Stage 15 stack example', () => {
  function setUp(): { cpu: Cpu6502; bus: TestBus; label: (name: string) => number } {
    const bus = new TestBus();
    const result = assembled(STACK_SOURCE);
    installProgram(bus, result.lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const label = (name: string): number => {
      const address = result.symbols.get(name);
      if (address === undefined) throw new Error(`no label ${name}`);
      return address;
    };
    return { cpu, bus, label };
  }

  /** Runs n instructions and returns the cycles they took. */
  function steps(cpu: Cpu6502, n: number): number {
    let cycles = 0;
    for (let i = 0; i < n; i++) cycles += cpu.step();
    return cycles;
  }

  it('pushes &11, &22, &33 down from &01FF, then pulls them back in reverse order', () => {
    const { cpu, bus } = setUp();
    steps(cpu, 2); // LDX #&FF, TXS
    expect(cpu.regs.s).toBe(0xff);
    steps(cpu, 6); // three LDA/PHA pairs
    expect(cpu.regs.s).toBe(0xfc);
    expect([bus.read(0x01fd), bus.read(0x01fe), bus.read(0x01ff)]).toEqual([0x33, 0x22, 0x11]);
    const pulled = [0, 1, 2].map(() => {
      cpu.step();
      return cpu.regs.a;
    });
    expect(pulled).toEqual([0x33, 0x22, 0x11]);
    expect(cpu.regs.s).toBe(0xff);
    expect(bus.read(0x01fd)).toBe(0x33); // pulled, but still there
  });

  it('PHP pushes &3D (bits 5 and 4 set) and PLP brings C and D back', () => {
    const { cpu, bus } = setUp();
    steps(cpu, 11 + 3); // to PHP
    expect(bus.read(0x01ff)).toBe(0x3d);
    steps(cpu, 3); // CLC, CLD, PLP
    expect(cpu.regs).toMatchObject({ c: true, d: true, i: true, s: 0xff });
  });

  it('pushing &C0 and pulling it with PLP sets N and V and clears I', () => {
    const { cpu } = setUp();
    steps(cpu, 17 + 3); // LDA #&C0, PHA, PLP
    expect(cpu.regs).toMatchObject({ n: true, v: true, d: false, i: false, z: false, c: false, s: 0xff });
  });

  it('JMP over skips the BRK, then JMP (&10FF) lands on bug at &0480, not &0580', () => {
    const { cpu, bus, label } = setUp();
    steps(cpu, 20);
    expect(cpu.step()).toBe(3); // JMP over
    expect(cpu.regs.pc).toBe(label('over'));
    steps(cpu, 6);
    expect([bus.read(0x10ff), bus.read(0x1000), bus.read(0x1100)]).toEqual([0x80, 0x04, 0x05]);
    expect(cpu.step()).toBe(5); // JMP (&10FF)
    expect(label('bug')).toBe(0x0480);
    expect(cpu.regs.pc).toBe(0x0480);
  });

  it('ends with the stack wrapping: &0100 then &01FF, before stopping at its BRK', () => {
    const { cpu, bus, label } = setUp();
    steps(cpu, 28 + 5);
    expect(bus.read(0x0100)).toBe(0xaa);
    expect(bus.read(0x01ff)).toBe(0xaa); // the &11 pushed at the start is gone
    expect(cpu.regs.s).toBe(0xfe);
    expect(cpu.regs.pc).toBe(label('bug') + 7); // LDX #, TXS, LDA #, PHA, PHA: 2 + 1 + 2 + 1 + 1 bytes
    expect(bus.read(cpu.regs.pc)).toBe(0x00);
  });
});

describe('the Stage 16 subroutines example', () => {
  function setUp(): { cpu: Cpu6502; bus: TestBus; label: (name: string) => number } {
    const bus = new TestBus();
    const result = assembled(SUBROUTINES_SOURCE);
    installProgram(bus, result.lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    const label = (name: string): number => {
      const address = result.symbols.get(name);
      if (address === undefined) throw new Error(`no label ${name}`);
      return address;
    };
    return { cpu, bus, label };
  }

  /** Steps until PC reaches address for the nth time (1 = the first). */
  function stepTo(cpu: Cpu6502, address: number, nth = 1): void {
    let seen = 0;
    for (let i = 0; i < 1000; i++) {
      cpu.step();
      if (cpu.regs.pc === address && ++seen === nth) return;
    }
    throw new Error(`never reached &${address.toString(16)}`);
  }

  it('lays out main at &0400, square at &0423 and multiply at &0428', () => {
    const { label } = setUp();
    expect([label('start'), label('square'), label('multiply')]).toEqual([0x0400, 0x0423, 0x0428]);
  });

  it('the first JSR pushes &0409 (its own last byte), and RTS returns to &040A', () => {
    const { cpu, bus, label } = setUp();
    stepTo(cpu, label('multiply'));
    expect(cpu.regs.s).toBe(0xfd);
    expect([bus.read(0x01ff), bus.read(0x01fe)]).toEqual([0x04, 0x09]);
    stepTo(cpu, 0x040a);
    expect(cpu.regs.s).toBe(0xff);
    expect([cpu.regs.a, cpu.regs.x]).toEqual([0x8f, 0x00]); // 13 x 11 = 143
  });

  it('inside square\'s call to multiply, the stack holds both return addresses: &0412 then &0426', () => {
    const { cpu, bus, label } = setUp();
    stepTo(cpu, label('multiply'), 2);
    expect(cpu.regs.s).toBe(0xfb);
    expect([0x01ff, 0x01fe, 0x01fd, 0x01fc].map((a) => bus.read(a))).toEqual([0x04, 0x12, 0x04, 0x26]);
    stepTo(cpu, 0x0427); // multiply's RTS lands on square's RTS
    expect(cpu.regs.s).toBe(0xfd);
    stepTo(cpu, 0x0413); // and that one lands back in main
    expect(cpu.regs.s).toBe(0xff);
    expect([cpu.regs.a, cpu.regs.x]).toEqual([0x90, 0x00]); // 12 x 12 = 144
  });

  it('runs to its BRK at &0422 with 143, 144 and 30000 at &90-&95: 202 instructions, 640 cycles', () => {
    const { cpu, bus } = setUp();
    let instructions = 0;
    let cycles = 0;
    while (bus.read(cpu.regs.pc) !== 0x00) {
      cycles += cpu.step();
      instructions++;
    }
    expect(cpu.regs.pc).toBe(0x0422);
    expect([0x90, 0x91, 0x92, 0x93, 0x94, 0x95].map((a) => bus.read(a))).toEqual([0x8f, 0x00, 0x90, 0x00, 0x30, 0x75]);
    expect(instructions).toBe(202);
    expect(cycles).toBe(640);
    expect(cpu.regs.s).toBe(0xff);
  });

  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [255, 255, 65025],
    [16, 16, 256],
    [200, 150, 30000],
  ])('multiply works for %i x %i = %i', (a, x, product) => {
    const { cpu, label } = setUp();
    cpu.regs.s = 0xff;
    Object.assign(cpu.regs, { a, x, pc: label('multiply') });
    cpu.push(0x04); // return to &0500 (a BRK), as if called from &04FD
    cpu.push(0xff);
    while (cpu.regs.pc !== 0x0500) cpu.step();
    expect(cpu.regs.a | (cpu.regs.x << 8)).toBe(product);
  });
});

describe('the Stage 17 interrupts example', () => {
  const IRQS = 0x80;
  const NMIS = 0x81;
  const BRKS = 0x82;
  const MAIN = 0x84;

  /**
   * The example installed as the playground does it: CPU → Doorbell → TestBus,
   * with step() copying the doorbell's line to the CPU's IRQ pin afterwards.
   */
  function setUp(): { cpu: Cpu6502; bus: TestBus; bell: Doorbell; step: () => number; label: (name: string) => number } {
    const result = assembled(INTERRUPTS_SOURCE);
    const bus = new TestBus();
    installProgram(bus, result.lines, 0x0400);
    const bell = new Doorbell(bus);
    const cpu = new Cpu6502(bell);
    cpu.reset();
    const step = (): number => {
      const cycles = cpu.step();
      cpu.irq = bell.ringing;
      return cycles;
    };
    const label = (name: string): number => {
      const value = result.symbols.get(name);
      if (value === undefined) throw new Error(`no label ${name}`);
      return value;
    };
    return { cpu, bus, bell, step, label };
  }

  /** Steps until PC is at address, or throws after a generous limit. */
  function runTo(step: () => number, cpu: Cpu6502, address: number): void {
    for (let i = 0; i < 1000; i++) {
      if (cpu.regs.pc === address) return;
      step();
    }
    throw new Error(`never reached &${address.toString(16)}`);
  }

  it('puts its vectors at &FFFA-&FFFF: NMI, RESET and IRQ/BRK', () => {
    const { bus, label } = setUp();
    const at = (a: number): number => bus.read(a) | (bus.read(a + 1) << 8);
    expect([at(0xfffa), at(0xfffc), at(0xfffe)]).toEqual([label('nmi'), label('start'), label('irq')]);
    expect([label('start'), label('idle'), label('irq')]).toEqual([0x0400, 0x0406, 0x040f]);
  });

  it('BRK at &0404 pushes &0406 (skipping the padding byte) and P with B = 1, and is counted at &82', () => {
    const { cpu, bus, step, label } = setUp();
    runTo(step, cpu, 0x0404); // LDX, TXS, CLI
    expect(step()).toBe(7);
    expect(cpu.regs.pc).toBe(label('irq'));
    expect([bus.read(0x01ff), bus.read(0x01fe), bus.read(0x01fd)]).toEqual([0x04, 0x06, 0xb0]); // N (from LDX #&FF), bit 5, B
    runTo(step, cpu, label('idle'));
    expect([bus.read(IRQS), bus.read(NMIS), bus.read(BRKS)]).toEqual([0, 0, 1]);
    expect(cpu.regs.s).toBe(0xff);
    expect(cpu.regs.i).toBe(false);
  });

  it('an IRQ is told apart from BRK by B = 0, answered at &FC00, and counted at &80; the main loop carries on', () => {
    const { cpu, bus, bell, step, label } = setUp();
    runTo(step, cpu, label('idle'));
    for (let i = 0; i < 10; i++) step();
    const interrupted = cpu.regs.pc;
    bell.ring();
    cpu.irq = true;
    expect(step()).toBe(7);
    expect(bus.read(0x01fd)).toBe(0x20); // B = 0: a real IRQ
    expect((bus.read(0x01ff) << 8) | bus.read(0x01fe)).toBe(interrupted);
    runTo(step, cpu, interrupted);
    expect(bell.ringing).toBe(false);
    expect([bus.read(IRQS), bus.read(NMIS), bus.read(BRKS)]).toEqual([1, 0, 1]);
    const before = bus.read(MAIN);
    for (let i = 0; i < 9; i++) step();
    expect(bus.read(MAIN)).not.toBe(before);
  });

  it('an NMI goes to its own handler and is counted at &81, even with I set', () => {
    const { cpu, bus, step, label } = setUp();
    runTo(step, cpu, label('idle'));
    cpu.regs.i = true;
    cpu.setNmi(true);
    cpu.setNmi(false);
    step();
    expect(cpu.regs.pc).toBe(label('nmi'));
    step(); // INC nmis
    step(); // RTI
    expect(bus.read(NMIS)).toBe(1);
    expect(cpu.regs.i).toBe(true); // RTI put back the P it interrupted
  });

  it('without the STA doorbell, one IRQ press runs the handler for ever and the main loop stops', () => {
    const source = INTERRUPTS_SOURCE.replace(/^ *STA doorbell.*$/m, '');
    const result = assembled(source);
    const bus = new TestBus();
    installProgram(bus, result.lines, 0x0400);
    const bell = new Doorbell(bus);
    const cpu = new Cpu6502(bell);
    cpu.reset();
    for (let i = 0; i < 40; i++) cpu.step(); // through the BRK and into the main loop
    bell.ring();
    cpu.irq = bell.ringing;
    const main = bus.read(MAIN) | (bus.read(MAIN + 1) << 8);
    for (let i = 0; i < 1000; i++) cpu.step();
    expect(bus.read(IRQS)).toBeGreaterThan(50);
    expect(bus.read(MAIN) | (bus.read(MAIN + 1) << 8)).toBe(main);
  });
});

describe('the examples', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s assembles without errors', (_id, example) => {
    expect(assemble(example.source).ok).toBe(true);
  });

  it('falls back to the first example for an unknown or missing id', () => {
    expect(findExample('nope').id).toBe('interrupts');
    expect(findExample(null).id).toBe('interrupts');
  });
});
