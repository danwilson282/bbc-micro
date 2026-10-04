import { TestBus } from '../../memory/test-bus';
import { MODES, type AddressingMode } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { createRegisters, type Registers } from '../registers';
import { hex8, toSigned8 } from '../../util/bits';
import { ARITHMETIC, addWithCarry } from './arithmetic';

const PROGRAM = 0x0400;

/** A CPU on a flat 64K bus, reset to PROGRAM, with the given bytes there. */
function cpuWith(bytes: readonly number[]): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [PROGRAM & 0xff, PROGRAM >> 8]);
  bus.load(PROGRAM, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return { cpu, bus };
}

interface Flags {
  readonly a: number;
  readonly n: boolean;
  readonly v: boolean;
  readonly z: boolean;
  readonly c: boolean;
}

// The reference formulas work in plain integers, the way you'd do it on
// paper, and deliberately don't use the "invert the operand" trick. If the
// emulator's SBC = ADC(~M) shortcut were wrong, these would catch it.

/** ADC on paper: unsigned sum for A and C, signed sum for V. */
function referenceAdc(a: number, m: number, carry: boolean): Flags {
  const c = carry ? 1 : 0;
  const unsigned = a + m + c;
  const signed = toSigned8(a) + toSigned8(m) + c;
  const result = unsigned & 0xff;
  return { a: result, n: result >= 0x80, v: signed < -128 || signed > 127, z: result === 0, c: unsigned > 0xff };
}

/** SBC on paper: subtract the borrow (1 − C); C=1 afterwards means "didn't go below zero". */
function referenceSbc(a: number, m: number, carry: boolean): Flags {
  const borrow = carry ? 0 : 1;
  const unsigned = a - m - borrow;
  const signed = toSigned8(a) - toSigned8(m) - borrow;
  const result = unsigned & 0xff;
  return { a: result, n: result >= 0x80, v: signed < -128 || signed > 127, z: result === 0, c: unsigned >= 0 };
}

function flagsOf(r: Registers): Flags {
  return { a: r.a, n: r.n, v: r.v, z: r.z, c: r.c };
}

describe('the arithmetic opcode table', () => {
  it('has the 16 documented opcodes: 8 ADC, 8 SBC', () => {
    expect(ARITHMETIC.filter((d) => d.mnemonic === 'ADC')).toHaveLength(8);
    expect(ARITHMETIC.filter((d) => d.mnemonic === 'SBC')).toHaveLength(8);
  });

  it('puts ADC at aaa = %011 and SBC at aaa = %111, in the cc = %01 accumulator group', () => {
    for (const d of ARITHMETIC) {
      expect(d.opcode & 0x03).toBe(0x01);
      expect(d.opcode >> 5).toBe(d.mnemonic === 'ADC' ? 0b011 : 0b111);
    }
  });

  it('gives each opcode as many bytes as its mode needs: 1 + operand bytes', () => {
    for (const d of ARITHMETIC) expect(d.bytes).toBe(1 + MODES[d.mode].operandBytes);
  });

  it('uses the same modes and base cycles as LDA (it reads its operand the same way)', () => {
    for (const d of ARITHMETIC) {
      const lda = OPCODES[(d.opcode & 0x1f) | 0xa0];
      expect({ mode: d.mode, cycles: d.cycles }).toEqual({ mode: lda?.mode, cycles: lda?.cycles });
    }
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const d of ARITHMETIC) expect(OPCODES[d.opcode]?.mnemonic).toBe(d.mnemonic);
  });

  it("doesn't install the undocumented SBC # duplicate at &EB (Part 12)", () => {
    expect(OPCODES[0xeb]).toBeUndefined();
  });
});

