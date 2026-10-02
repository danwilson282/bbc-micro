import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import type { Registers } from '../registers';
import { hex8 } from '../../util/bits';
import { TRANSFERS } from './transfers';

const PROGRAM = 0x0400;

/** A CPU on a flat 64K bus, reset to PROGRAM, with the given bytes there. */
function cpuWith(bytes: readonly number[]): Cpu6502 {
  const bus = new TestBus();
  bus.load(0xfffc, [PROGRAM & 0xff, PROGRAM >> 8]);
  bus.load(PROGRAM, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return cpu;
}

type Register8 = 'a' | 'x' | 'y' | 's';

interface Case {
  readonly opcode: number;
  readonly mnemonic: string;
  readonly from: Register8;
  readonly to: Register8;
  readonly setsFlags: boolean;
}

const CASES: readonly Case[] = [
  { opcode: 0xaa, mnemonic: 'TAX', from: 'a', to: 'x', setsFlags: true },
  { opcode: 0xa8, mnemonic: 'TAY', from: 'a', to: 'y', setsFlags: true },
  { opcode: 0x8a, mnemonic: 'TXA', from: 'x', to: 'a', setsFlags: true },
  { opcode: 0x98, mnemonic: 'TYA', from: 'y', to: 'a', setsFlags: true },
  { opcode: 0xba, mnemonic: 'TSX', from: 's', to: 'x', setsFlags: true },
  { opcode: 0x9a, mnemonic: 'TXS', from: 'x', to: 's', setsFlags: false },
];

/** Distinct starting values, so a copy from the wrong register shows. */
const START = { a: 0x11, x: 0x22, y: 0x33, s: 0x44 } as const;

/** Runs one transfer with value in its source register and the given flags beforehand. */
function run(c: Case, value: number, flags: Partial<Registers> = {}): { cpu: Cpu6502; before: Registers; cycles: number } {
  const cpu = cpuWith([c.opcode]);
  Object.assign(cpu.regs, START, flags, { [c.from]: value });
  const before = { ...cpu.regs };
  const cycles = cpu.step();
  return { cpu, before, cycles };
}

describe('the transfer opcode table', () => {
  it('has the 6 documented transfers, all implied, 1 byte, 2 cycles', () => {
    expect(TRANSFERS.map((t) => t.mnemonic).sort()).toEqual(['TAX', 'TAY', 'TSX', 'TXA', 'TXS', 'TYA']);
    for (const t of TRANSFERS) expect(t).toMatchObject({ mode: 'implied', bytes: 1, cycles: 2 });
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const c of CASES) expect(OPCODES[c.opcode]?.mnemonic).toBe(c.mnemonic);
  });

  it('puts transfers INTO X or Y in the load rows (&Ax/&Bx) and transfers OUT of X or Y in the store rows (&8x/&9x)', () => {
    for (const c of CASES) {
      const row = c.opcode >> 5;
      expect(row).toBe(c.to === 'x' || c.to === 'y' ? 0b101 : 0b100);
    }
  });
});

describe.each(CASES.map((c) => [`${c.mnemonic} (&${hex8(c.opcode)})`, c] as const))('%s', (_name, c) => {
  const from = c.from.toUpperCase();
  const to = c.to.toUpperCase();

  it(`copies ${from} into ${to}, and ${from} keeps its value (a copy, not a move)`, () => {
    const { cpu } = run(c, 0x41);
    expect(cpu.regs[c.to]).toBe(0x41);
    expect(cpu.regs[c.from]).toBe(0x41);
  });

  it(`changes only ${to}${c.setsFlags ? ', N, Z' : ''} and PC: other registers and C, V, D, I untouched`, () => {
    const { cpu, before } = run(c, 0x80, { c: true, v: true, d: true, i: true, n: false, z: true });
    const flags = c.setsFlags ? { n: true, z: false } : {};
    expect(cpu.regs).toEqual({ ...before, [c.to]: 0x80, ...flags, pc: PROGRAM + 1 });
  });

  if (c.setsFlags) {
    it('sets Z and clears N when the value is &00', () => {
      const { cpu } = run(c, 0x00, { n: true, z: false });
      expect(cpu.regs).toMatchObject({ n: false, z: true });
    });

    it('sets N and clears Z when bit 7 is set (&80)', () => {
      const { cpu } = run(c, 0x80, { n: false, z: true });
      expect(cpu.regs).toMatchObject({ n: true, z: false });
    });

    it('clears both N and Z for a positive non-zero value (&41)', () => {
      const { cpu } = run(c, 0x41, { n: true, z: true });
      expect(cpu.regs).toMatchObject({ n: false, z: false });
    });
  } else {
    it.each([
      [0x00, { n: true, z: false }],
      [0x80, { n: false, z: true }],
      [0x41, { n: true, z: true }],
    ])('leaves N and Z as they were when copying &%s: TXS sets no flags', (value, flags) => {
      const { cpu } = run(c, value, flags);
      expect(cpu.regs).toMatchObject(flags);
    });
  }

  it('advances PC by 1 and takes 2 cycles', () => {
    const { cpu, cycles } = run(c, 0x41);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
    expect(cycles).toBe(2);
    expect(cpu.cycles).toBe(7 + 2);
  });
});

describe('transfers and the stack pointer', () => {
  it('TSX right after reset gives &FD (reset dropped S from &00 by 3) and sets N', () => {
    const cpu = cpuWith([0xba]);
    cpu.step();
    expect(cpu.regs).toMatchObject({ x: 0xfd, s: 0xfd, n: true, z: false });
  });

  it('LDX #&FF : TXS sets S to &FF, and the flags still come from the LDX', () => {
    const cpu = cpuWith([0xa2, 0xff, 0xa9, 0x00, 0x9a]); // LDX #&FF : LDA #&00 : TXS
    cpu.step();
    cpu.step();
    cpu.step();
    expect(cpu.regs).toMatchObject({ s: 0xff, x: 0xff, a: 0x00, n: false, z: true });
  });

  it('TSX : TXS round-trips S unchanged', () => {
    const cpu = cpuWith([0xba, 0x9a]);
    cpu.regs.s = 0xc7;
    cpu.step();
    cpu.regs.s = 0x00;
    cpu.step();
    expect(cpu.regs.s).toBe(0xc7);
  });
});
