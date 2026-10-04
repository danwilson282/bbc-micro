import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { createRegisters, type Registers } from '../registers';
import { bcdToBinary, binaryToBcd, hex8, isValidBcd, toSigned8 } from '../../util/bits';
import { ARITHMETIC, addDecimal, subtractDecimal } from './arithmetic';

const PROGRAM = 0x0400;
const SED = 0xf8;
const CLD = 0xd8;

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

function flagsOf(r: Registers): Flags {
  return { a: r.a, n: r.n, v: r.v, z: r.z, c: r.c };
}

/** Every valid BCD byte, &00-&99: 100 of the 256 values. */
const VALID_BCD: readonly number[] = Array.from({ length: 0x100 }, (_, i) => i).filter(isValidBcd);

// Two independent references.
//
// 1. Decimal on paper: convert to ordinary numbers, add or subtract, convert
//    back. Only meaningful for valid BCD, and only says what A and C should be.
//
// 2. Bruce Clark's NMOS algorithm (6502.org "Decimal Mode", Appendix A),
//    transcribed step by step in its own signed-arithmetic form. It covers all
//    inputs, valid or not, and every flag. The emulator computes the same
//    things differently (unsigned, with the XOR overflow formula), so a slip in
//    either shows up as a mismatch.

/** Step 1a/1b of Clark's sequences 1 and 2: the low digit, fixed up past 9. */
function clarkLowDigit(a: number, m: number, c: number): number {
  let al = (a & 0x0f) + (m & 0x0f) + c;
  if (al >= 0x0a) al = ((al + 0x06) & 0x0f) + 0x10;
  return al;
}

/** Clark sequences 1 (A, C) and 2 (N, V), plus "Z comes from the binary sum" for the NMOS 6502. */
function clarkAdc(a: number, m: number, carry: boolean): Flags {
  const c = carry ? 1 : 0;
  // Sequence 1: A and C.
  let sum = (a & 0xf0) + (m & 0xf0) + clarkLowDigit(a, m, c);
  if (sum >= 0xa0) sum += 0x60;
  // Sequence 2: the same, but with the high nibbles as signed numbers.
  const signed = toSigned8(a & 0xf0) + toSigned8(m & 0xf0) + clarkLowDigit(a, m, c);
  return {
    a: sum & 0xff,
    c: sum >= 0x100,
    n: (signed & 0x80) !== 0,
    v: signed < -128 || signed > 127,
    z: ((a + m + c) & 0xff) === 0,
  };
}

/** Clark sequence 3 (A), with every flag from the plain binary subtraction, as on the NMOS 6502. */
function clarkSbc(a: number, m: number, carry: boolean): Flags {
  const borrow = carry ? 0 : 1;
  let al = (a & 0x0f) - (m & 0x0f) - borrow;
  if (al < 0) al = ((al - 0x06) & 0x0f) - 0x10;
  let diff = (a & 0xf0) - (m & 0xf0) + al;
  if (diff < 0) diff -= 0x60;
  const binary = a - m - borrow;
  const signed = toSigned8(a) - toSigned8(m) - borrow;
  return {
    a: diff & 0xff,
    c: binary >= 0,
    n: (binary & 0x80) !== 0,
    v: signed < -128 || signed > 127,
    z: (binary & 0xff) === 0,
  };
}

/** Runs `OP #m` with D=1 and the given A and C, starting each flag opposite to `want` so an unwritten flag can't pass. */
function sweep(opcode: number, inputs: readonly number[], reference: (a: number, m: number, c: boolean) => Flags, check: (got: Flags, want: Flags) => boolean): number {
  const { cpu, bus } = cpuWith([opcode, 0x00]);
  const r = cpu.regs;
  let mismatches = 0;
  for (const a of inputs) {
    for (const m of inputs) {
      for (const carry of [false, true]) {
        bus.write(PROGRAM + 1, m);
        r.pc = PROGRAM;
        r.a = a;
        r.c = carry;
        r.d = true;
        const want = reference(a, m, carry);
        r.n = !want.n;
        r.v = !want.v;
        r.z = !want.z;
        cpu.step();
        if (!check(flagsOf(r), want)) mismatches++;
      }
    }
  }
  return mismatches;
}

const ALL_BYTES: readonly number[] = Array.from({ length: 0x100 }, (_, i) => i);
const sameAandC = (got: Flags, want: Flags): boolean => got.a === want.a && got.c === want.c;
const sameEverything = (got: Flags, want: Flags): boolean =>
  got.a === want.a && got.n === want.n && got.v === want.v && got.z === want.z && got.c === want.c;