describe('addWithCarry, the shared adder', () => {
  it('matches the paper formula for every A × operand × carry-in (131,072 cases)', () => {
    const regs = createRegisters();
    let mismatches = 0;
    for (let a = 0; a < 0x100; a++) {
      for (let m = 0; m < 0x100; m++) {
        for (const carry of [false, true]) {
          regs.a = a;
          regs.c = carry;
          addWithCarry(regs, m);
          const want = referenceAdc(a, m, carry);
          if (regs.a !== want.a || regs.n !== want.n || regs.v !== want.v || regs.z !== want.z || regs.c !== want.c) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it('leaves X, Y, S, PC, D and I alone', () => {
    const regs = createRegisters();
    Object.assign(regs, { x: 0x11, y: 0x22, s: 0x33, pc: 0x4444, d: true, i: true });
    addWithCarry(regs, 0xff);
    expect({ x: regs.x, y: regs.y, s: regs.s, pc: regs.pc, d: regs.d, i: regs.i }).toEqual({
      x: 0x11,
      y: 0x22,
      s: 0x33,
      pc: 0x4444,
      d: true,
      i: true,
    });
  });
});

describe('ADC and SBC through cpu.step(): exhaustive sweeps', () => {
  /** Runs `OP #m` with A and C set, for every A, m and C, and counts disagreements with the reference. */
  function sweep(opcode: number, reference: (a: number, m: number, c: boolean) => Flags): number {
    const { cpu, bus } = cpuWith([opcode, 0x00]);
    const r = cpu.regs;
    let mismatches = 0;
    for (let a = 0; a < 0x100; a++) {
      for (let m = 0; m < 0x100; m++) {
        for (const carry of [false, true]) {
          bus.write(PROGRAM + 1, m);
          r.pc = PROGRAM;
          r.a = a;
          r.c = carry;
          // Start each flag the opposite of the expected answer, so a flag that's never written can't pass by luck.
          const want = reference(a, m, carry);
          r.n = !want.n;
          r.v = !want.v;
          r.z = !want.z;
          cpu.step();
          const after = flagsOf(r);
          if (after.a !== want.a || after.n !== want.n || after.v !== want.v || after.z !== want.z || after.c !== want.c) {
            mismatches++;
          }
        }
      }
    }
    return mismatches;
  }

  it('ADC #&nn: A + M + C, for all 131,072 inputs', () => {
    expect(sweep(0x69, referenceAdc)).toBe(0);
  });

  it('SBC #&nn: A − M − (1 − C), for all 131,072 inputs (checks SBC = ADC of the inverted operand)', () => {
    expect(sweep(0xe9, referenceSbc)).toBe(0);
  });
});

describe('the overflow (V) truth table: sign bits of A, M and the result (C=0 in)', () => {
  // [A, M, result, C out, V]: one row per combination of the three sign bits.
  const ROWS: readonly (readonly [number, number, number, boolean, boolean])[] = [
    [0x50, 0x10, 0x60, false, false], // + + → +
    [0x50, 0x50, 0xa0, false, true], //  + + → −   +80 + 80 = +160 doesn't fit
    [0x50, 0xd0, 0x20, true, false], //  + − → +
    [0x50, 0x90, 0xe0, false, false], // + − → −
    [0xd0, 0x50, 0x20, true, false], //  − + → +
    [0xd0, 0x10, 0xe0, false, false], // − + → −
    [0xd0, 0x90, 0x60, true, true], //   − − → +   −48 − 112 = −160 doesn't fit
    [0xd0, 0xd0, 0xa0, true, false], //  − − → −
  ];

  it.each(ROWS.map(([a, m, result, c, v]) => [hex8(a), hex8(m), hex8(result), c, v, a, m, result] as const))(
    'ADC: &%s + &%s = &%s, C=%s, V=%s',
    (_a, _m, _r, c, v, a, m, result) => {
      const { cpu } = cpuWith([0x69, m]);
      cpu.regs.a = a;
      cpu.step();
      expect({ a: cpu.regs.a, c: cpu.regs.c, v: cpu.regs.v }).toEqual({ a: result, c, v });
    },
  );

  it('V and C are independent: all four combinations appear', () => {
    const seen = new Set(ROWS.map(([, , , c, v]) => `${String(c)}/${String(v)}`));
    expect(seen.size).toBe(4);
  });

  it('SBC: &50 − &B0 (+80 − −80) overflows to &A0, and C=0 because it borrowed', () => {
    const { cpu } = cpuWith([0xe9, 0xb0]);
    cpu.regs.a = 0x50;
    cpu.regs.c = true;
    cpu.step();
    expect({ a: cpu.regs.a, v: cpu.regs.v, c: cpu.regs.c, n: cpu.regs.n }).toEqual({ a: 0xa0, v: true, c: false, n: true });
  });

  it('SBC: &D0 − &70 (−48 − 112) overflows to &60, and C=1 because no borrow was needed', () => {
    const { cpu } = cpuWith([0xe9, 0x70]);
    cpu.regs.a = 0xd0;
    cpu.regs.c = true;
    cpu.step();
    expect({ a: cpu.regs.a, v: cpu.regs.v, c: cpu.regs.c }).toEqual({ a: 0x60, v: true, c: true });
  });
});

describe('carry in and out', () => {
  it('ADC adds the carry in: &10 + &20 is &30 with C=0, &31 with C=1', () => {
    for (const [carry, sum] of [
      [false, 0x30],
      [true, 0x31],
    ] as const) {
      const { cpu } = cpuWith([0x69, 0x20]);
      cpu.regs.a = 0x10;
      cpu.regs.c = carry;
      cpu.step();
      expect(cpu.regs.a).toBe(sum);
    }
  });

  it('ADC: &FF + &01 = &00 sets both Z and C (unlike INX, which leaves C alone)', () => {
    const { cpu } = cpuWith([0x69, 0x01]);
    cpu.regs.a = 0xff;
    cpu.step();
    expect(flagsOf(cpu.regs)).toEqual({ a: 0x00, n: false, v: false, z: true, c: true });
  });

  it('ADC: &FF + &FF + 1 = &1FF, the largest possible sum: A=&FF, C=1', () => {
    const { cpu } = cpuWith([0x69, 0xff]);
    cpu.regs.a = 0xff;
    cpu.regs.c = true;
    cpu.step();
    expect(flagsOf(cpu.regs)).toEqual({ a: 0xff, n: true, v: false, z: false, c: true });
  });

  it('SBC with C=1 (no borrow in): &05 − &03 = &02, C stays 1', () => {
    const { cpu } = cpuWith([0xe9, 0x03]);
    cpu.regs.a = 0x05;
    cpu.regs.c = true;
    cpu.step();
    expect({ a: cpu.regs.a, c: cpu.regs.c }).toEqual({ a: 0x02, c: true });
  });

  it('SBC with C=0 (borrow in): &05 − &03 − 1 = &01', () => {
    const { cpu } = cpuWith([0xe9, 0x03]);
    cpu.regs.a = 0x05;
    cpu.regs.c = false;
    cpu.step();
    expect({ a: cpu.regs.a, c: cpu.regs.c }).toEqual({ a: 0x01, c: true });
  });

  it('SBC that goes below zero borrows: &03 − &05 = &FE, C=0, N=1', () => {
    const { cpu } = cpuWith([0xe9, 0x05]);
    cpu.regs.a = 0x03;
    cpu.regs.c = true;
    cpu.step();
    expect(flagsOf(cpu.regs)).toEqual({ a: 0xfe, n: true, v: false, z: false, c: false });
  });

  it('SBC of equal values gives &00 with Z=1 and C=1 (A ≥ M, so no borrow)', () => {
    const { cpu } = cpuWith([0xe9, 0x42]);
    cpu.regs.a = 0x42;
    cpu.regs.c = true;
    cpu.step();
    expect(flagsOf(cpu.regs)).toEqual({ a: 0x00, n: false, v: false, z: true, c: true });
  });
});

describe('16-bit arithmetic: the carry hands off from the low byte to the high byte', () => {
  it('&03E8 + &012C = &0514 (1000 + 300 = 1300)', () => {
    // LDA #&E8, ADC #&2C, STA &80, LDA #&03, ADC #&01, STA &81
    const { cpu, bus } = cpuWith([0xa9, 0xe8, 0x69, 0x2c, 0x85, 0x80, 0xa9, 0x03, 0x69, 0x01, 0x85, 0x81]);
    cpu.regs.c = false;
    for (let i = 0; i < 6; i++) cpu.step();
    expect([bus.read(0x80), bus.read(0x81)]).toEqual([0x14, 0x05]);
    expect(cpu.regs.c).toBe(false);
  });

  it('&0514 − &03E8 = &012C (1300 − 1000 = 300)', () => {
    // LDA #&14, SBC #&E8, STA &80, LDA #&05, SBC #&03, STA &81
    const { cpu, bus } = cpuWith([0xa9, 0x14, 0xe9, 0xe8, 0x85, 0x80, 0xa9, 0x05, 0xe9, 0x03, 0x85, 0x81]);
    cpu.regs.c = true;
    for (let i = 0; i < 6; i++) cpu.step();
    expect([bus.read(0x80), bus.read(0x81)]).toEqual([0x2c, 0x01]);
    expect(cpu.regs.c).toBe(true);
  });
});

describe('each opcode and addressing mode', () => {
  interface Case {
    readonly opcode: number;
    readonly asm: string;
    readonly mode: AddressingMode;
    readonly bytes: readonly number[];
    readonly x?: number;
    readonly y?: number;
    readonly memory?: readonly (readonly [number, number])[];
    /** Where the operand is read from. */
    readonly ea: number;
    readonly cycles: number;
  }

  const POINTER: readonly (readonly [number, number])[] = [
    [0x0074, 0x00],
    [0x0075, 0x30],
  ];

  /** The eight modes of one instruction, none crossing a page. */
  function modes(mnemonic: 'ADC' | 'SBC', base: number): Case[] {
    return [
      { opcode: base | 0x08, asm: `${mnemonic} #&nn`, mode: 'immediate', bytes: [base | 0x08, 0x00], ea: 0x0401, cycles: 2 },
      { opcode: base | 0x04, asm: `${mnemonic} &70`, mode: 'zeroPage', bytes: [base | 0x04, 0x70], ea: 0x0070, cycles: 3 },
      { opcode: base | 0x14, asm: `${mnemonic} &70,X`, mode: 'zeroPageX', bytes: [base | 0x14, 0x70], x: 0x05, ea: 0x0075, cycles: 4 },
      { opcode: base | 0x0c, asm: `${mnemonic} &3000`, mode: 'absolute', bytes: [base | 0x0c, 0x00, 0x30], ea: 0x3000, cycles: 4 },
      { opcode: base | 0x1c, asm: `${mnemonic} &3000,X`, mode: 'absoluteX', bytes: [base | 0x1c, 0x00, 0x30], x: 0x05, ea: 0x3005, cycles: 4 },
      { opcode: base | 0x18, asm: `${mnemonic} &3000,Y`, mode: 'absoluteY', bytes: [base | 0x18, 0x00, 0x30], y: 0x05, ea: 0x3005, cycles: 4 },
      { opcode: base | 0x00, asm: `${mnemonic} (&70,X)`, mode: 'indexedIndirectX', bytes: [base, 0x70], x: 0x04, memory: POINTER, ea: 0x3000, cycles: 6 },
      { opcode: base | 0x10, asm: `${mnemonic} (&74),Y`, mode: 'indirectIndexedY', bytes: [base | 0x10, 0x74], y: 0x05, memory: POINTER, ea: 0x3005, cycles: 5 },
    ];
  }

  const CASES: readonly Case[] = [...modes('ADC', 0x61), ...modes('SBC', 0xe1)];

  function run(c: Case, operand: number): { cpu: Cpu6502; cycles: number } {
    const { cpu, bus } = cpuWith(c.bytes);
    cpu.regs.x = c.x ?? 0;
    cpu.regs.y = c.y ?? 0;
    for (const [address, value] of c.memory ?? []) bus.write(address, value);
    bus.write(c.ea, operand);
    cpu.regs.a = 0x50;
    cpu.regs.c = true;
    return { cpu, cycles: cpu.step() };
  }

  it('covers every row in the table', () => {
    expect(CASES.map((c) => c.opcode).sort()).toEqual(ARITHMETIC.map((d) => d.opcode).sort());
  });

  describe.each(CASES.map((c) => [`${c.asm} (&${hex8(c.opcode)})`, c] as const))('%s', (_name, c) => {
    const isAdc = c.asm.startsWith('ADC');

    it(`reads its operand from &${c.ea.toString(16).toUpperCase().padStart(4, '0')}`, () => {
      // &50 + &10 + 1 = &61; &50 − &10 − 0 = &40
      expect(run(c, 0x10).cpu.regs.a).toBe(isAdc ? 0x61 : 0x40);
    });

    it('sets N, V, Z and C from the result', () => {
      // ADC: &50 + &2F + 1 = &80 (+80 + 47 + 1 = +128 doesn't fit: V). SBC: &50 − &50 = &00 (Z, no borrow).
      const { cpu } = run(c, isAdc ? 0x2f : 0x50);
      expect(flagsOf(cpu.regs)).toEqual(
        isAdc ? { a: 0x80, n: true, v: true, z: false, c: false } : { a: 0x00, n: false, v: false, z: true, c: true },
      );
    });

    it('leaves X, Y, S, D, I and memory alone', () => {
      const { cpu, bus } = cpuWith(c.bytes);
      const r = cpu.regs;
      r.x = c.x ?? 0;
      r.y = c.y ?? 0;
      for (const [address, value] of c.memory ?? []) bus.write(address, value);
      bus.write(c.ea, 0x10);
      const s = r.s;
      cpu.step();
      expect({ x: r.x, y: r.y, s: r.s, d: r.d, i: r.i, operand: bus.read(c.ea) }).toEqual({
        x: c.x ?? 0,
        y: c.y ?? 0,
        s,
        d: false,
        i: true, // reset set it
        operand: 0x10,
      });
    });

    it(`advances PC by ${String(c.bytes.length)} and takes ${String(c.cycles)} cycles`, () => {
      const { cpu, cycles } = run(c, 0x00);
      expect(cycles).toBe(c.cycles);
      expect(cpu.regs.pc).toBe(PROGRAM + c.bytes.length);
    });
  });
});

describe('page crossings cost +1, as for LDA', () => {
  // Each reads &3108: &30F8 + &10 carries into the high byte. For (&80),Y the pointer at &80/&81 holds &30F8.
  const CROSSING: readonly { asm: string; bytes: readonly number[]; x?: number; y?: number; cycles: number }[] = [
    { asm: 'ADC &30F8,X', bytes: [0x7d, 0xf8, 0x30], x: 0x10, cycles: 5 },
    { asm: 'ADC &30F8,Y', bytes: [0x79, 0xf8, 0x30], y: 0x10, cycles: 5 },
    { asm: 'ADC (&80),Y', bytes: [0x71, 0x80], y: 0x10, cycles: 6 },
    { asm: 'SBC &30F8,X', bytes: [0xfd, 0xf8, 0x30], x: 0x10, cycles: 5 },
    { asm: 'SBC &30F8,Y', bytes: [0xf9, 0xf8, 0x30], y: 0x10, cycles: 5 },
    { asm: 'SBC (&80),Y', bytes: [0xf1, 0x80], y: 0x10, cycles: 6 },
  ];

  it.each(CROSSING)('$asm reads &3108 and takes $cycles cycles', ({ asm, bytes, x, y, cycles }) => {
    const isSbc = asm.startsWith('SBC');
    const { cpu, bus } = cpuWith(bytes);
    bus.load(0x0080, [0xf8, 0x30]);
    bus.write(0x3108, 0x01);
    cpu.regs.x = x ?? 0;
    cpu.regs.y = y ?? 0;
    cpu.regs.a = 0x10;
    cpu.regs.c = isSbc; // SBC: no borrow in; ADC: no carry in
    expect(cpu.step()).toBe(cycles);
    expect(cpu.regs.a).toBe(isSbc ? 0x0f : 0x11);
  });
});
