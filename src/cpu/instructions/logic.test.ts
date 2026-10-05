import { TestBus } from '../../memory/test-bus';
import { MODES, type AddressingMode } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { createRegisters } from '../registers';
import { hex16, hex8 } from '../../util/bits';
import { LOGIC, and, bit, eor, or } from './logic';

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

type Mnemonic = 'AND' | 'ORA' | 'EOR';

/** The truth tables, one bit at a time, written out longhand rather than with JS's & | ^. */
const TRUTH: Readonly<Record<Mnemonic, (a: boolean, m: boolean) => boolean>> = {
  AND: (a, m) => a && m,
  ORA: (a, m) => a || m,
  EOR: (a, m) => a !== m,
};

/** Builds the answer bit by bit from a truth table, as the ALU does: no bit affects another. */
function reference(mnemonic: Mnemonic, a: number, m: number): number {
  let result = 0;
  for (let b = 0; b < 8; b++) {
    if (TRUTH[mnemonic]((a >> b) & 1 ? true : false, (m >> b) & 1 ? true : false)) result |= 1 << b;
  }
  return result;
}

const ALU = { AND: and, ORA: or, EOR: eor } as const;

describe('the logic opcode table', () => {
  it('has the 26 documented opcodes: 8 each of AND, ORA and EOR, and 2 BIT', () => {
    const count = (m: string): number => LOGIC.filter((d) => d.mnemonic === m).length;
    expect([count('AND'), count('ORA'), count('EOR'), count('BIT')]).toEqual([8, 8, 8, 2]);
    expect(LOGIC).toHaveLength(26);
  });

  it('puts ORA at aaa = %000, AND at %001 and EOR at %010, in the cc = %01 accumulator group', () => {
    const AAA: Readonly<Record<string, number>> = { ORA: 0b000, AND: 0b001, EOR: 0b010 };
    for (const d of LOGIC.filter((row) => row.mnemonic !== 'BIT')) {
      expect(d.opcode & 0x03).toBe(0x01);
      expect(d.opcode >> 5).toBe(AAA[d.mnemonic]);
    }
  });

  it('gives AND, ORA and EOR the same mode and base cycles as LDA at the same bbb', () => {
    for (const d of LOGIC.filter((row) => row.mnemonic !== 'BIT')) {
      const lda = OPCODES[(d.opcode & 0x1f) | 0xa0];
      expect({ mode: d.mode, cycles: d.cycles }).toEqual({ mode: lda?.mode, cycles: lda?.cycles });
    }
  });

  it('gives BIT only zero page (&24, 3 cycles) and absolute (&2C, 4 cycles)', () => {
    const bits = LOGIC.filter((d) => d.mnemonic === 'BIT').map(({ opcode, mode, bytes, cycles }) => ({ opcode, mode, bytes, cycles }));
    expect(bits).toEqual([
      { opcode: 0x24, mode: 'zeroPage', bytes: 2, cycles: 3 },
      { opcode: 0x2c, mode: 'absolute', bytes: 3, cycles: 4 },
    ]);
  });

  it('gives each opcode as many bytes as its mode needs: 1 + operand bytes', () => {
    for (const d of LOGIC) expect(d.bytes).toBe(1 + MODES[d.mode].operandBytes);
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const d of LOGIC) expect(OPCODES[d.opcode]?.mnemonic).toBe(d.mnemonic);
  });

  it("leaves &89 empty: BIT # is a 65C02 addition, not on the Model B's NMOS 6502", () => {
    expect(OPCODES[0x89]).toBeUndefined();
  });
});