describe('decimal ADC and SBC on valid BCD: exhaustive sweeps through cpu.step()', () => {
  it('ADC # gives the decimal sum in A and the hundreds carry in C, for all 100 × 100 × 2 inputs', () => {
    const decimal = (a: number, m: number, carry: boolean): Flags => {
      const sum = bcdToBinary(a) + bcdToBinary(m) + (carry ? 1 : 0);
      return { a: binaryToBcd(sum % 100), c: sum >= 100, n: false, v: false, z: false };
    };
    expect(sweep(0x69, VALID_BCD, decimal, sameAandC)).toBe(0);
  });

  it('SBC # gives the decimal difference in A, and C=0 when it borrowed, for all 100 × 100 × 2 inputs', () => {
    const decimal = (a: number, m: number, carry: boolean): Flags => {
      const diff = bcdToBinary(a) - bcdToBinary(m) - (carry ? 0 : 1);
      return { a: binaryToBcd((diff + 100) % 100), c: diff >= 0, n: false, v: false, z: false };
    };
    expect(sweep(0xe9, VALID_BCD, decimal, sameAandC)).toBe(0);
  });
});

describe("decimal ADC and SBC on every input, valid or not, against Clark's NMOS algorithm", () => {
  it('ADC #: A, N, V, Z and C for all 256 × 256 × 2 inputs', () => {
    expect(sweep(0x69, ALL_BYTES, clarkAdc, sameEverything)).toBe(0);
  });

  it('SBC #: A, N, V, Z and C for all 256 × 256 × 2 inputs', () => {
    expect(sweep(0xe9, ALL_BYTES, clarkSbc, sameEverything)).toBe(0);
  });
});

describe('worked examples, including the NMOS flag quirks', () => {
  // [A, M, C in, A out, N, V, Z, C out, why]
  const ADC_CASES: readonly (readonly [number, number, boolean, number, boolean, boolean, boolean, boolean, string])[] = [
    [0x09, 0x01, false, 0x10, false, false, false, false, 'the low digit passes 9, so +6 carries into the tens'],
    [0x58, 0x46, false, 0x04, true, true, false, true, '58 + 46 = 104: both digits fix up, the hundred goes to C'],
    [0x99, 0x01, false, 0x00, true, false, false, true, 'A is zero but Z=0 (binary &9A), and N=1 (half-fixed &A0)'],
    [0x80, 0x80, false, 0x60, false, true, true, true, 'A is &60 but Z=1, because the binary sum &100 is zero'],
    [0x79, 0x00, true, 0x80, true, true, false, false, 'V=1: the half-fixed &80 changed sign from &79'],
    [0x00, 0x00, false, 0x00, false, false, true, false, 'Z is right when the binary sum is zero too'],
    [0x0f, 0x00, false, 0x15, false, false, false, false, 'invalid BCD: &F is past 9, so it fixes up to &15'],
    [0x1a, 0x00, false, 0x20, false, false, false, false, 'invalid BCD: "1 ten and 10 ones" comes out as 20'],
    [0xff, 0xff, true, 0x55, true, false, false, true, 'invalid BCD: the largest inputs'],
  ];

  it.each(ADC_CASES.map(([a, m, c, ...rest]) => [hex8(a), hex8(m), c ? 1 : 0, a, m, c, ...rest] as const))(
    'ADC: &%s + &%s + %s in decimal mode',
    (_a, _m, _c, a, m, c, result, n, v, z, cOut) => {
      const regs = createRegisters();
      Object.assign(regs, { a, c, d: true });
      addDecimal(regs, m);
      expect(flagsOf(regs)).toEqual({ a: result, n, v, z, c: cOut });
    },
  );

  // [A, M, C in, A out, C out, the binary answer it would have given]
  const SBC_CASES: readonly (readonly [number, number, boolean, number, boolean, number])[] = [
    [0x46, 0x12, true, 0x34, true, 0x34],
    [0x10, 0x01, true, 0x09, true, 0x0f],
    [0x00, 0x01, true, 0x99, false, 0xff],
    [0x10, 0x00, false, 0x09, true, 0x0f],
    [0x20, 0x0f, true, 0x1b, true, 0x11],
  ];

  it.each(SBC_CASES.map(([a, m, c, ...rest]) => [hex8(a), hex8(m), c ? 1 : 0, a, m, c, ...rest] as const))(
    'SBC: &%s − &%s with C=%s in decimal mode',
    (_a, _m, _c, a, m, c, result, cOut, binary) => {
      const regs = createRegisters();
      Object.assign(regs, { a, c, d: true });
      subtractDecimal(regs, m);
      expect({ a: regs.a, c: regs.c }).toEqual({ a: result, c: cOut });
      // N and Z are the binary answer's, not the decimal one's.
      expect({ n: regs.n, z: regs.z }).toEqual({ n: (binary & 0x80) !== 0, z: binary === 0 });
    },
  );

  it('SBC: &00 − &01 sets N from the binary &FF; &99 happens to agree', () => {
    const regs = createRegisters();
    Object.assign(regs, { a: 0x00, c: true, d: true });
    subtractDecimal(regs, 0x01);
    expect(flagsOf(regs)).toEqual({ a: 0x99, n: true, v: false, z: false, c: false });
  });
});

