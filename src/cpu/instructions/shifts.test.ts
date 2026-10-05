import { TestBus } from '../../memory/test-bus';
import { WriteRecorder } from '../../memory/write-recorder';
import { MODES } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { createRegisters, type Registers } from '../registers';
import { OPCODES } from '../opcodes';
import { hex8 } from '../../util/bits';
import { SHIFTS, asl, lsr, rol, ror } from './shifts';

const PROGRAM = 0x0400;

/** A CPU on a flat 64K bus (with a write recorder in between), reset to PROGRAM, with the given bytes there. */
function cpuWith(bytes: readonly number[]): { cpu: Cpu6502; bus: TestBus; writes: WriteRecorder } {
  const bus = new TestBus();
  bus.load(0xfffc, [PROGRAM & 0xff, PROGRAM >> 8]);
  bus.load(PROGRAM, bytes);
  const writes = new WriteRecorder(bus);
  const cpu = new Cpu6502(writes);
  cpu.reset();
  writes.clear();
  return { cpu, bus, writes };
}

type Mnemonic = 'ASL' | 'LSR' | 'ROL' | 'ROR';
type Alu = (regs: Registers, value: number) => number;

const ALU: Readonly<Record<Mnemonic, Alu>> = { ASL: asl, LSR: lsr, ROL: rol, ROR: ror };

/**
 * The reference: what each instruction means as plain arithmetic, with no
 * bit operators. Left = × 2 (+ carry for ROL), right = ÷ 2 (+ 128 × carry for
 * ROR). What falls off the end is the new carry.
 */
function reference(mnemonic: Mnemonic, value: number, carryIn: boolean): { result: number; carry: boolean } {
  const c = carryIn ? 1 : 0;
  switch (mnemonic) {
    case 'ASL':
      return { result: (value * 2) % 256, carry: value >= 128 };
    case 'ROL':
      return { result: (value * 2 + c) % 256, carry: value >= 128 };
    case 'LSR':
      return { result: Math.floor(value / 2), carry: value % 2 === 1 };
    case 'ROR':
      return { result: Math.floor(value / 2) + 128 * c, carry: value % 2 === 1 };
  }
}

const MNEMONICS: readonly Mnemonic[] = ['ASL', 'LSR', 'ROL', 'ROR'];

describe('the shift ALU functions, for all 256 values and both carries', () => {
  describe.each(MNEMONICS)('%s', (mnemonic) => {
    const alu = ALU[mnemonic];

    it(`${mnemonic} returns the shifted byte and puts the bit that fell out in C`, () => {
      for (let value = 0; value < 256; value++) {
        for (const carryIn of [false, true]) {
          const regs = createRegisters();
          regs.c = carryIn;
          const expected = reference(mnemonic, value, carryIn);
          expect({ value, carryIn, result: alu(regs, value), carry: regs.c }).toEqual({ value, carryIn, ...expected });
        }
      }
    });

    it(`${mnemonic} sets N from bit 7 and Z from a zero result, starting from the wrong answer`, () => {
      for (let value = 0; value < 256; value++) {
        for (const carryIn of [false, true]) {
          const { result } = reference(mnemonic, value, carryIn);
          const regs = createRegisters();
          regs.c = carryIn;
          regs.n = result < 128;
          regs.z = result !== 0;
          alu(regs, value);
          expect({ value, carryIn, n: regs.n, z: regs.z }).toEqual({ value, carryIn, n: result >= 128, z: result === 0 });
        }
      }
    });

    it(`${mnemonic} leaves V, D and I alone, and does not write A itself`, () => {
      for (const flag of [true, false]) {
        const regs = createRegisters();
        regs.a = 0x11;
        regs.v = flag;
        regs.d = flag;
        regs.i = flag;
        alu(regs, 0x40); // ASL &40 is +64 → -128: a signed overflow, and still no V
        expect({ a: regs.a, v: regs.v, d: regs.d, i: regs.i }).toEqual({ a: 0x11, v: flag, d: flag, i: flag });
      }
    });
  });

  it('LSR always clears N: a 0 comes in at bit 7', () => {
    const regs = createRegisters();
    regs.n = true;
    expect(lsr(regs, 0xff)).toBe(0x7f);
    expect(regs.n).toBe(false);
  });

  it('nine ROLs, or nine RORs, bring the byte and C back round the 9-bit ring', () => {
    for (const rotate of [rol, ror]) {
      const regs = createRegisters();
      regs.c = true;
      let value = 0x5a;
      for (let i = 0; i < 9; i++) value = rotate(regs, value);
      expect({ value, c: regs.c }).toEqual({ value: 0x5a, c: true });
    }
  });

  it('ASL then ROL doubles a 16-bit number: &01C0 (448) → &0380 (896)', () => {
    const regs = createRegisters();
    const low = asl(regs, 0xc0);
    expect(regs.c).toBe(true);
    const high = rol(regs, 0x01);
    expect({ low, high, c: regs.c }).toEqual({ low: 0x80, high: 0x03, c: false });
  });

  it('LSR then ROR halves a 16-bit number from the top byte down: &0381 (897) → &01C0 (448), C=1', () => {
    const regs = createRegisters();
    const high = lsr(regs, 0x03);
    const low = ror(regs, 0x81);
    expect({ high, low, c: regs.c }).toEqual({ high: 0x01, low: 0xc0, c: true });
  });
});

