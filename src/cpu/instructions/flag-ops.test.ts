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
  { opcode: 0x18, mnemonic: 'CLC', flag: 'c', from: true, to: false },
  { opcode: 0x38, mnemonic: 'SEC', flag: 'c', from: false, to: true },
  { opcode: 0x58, mnemonic: 'CLI', flag: 'i', from: true, to: false },
  { opcode: 0x78, mnemonic: 'SEI', flag: 'i', from: false, to: true },
  { opcode: 0xb8, mnemonic: 'CLV', flag: 'v', from: true, to: false },
  { opcode: 0xd8, mnemonic: 'CLD', flag: 'd', from: true, to: false },
  { opcode: 0xf8, mnemonic: 'SED', flag: 'd', from: false, to: true },
] as const;

const SIX = ['n', 'v', 'd', 'i', 'z', 'c'] as const;

describe('the flag instructions', () => {
  it('has all seven, each implied, 1 byte, 2 cycles', () => {
    expect(FLAG_OPS.map((op) => op.mnemonic)).toEqual(CASES.map((c) => c.mnemonic));
    for (const op of FLAG_OPS) expect(op).toMatchObject({ mode: 'implied', bytes: 1, cycles: 2 });
  });

  it('lives in the x8 column of the opcode map', () => {
    for (const op of FLAG_OPS) expect(op.opcode & 0x0f).toBe(0x08);
  });

  it('has no SEV: V can only be cleared directly', () => {
    expect(FLAG_OPS.filter((op) => op.mnemonic.endsWith('V')).map((op) => op.mnemonic)).toEqual(['CLV']);
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const c of CASES) expect(OPCODES[c.opcode]?.mnemonic).toBe(c.mnemonic);
  });
});

describe.each(CASES)('$mnemonic (&$opcode)', ({ opcode, flag, from, to }) => {
  const name = flag.toUpperCase();

  it(`changes ${name} from ${String(from)} to ${String(to)}, advancing PC by 1 in 2 cycles`, () => {
    const cpu = cpuWith([opcode]);
    cpu.regs[flag] = from;
    expect(cpu.step()).toBe(2);
    expect(cpu.regs[flag]).toBe(to);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
  });

  it(`leaves ${name} at ${String(to)} if it was already`, () => {
    const cpu = cpuWith([opcode]);
    cpu.regs[flag] = to;
    cpu.step();
    expect(cpu.regs[flag]).toBe(to);
  });

  it.each([false, true])(`leaves A, X, Y, S and the other five flags alone (all %s)`, (others) => {
    const cpu = cpuWith([opcode]);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33, s: 0x44 });
    for (const f of SIX) cpu.regs[f] = others;
    cpu.regs[flag] = from;
    cpu.step();
    const r = cpu.regs;
    expect({ a: r.a, x: r.x, y: r.y, s: r.s }).toEqual({ a: 0x11, x: 0x22, y: 0x33, s: 0x44 });
    for (const f of SIX) if (f !== flag) expect(r[f]).toBe(others);
  });
});