describe('the D flag selects the mode, instruction by instruction', () => {
  it('ADC # adds in binary with D=0 and in decimal with D=1', () => {
    for (const [d, result] of [
      [false, 0x0a],
      [true, 0x10],
    ] as const) {
      const { cpu } = cpuWith([0x69, 0x01]);
      Object.assign(cpu.regs, { a: 0x09, d });
      cpu.step();
      expect(cpu.regs.a).toBe(result);
    }
  });

  it('SED, then &09 + &01 = &10; CLD, then &09 + &01 = &0A', () => {
    // SED, LDA #&09, ADC #&01, CLD, LDA #&09, ADC #&01
    const { cpu } = cpuWith([SED, 0xa9, 0x09, 0x69, 0x01, CLD, 0xa9, 0x09, 0x69, 0x01]);
    const a: number[] = [];
    for (let i = 0; i < 6; i++) {
      cpu.step();
      a.push(cpu.regs.a);
    }
    expect(a.map(hex8)).toEqual(['00', '09', '10', '10', '09', '0A']);
  });

  it('a 16-bit BCD score: 0995 + 0010 = 1005, the carry handing off from the low byte to the high', () => {
    // SED, LDA #&95, ADC #&10, STA &80, LDA #&09, ADC #&00, STA &81
    const { cpu, bus } = cpuWith([SED, 0xa9, 0x95, 0x69, 0x10, 0x85, 0x80, 0xa9, 0x09, 0x69, 0x00, 0x85, 0x81]);
    for (let i = 0; i < 7; i++) cpu.step();
    expect([bus.read(0x80), bus.read(0x81)].map(hex8)).toEqual(['05', '10']);
    expect(cpu.regs.c).toBe(false);
  });

  it('D changes only ADC and SBC: INX still counts &09 → &0A', () => {
    // SED, LDX #&09, INX
    const { cpu } = cpuWith([SED, 0xa2, 0x09, 0xe8]);
    for (let i = 0; i < 3; i++) cpu.step();
    expect(cpu.regs.x).toBe(0x0a);
  });

  it('leaves X, Y, S, PC, D and I alone', () => {
    for (const alu of [addDecimal, subtractDecimal]) {
      const regs = createRegisters();
      Object.assign(regs, { x: 0x11, y: 0x22, s: 0x33, pc: 0x4444, d: true, i: true });
      alu(regs, 0x45);
      expect({ x: regs.x, y: regs.y, s: regs.s, pc: regs.pc, d: regs.d, i: regs.i }).toEqual({
        x: 0x11,
        y: 0x22,
        s: 0x33,
        pc: 0x4444,
        d: true,
        i: true,
      });
    }
  });
});

describe('decimal mode in every addressing mode, at NMOS speed', () => {
  // Every opcode reads &3005 (or the immediate byte). ADC: &09 + &01 = &10. SBC: &10 − &01 = &09.
  // Same index and pointer set-up as the binary tests.
  function operandAddress(mode: string): number {
    switch (mode) {
      case 'immediate':
        return PROGRAM + 1;
      case 'zeroPage':
        return 0x0070;
      case 'zeroPageX':
        return 0x0075;
      case 'absolute':
      case 'indexedIndirectX':
        return 0x3000;
      default:
        return 0x3005;
    }
  }

  function operandBytes(mode: string): readonly number[] {
    switch (mode) {
      case 'immediate':
        return [0x01];
      case 'zeroPage':
      case 'zeroPageX':
      case 'indexedIndirectX':
        return [0x70];
      case 'indirectIndexedY':
        return [0x74];
      default:
        return [0x00, 0x30];
    }
  }

  it.each(ARITHMETIC.map((d) => [d.mnemonic, d.mode, hex8(d.opcode), d] as const))(
    '%s %s (&%s) works in decimal and takes its binary-mode cycles',
    (mnemonic, mode, _hex, d) => {
      const { cpu, bus } = cpuWith([d.opcode, ...operandBytes(mode)]);
      bus.load(0x0074, [0x00, 0x30]); // the (&70,X) and (&74),Y pointer: &3000
      bus.write(operandAddress(mode), 0x01);
      const isAdc = mnemonic === 'ADC';
      Object.assign(cpu.regs, { a: isAdc ? 0x09 : 0x10, c: !isAdc, d: true, x: mode === 'indexedIndirectX' ? 0x04 : 0x05, y: 0x05 });
      expect(cpu.step()).toBe(d.cycles);
      expect(cpu.regs.a).toBe(isAdc ? 0x10 : 0x09);
    },
  );

  it('a page crossing still costs +1 in decimal mode: ADC &30F8,X with X=&10 takes 5 cycles', () => {
    const { cpu, bus } = cpuWith([0x7d, 0xf8, 0x30]);
    bus.write(0x3108, 0x01);
    Object.assign(cpu.regs, { a: 0x09, x: 0x10, d: true });
    expect(cpu.step()).toBe(5);
    expect(cpu.regs.a).toBe(0x10);
  });
});