describe('the accumulator forms (ASL A, LSR A, ROL A, ROR A)', () => {
  const CASES: readonly { opcode: number; mnemonic: Mnemonic }[] = [
    { opcode: 0x0a, mnemonic: 'ASL' },
    { opcode: 0x4a, mnemonic: 'LSR' },
    { opcode: 0x2a, mnemonic: 'ROL' },
    { opcode: 0x6a, mnemonic: 'ROR' },
  ];

  describe.each(CASES)('$mnemonic A (&$opcode)', ({ opcode, mnemonic }) => {
    it(`${mnemonic} A shifts A in place, with C in and out`, () => {
      for (const carryIn of [false, true]) {
        const { cpu } = cpuWith([opcode]);
        cpu.regs.a = 0x81;
        cpu.regs.c = carryIn;
        cpu.step();
        const expected = reference(mnemonic, 0x81, carryIn);
        expect({ a: cpu.regs.a, c: cpu.regs.c }).toEqual({ a: expected.result, c: expected.carry });
      }
    });

    it(`${mnemonic} A takes 2 cycles, is 1 byte long, and touches no memory or other register`, () => {
      const { cpu, writes } = cpuWith([opcode]);
      cpu.regs.a = 0x42;
      cpu.regs.x = 0x22;
      cpu.regs.y = 0x33;
      const s = cpu.regs.s;
      expect(cpu.step()).toBe(2);
      expect(cpu.regs.pc).toBe(PROGRAM + 1);
      expect({ x: cpu.regs.x, y: cpu.regs.y, s: cpu.regs.s }).toEqual({ x: 0x22, y: 0x33, s });
      expect(writes.count).toBe(0);
    });
  });
});

