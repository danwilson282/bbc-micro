import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { FLAG_OPS } from './flag-ops';

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

const CASES = [
  { opcode: 0xf8, mnemonic: 'SED', from: false, to: true },
  { opcode: 0xd8, mnemonic: 'CLD', from: true, to: false },
] as const;

describe('the flag instructions brought forward from Stage 14', () => {
  it('has SED and CLD only, both implied, 1 byte, 2 cycles', () => {
    expect(FLAG_OPS.map((op) => op.mnemonic).sort()).toEqual(['CLD', 'SED']);
    for (const op of FLAG_OPS) expect(op).toMatchObject({ mode: 'implied', bytes: 1, cycles: 2 });
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const c of CASES) expect(OPCODES[c.opcode]?.mnemonic).toBe(c.mnemonic);
  });
});

describe.each(CASES)('$mnemonic (&$opcode)', ({ opcode, from, to }) => {
  it(`changes D from ${String(from)} to ${String(to)}, advancing PC by 1 in 2 cycles`, () => {
    const cpu = cpuWith([opcode]);
    cpu.regs.d = from;
    expect(cpu.step()).toBe(2);
    expect(cpu.regs.d).toBe(to);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
  });

  it(`leaves D at ${String(to)} if it was already`, () => {
    const cpu = cpuWith([opcode]);
    cpu.regs.d = to;
    cpu.step();
    expect(cpu.regs.d).toBe(to);
  });

  it.each([false, true])('leaves A, X, Y, S and the other five flags alone (all %s)', (flag) => {
    const cpu = cpuWith([opcode]);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33, s: 0x44, n: flag, v: flag, i: flag, z: flag, c: flag, d: from });
    cpu.step();
    const r = cpu.regs;
    expect({ a: r.a, x: r.x, y: r.y, s: r.s, n: r.n, v: r.v, i: r.i, z: r.z, c: r.c }).toEqual({
      a: 0x11,
      x: 0x22,
      y: 0x33,
      s: 0x44,
      n: flag,
      v: flag,
      i: flag,
      z: flag,
      c: flag,
    });
  });
});