describe.each(['AND', 'ORA', 'EOR'] as const)('%s, the ALU function', (mnemonic) => {
  it('matches its truth table, bit by bit, for every A × M (65,536 cases)', () => {
    const regs = createRegisters();
    let mismatches = 0;
    for (let a = 0; a < 0x100; a++) {
      for (let m = 0; m < 0x100; m++) {
        regs.a = a;
        ALU[mnemonic](regs, m);
        const want = reference(mnemonic, a, m);
        if (regs.a !== want || regs.n !== want >= 0x80 || regs.z !== (want === 0)) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it.each([false, true])('leaves V, C, D and I alone (all %s), and X, Y, S, PC', (flag) => {
    const regs = createRegisters();
    Object.assign(regs, { a: 0xff, x: 0x11, y: 0x22, s: 0x33, pc: 0x4444, v: flag, c: flag, d: flag, i: flag });
    ALU[mnemonic](regs, 0x0f);
    expect({ x: regs.x, y: regs.y, s: regs.s, pc: regs.pc, v: regs.v, c: regs.c, d: regs.d, i: regs.i }).toEqual({
      x: 0x11,
      y: 0x22,
      s: 0x33,
      pc: 0x4444,
      v: flag,
      c: flag,
      d: flag,
      i: flag,
    });
  });
});

describe('masks: clear, set and toggle', () => {
  it('AND clears the bits that are 0 in the mask: &B5 AND &0F = &05 (keep the low nibble)', () => {
    const regs = createRegisters();
    regs.a = 0xb5;
    and(regs, 0x0f);
    expect(regs.a).toBe(0x05);
  });

  it('ORA sets the bits that are 1 in the mask: &05 ORA &C0 = &C5, and N=1 from bit 7', () => {
    const regs = createRegisters();
    regs.a = 0x05;
    or(regs, 0xc0);
    expect({ a: regs.a, n: regs.n, z: regs.z }).toEqual({ a: 0xc5, n: true, z: false });
  });

  it('EOR #&FF is NOT: &C5 → &3A, and a second EOR #&FF puts it back', () => {
    const regs = createRegisters();
    regs.a = 0xc5;
    eor(regs, 0xff);
    expect(regs.a).toBe(0x3a);
    eor(regs, 0xff);
    expect(regs.a).toBe(0xc5);
  });

  it('AND with no bits in common gives Z=1: &C5 AND &30 = &00', () => {
    const regs = createRegisters();
    regs.a = 0xc5;
    and(regs, 0x30);
    expect({ a: regs.a, n: regs.n, z: regs.z }).toEqual({ a: 0x00, n: false, z: true });
  });

  it('EOR of a value with itself is &00 (Z=1)', () => {
    const regs = createRegisters();
    regs.a = 0x5a;
    eor(regs, 0x5a);
    expect({ a: regs.a, z: regs.z }).toEqual({ a: 0x00, z: true });
  });

  it.each([
    ['EOR #&20 swaps the case of a letter', 'EOR', 0x48, 0x20, 0x68], // H → h
    ['EOR #&20 swaps it back', 'EOR', 0x68, 0x20, 0x48], // h → H
    ['ORA #&20 forces lower case', 'ORA', 0x45, 0x20, 0x65], // E → e
    ['ORA #&20 leaves lower case alone', 'ORA', 0x65, 0x20, 0x65], // e → e
    ['AND #&DF forces upper case', 'AND', 0x68, 0xdf, 0x48], // h → H
    ['AND #&DF leaves upper case alone', 'AND', 0x48, 0xdf, 0x48], // H → H
  ] as const)('ASCII: %s (&%s)', (_name, mnemonic, a, m, want) => {
    const regs = createRegisters();
    regs.a = a;
    ALU[mnemonic](regs, m);
    expect(String.fromCharCode(regs.a)).toBe(String.fromCharCode(want));
  });
});

describe('bit, the BIT test', () => {
  it('for every A × M (65,536 cases): Z = (A AND M) is 0, N = M bit 7, V = M bit 6, A unchanged', () => {
    const regs = createRegisters();
    let mismatches = 0;
    for (let a = 0; a < 0x100; a++) {
      for (let m = 0; m < 0x100; m++) {
        regs.a = a;
        // Start each flag the opposite of the expected answer, so a flag that's never written can't pass by luck.
        regs.n = (m & 0x80) === 0;
        regs.v = (m & 0x40) === 0;
        regs.z = (a & m) !== 0;
        bit(regs, m);
        if (regs.a !== a || regs.z !== ((a & m) === 0) || regs.n !== ((m & 0x80) !== 0) || regs.v !== ((m & 0x40) !== 0)) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('A=&01, M=&C1: Z=0 (bit 0 in common), N=1 and V=1 from M, A still &01', () => {
    const regs = createRegisters();
    regs.a = 0x01;
    bit(regs, 0xc1);
    expect({ a: regs.a, z: regs.z, n: regs.n, v: regs.v }).toEqual({ a: 0x01, z: false, n: true, v: true });
  });

  it('N and V come from M, not from A AND M: A=&00, M=&C0 gives Z=1 but N=1, V=1', () => {
    const regs = createRegisters();
    regs.a = 0x00;
    bit(regs, 0xc0);
    expect({ z: regs.z, n: regs.n, v: regs.v }).toEqual({ z: true, n: true, v: true });
  });

  it('A plays no part in N: A=&FF (negative), M=&20 gives N=0, V=0, Z=0', () => {
    const regs = createRegisters();
    regs.a = 0xff;
    regs.n = true;
    regs.v = true;
    bit(regs, 0x20);
    expect({ a: regs.a, z: regs.z, n: regs.n, v: regs.v }).toEqual({ a: 0xff, z: false, n: false, v: false });
  });

  it.each([false, true])('leaves C, D and I alone (all %s), and X, Y, S', (flag) => {
    const regs = createRegisters();
    Object.assign(regs, { x: 0x11, y: 0x22, s: 0x33, c: flag, d: flag, i: flag });
    bit(regs, 0xff);
    expect({ x: regs.x, y: regs.y, s: regs.s, c: regs.c, d: regs.d, i: regs.i }).toEqual({ x: 0x11, y: 0x22, s: 0x33, c: flag, d: flag, i: flag });
  });
});

describe('each opcode and addressing mode', () => {
  interface Case {
    readonly mnemonic: Mnemonic | 'BIT';
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

  /** The eight modes of one instruction, none crossing a page. base is the (zp,X) opcode, bbb = %000. */
  function modes(mnemonic: Mnemonic, base: number): Case[] {
    return [
      { mnemonic, opcode: base | 0x08, asm: `${mnemonic} #&nn`, mode: 'immediate', bytes: [base | 0x08, 0x00], ea: 0x0401, cycles: 2 },
      { mnemonic, opcode: base | 0x04, asm: `${mnemonic} &70`, mode: 'zeroPage', bytes: [base | 0x04, 0x70], ea: 0x0070, cycles: 3 },
      { mnemonic, opcode: base | 0x14, asm: `${mnemonic} &70,X`, mode: 'zeroPageX', bytes: [base | 0x14, 0x70], x: 0x05, ea: 0x0075, cycles: 4 },
      { mnemonic, opcode: base | 0x0c, asm: `${mnemonic} &3000`, mode: 'absolute', bytes: [base | 0x0c, 0x00, 0x30], ea: 0x3000, cycles: 4 },
      { mnemonic, opcode: base | 0x1c, asm: `${mnemonic} &3000,X`, mode: 'absoluteX', bytes: [base | 0x1c, 0x00, 0x30], x: 0x05, ea: 0x3005, cycles: 4 },
      { mnemonic, opcode: base | 0x18, asm: `${mnemonic} &3000,Y`, mode: 'absoluteY', bytes: [base | 0x18, 0x00, 0x30], y: 0x05, ea: 0x3005, cycles: 4 },
      { mnemonic, opcode: base | 0x00, asm: `${mnemonic} (&70,X)`, mode: 'indexedIndirectX', bytes: [base, 0x70], x: 0x04, memory: POINTER, ea: 0x3000, cycles: 6 },
      { mnemonic, opcode: base | 0x10, asm: `${mnemonic} (&74),Y`, mode: 'indirectIndexedY', bytes: [base | 0x10, 0x74], y: 0x05, memory: POINTER, ea: 0x3005, cycles: 5 },
    ];
  }

  const CASES: readonly Case[] = [
    ...modes('ORA', 0x01),
    ...modes('AND', 0x21),
    ...modes('EOR', 0x41),
    { mnemonic: 'BIT', opcode: 0x24, asm: 'BIT &70', mode: 'zeroPage', bytes: [0x24, 0x70], ea: 0x0070, cycles: 3 },
    { mnemonic: 'BIT', opcode: 0x2c, asm: 'BIT &3000', mode: 'absolute', bytes: [0x2c, 0x00, 0x30], ea: 0x3000, cycles: 4 },
  ];

  /** A=&F0 and the operand &3C (%1111 0000 and %0011 1100), with every other register and flag set to something recognisable. */
  function run(c: Case): { cpu: Cpu6502; bus: TestBus; cycles: number } {
    const { cpu, bus } = cpuWith(c.bytes);
    const r = cpu.regs;
    r.x = c.x ?? 0;
    r.y = c.y ?? 0;
    for (const [address, value] of c.memory ?? []) bus.write(address, value);
    bus.write(c.ea, 0x3c);
    r.a = 0xf0;
    r.v = false;
    r.c = true;
    r.d = true;
    return { cpu, bus, cycles: cpu.step() };
  }

  // &F0 AND &3C = &30, &F0 ORA &3C = &FC, &F0 EOR &3C = &CC. BIT: &30 ≠ 0 so Z=0; &3C has bits 7 and 6 clear.
  const EXPECTED: Readonly<Record<Case['mnemonic'], { a: number; n: boolean; v: boolean; z: boolean }>> = {
    AND: { a: 0x30, n: false, v: false, z: false },
    ORA: { a: 0xfc, n: true, v: false, z: false },
    EOR: { a: 0xcc, n: true, v: false, z: false },
    BIT: { a: 0xf0, n: false, v: false, z: false },
  };

  it('covers every row in the table', () => {
    expect(CASES.map((c) => c.opcode).sort()).toEqual(LOGIC.map((d) => d.opcode).sort());
  });

  describe.each(CASES.map((c) => [`${c.asm} (&${hex8(c.opcode)})`, c] as const))('%s', (_name, c) => {
    it(`reads its operand from &${hex16(c.ea)} and sets A, N, V and Z from it`, () => {
      const { cpu } = run(c);
      const r = cpu.regs;
      expect({ a: r.a, n: r.n, v: r.v, z: r.z }).toEqual(EXPECTED[c.mnemonic]);
    });

    it('leaves C, D, I, X, Y, S and memory alone', () => {
      const { cpu, bus } = run(c);
      const r = cpu.regs;
      expect({ c: r.c, d: r.d, i: r.i, x: r.x, y: r.y, s: r.s, operand: bus.read(c.ea) }).toEqual({
        c: true,
        d: true,
        i: true, // reset set it
        x: c.x ?? 0,
        y: c.y ?? 0,
        s: 0xfd, // reset took 3 from &00
        operand: 0x3c,
      });
    });

    it(`advances PC by ${String(c.bytes.length)} and takes ${String(c.cycles)} cycles`, () => {
      const { cpu, cycles } = run(c);
      expect(cycles).toBe(c.cycles);
      expect(cpu.regs.pc).toBe(PROGRAM + c.bytes.length);
    });
  });
});

describe('page crossings cost +1, as for LDA', () => {
  // Each reads &3108: &30F8 + &10 carries into the high byte. For (&80),Y the pointer at &80/&81 holds &30F8.
  const CROSSING: readonly { mnemonic: Mnemonic; asm: string; bytes: readonly number[]; x?: number; y?: number; cycles: number }[] = [
    { mnemonic: 'AND', asm: 'AND &30F8,X', bytes: [0x3d, 0xf8, 0x30], x: 0x10, cycles: 5 },
    { mnemonic: 'AND', asm: 'AND &30F8,Y', bytes: [0x39, 0xf8, 0x30], y: 0x10, cycles: 5 },
    { mnemonic: 'AND', asm: 'AND (&80),Y', bytes: [0x31, 0x80], y: 0x10, cycles: 6 },
    { mnemonic: 'ORA', asm: 'ORA &30F8,X', bytes: [0x1d, 0xf8, 0x30], x: 0x10, cycles: 5 },
    { mnemonic: 'ORA', asm: 'ORA &30F8,Y', bytes: [0x19, 0xf8, 0x30], y: 0x10, cycles: 5 },
    { mnemonic: 'ORA', asm: 'ORA (&80),Y', bytes: [0x11, 0x80], y: 0x10, cycles: 6 },
    { mnemonic: 'EOR', asm: 'EOR &30F8,X', bytes: [0x5d, 0xf8, 0x30], x: 0x10, cycles: 5 },
    { mnemonic: 'EOR', asm: 'EOR &30F8,Y', bytes: [0x59, 0xf8, 0x30], y: 0x10, cycles: 5 },
    { mnemonic: 'EOR', asm: 'EOR (&80),Y', bytes: [0x51, 0x80], y: 0x10, cycles: 6 },
  ];

  it.each(CROSSING)('$asm reads &3108 and takes $cycles cycles', ({ mnemonic, bytes, x, y, cycles }) => {
    const { cpu, bus } = cpuWith(bytes);
    bus.load(0x0080, [0xf8, 0x30]);
    bus.write(0x3108, 0x0f);
    cpu.regs.x = x ?? 0;
    cpu.regs.y = y ?? 0;
    cpu.regs.a = 0x3c;
    expect(cpu.step()).toBe(cycles);
    // &3C AND &0F = &0C, ORA = &3F, EOR = &33
    const want = { AND: 0x0c, ORA: 0x3f, EOR: 0x33 } as const;
    expect(cpu.regs.a).toBe(want[mnemonic]);
  });
});