describe('the memory forms (read-modify-write)', () => {
  interface Case {
    readonly mnemonic: Mnemonic;
    readonly asm: string;
    readonly bytes: readonly number[];
    readonly x?: number;
    /** Where the byte that changes lives. */
    readonly ea: number;
    readonly cycles: number;
  }

  /** The four RMW modes for one mnemonic, given its zero-page opcode (the others are +&08, +&10, +&18). */
  function casesFor(mnemonic: Mnemonic, zeroPage: number): Case[] {
    return [
      { mnemonic, asm: `${mnemonic} &80`, bytes: [zeroPage, 0x80], ea: 0x0080, cycles: 5 },
      { mnemonic, asm: `${mnemonic} &80,X`, bytes: [zeroPage + 0x10, 0x80], x: 0x05, ea: 0x0085, cycles: 6 },
      { mnemonic, asm: `${mnemonic} &3000`, bytes: [zeroPage + 0x08, 0x00, 0x30], ea: 0x3000, cycles: 6 },
      { mnemonic, asm: `${mnemonic} &3000,X`, bytes: [zeroPage + 0x18, 0x00, 0x30], x: 0x05, ea: 0x3005, cycles: 7 },
    ];
  }

  const CASES: readonly Case[] = [...casesFor('ASL', 0x06), ...casesFor('ROL', 0x26), ...casesFor('LSR', 0x46), ...casesFor('ROR', 0x66)];

  function run(c: Case, value: number, carryIn: boolean): ReturnType<typeof cpuWith> & { cycles: number } {
    const setup = cpuWith(c.bytes);
    setup.cpu.regs.x = c.x ?? 0;
    setup.cpu.regs.c = carryIn;
    setup.bus.write(c.ea, value);
    setup.writes.clear();
    return { ...setup, cycles: setup.cpu.step() };
  }

  describe.each(CASES)('$asm', (c) => {
    it(`${c.asm} shifts the byte at &${hex8(c.ea >> 8)}${hex8(c.ea)}, with C in and out`, () => {
      for (const carryIn of [false, true]) {
        const { cpu, bus } = run(c, 0x81, carryIn);
        const expected = reference(c.mnemonic, 0x81, carryIn);
        expect({ m: bus.read(c.ea), c: cpu.regs.c }).toEqual({ m: expected.result, c: expected.carry });
      }
    });

    it(`${c.asm} writes twice, like the NMOS 6502: the old value back, then the new one`, () => {
      const { writes } = run(c, 0x81, true);
      expect(writes.recorded()).toEqual([
        { address: c.ea, value: 0x81 },
        { address: c.ea, value: reference(c.mnemonic, 0x81, true).result },
      ]);
    });

    it(`${c.asm} leaves A, X, Y, S, V and D alone`, () => {
      const setup = cpuWith(c.bytes);
      const r = setup.cpu.regs;
      r.a = 0x11;
      r.x = c.x ?? 0;
      r.y = 0x33;
      r.v = true;
      r.d = true;
      const s = r.s;
      setup.bus.write(c.ea, 0x40);
      setup.cpu.step();
      expect({ a: r.a, x: r.x, y: r.y, s: r.s, v: r.v, d: r.d }).toEqual({ a: 0x11, x: c.x ?? 0, y: 0x33, s, v: true, d: true });
    });

    it(`${c.asm} takes ${String(c.cycles)} cycles and advances PC by ${String(c.bytes.length)}`, () => {
      const { cpu, cycles } = run(c, 0x00, false);
      expect(cycles).toBe(c.cycles);
      expect(cpu.regs.pc).toBe(PROGRAM + c.bytes.length);
    });
  });

  it('ROL &nnnn,X still takes 7 cycles when the index crosses a page (&30FF + 1 = &3100)', () => {
    const { cpu, bus } = cpuWith([0x3e, 0xff, 0x30]);
    cpu.regs.x = 0x01;
    cpu.regs.c = true;
    bus.write(0x3100, 0x40);
    expect(cpu.step()).toBe(7);
    expect(bus.read(0x3100)).toBe(0x81);
    expect(bus.read(0x30ff)).toBe(0x00);
  });

  it('LSR &nn,X wraps the address inside page zero (&FF + 2 = &01, not &0101)', () => {
    const { cpu, bus } = cpuWith([0x56, 0xff]);
    cpu.regs.x = 0x02;
    bus.write(0x0001, 0x08);
    bus.write(0x0101, 0x08);
    cpu.step();
    expect(bus.read(0x0001)).toBe(0x04);
    expect(bus.read(0x0101)).toBe(0x08);
  });
});

describe('the SHIFTS table', () => {
  it('has the 20 documented opcodes, each in the main OPCODES table', () => {
    expect(SHIFTS).toHaveLength(20);
    for (const row of SHIFTS) {
      expect(OPCODES[row.opcode]?.mnemonic).toBe(row.mnemonic);
    }
  });

  it('lays them out as aaa bbb cc with cc = %10: aaa picks the operation, bbb the mode', () => {
    const AAA: Readonly<Record<Mnemonic, number>> = { ASL: 0b000, ROL: 0b001, LSR: 0b010, ROR: 0b011 };
    const BBB = { zeroPage: 0b001, accumulator: 0b010, absolute: 0b011, zeroPageX: 0b101, absoluteX: 0b111 } as const;
    for (const row of SHIFTS) {
      const mnemonic = MNEMONICS.find((m) => m === row.mnemonic);
      if (mnemonic === undefined) throw new Error(`unexpected mnemonic ${row.mnemonic}`);
      expect(row.opcode & 0b11).toBe(0b10);
      expect(row.opcode >> 5).toBe(AAA[mnemonic]);
      expect(Object.entries(BBB).find(([, bbb]) => bbb === ((row.opcode >> 2) & 0b111))?.[0]).toBe(row.mode);
    }
  });

  it('gives the memory forms the same modes and cycles as INC, its neighbour in the cc = %10 group', () => {
    for (const row of SHIFTS.filter((r) => r.mode !== 'accumulator')) {
      const inc = OPCODES[(row.opcode & 0x1f) | 0xe0];
      expect({ mode: inc?.mode, cycles: inc?.cycles }).toEqual({ mode: row.mode, cycles: row.cycles });
    }
  });

  it.each(SHIFTS.map((row) => [hex8(row.opcode), row] as const))('&%s has the byte count of its addressing mode', (_, row) => {
    expect(row.bytes).toBe(1 + MODES[row.mode].operandBytes);
  });
});
