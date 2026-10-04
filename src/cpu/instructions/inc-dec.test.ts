import { TestBus } from '../../memory/test-bus';
import { WriteRecorder } from '../../memory/write-recorder';
import { MODES, type AddressingMode } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { hex8 } from '../../util/bits';
import { INC_DEC } from './inc-dec';

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

describe('INX, INY, DEX, DEY', () => {
  type IndexRegister = 'x' | 'y';
  const CASES: readonly { opcode: number; asm: string; register: IndexRegister; delta: 1 | -1 }[] = [
    { opcode: 0xe8, asm: 'INX', register: 'x', delta: 1 },
    { opcode: 0xc8, asm: 'INY', register: 'y', delta: 1 },
    { opcode: 0xca, asm: 'DEX', register: 'x', delta: -1 },
    { opcode: 0x88, asm: 'DEY', register: 'y', delta: -1 },
  ];

  // [before, after, N, Z] for +1; the -1 rows are the same pairs reversed.
  const STEPS: readonly (readonly [number, number, boolean, boolean])[] = [
    [0x00, 0x01, false, false],
    [0x7e, 0x7f, false, false],
    [0x7f, 0x80, true, false], // +127 → -128: N on, V untouched
    [0xfe, 0xff, true, false],
    [0xff, 0x00, false, true], // wraps: Z on, no carry
  ];

  describe.each(CASES)('$asm (&$opcode)', ({ opcode, asm, register, delta }) => {
    const other: IndexRegister = register === 'x' ? 'y' : 'x';

    it.each(STEPS)(`${asm} steps the register, wrapping between &FF and &00 (from &%s)`, (up, down) => {
      const [before, after] = delta === 1 ? [up, down] : [down, up];
      const { cpu } = cpuWith([opcode]);
      cpu.regs[register] = before;
      cpu.step();
      expect(cpu.regs[register]).toBe(after);
    });

    it.each(STEPS)(`${asm} sets N from bit 7 and Z from a zero result (from &%s)`, (up, down) => {
      const [before, after] = delta === 1 ? [up, down] : [down, up];
      const { cpu } = cpuWith([opcode]);
      cpu.regs[register] = before;
      cpu.regs.n = !((after & 0x80) !== 0);
      cpu.regs.z = after !== 0;
      cpu.step();
      expect(cpu.regs.n).toBe((after & 0x80) !== 0);
      expect(cpu.regs.z).toBe(after === 0);
    });

    it(`${asm} leaves C, V, D and I alone, set or clear, even when it wraps`, () => {
      const wrapFrom = delta === 1 ? 0xff : 0x00;
      for (const flag of [true, false]) {
        const { cpu } = cpuWith([opcode]);
        cpu.regs[register] = wrapFrom;
        cpu.regs.c = flag;
        cpu.regs.v = flag;
        cpu.regs.d = flag;
        cpu.regs.i = flag;
        cpu.step();
        expect({ c: cpu.regs.c, v: cpu.regs.v, d: cpu.regs.d, i: cpu.regs.i }).toEqual({ c: flag, v: flag, d: flag, i: flag });
      }
    });

    it(`${asm} touches no other register and no memory, takes 2 cycles and is 1 byte long`, () => {
      const { cpu, writes } = cpuWith([opcode]);
      cpu.regs.a = 0x11;
      cpu.regs[other] = 0x22;
      const s = cpu.regs.s;
      expect(cpu.step()).toBe(2);
      expect(cpu.regs.pc).toBe(PROGRAM + 1);
      expect({ a: cpu.regs.a, other: cpu.regs[other], s: cpu.regs.s }).toEqual({ a: 0x11, other: 0x22, s });
      expect(writes.count).toBe(0);
    });
  });
});

describe('INC and DEC on memory (read-modify-write)', () => {
  interface Case {
    readonly opcode: number;
    readonly asm: string;
    readonly delta: 1 | -1;
    readonly mode: AddressingMode;
    readonly bytes: readonly number[];
    readonly x?: number;
    /** Where the byte that changes lives. */
    readonly ea: number;
    readonly cycles: number;
  }

  // One case per opcode, none crossing a page.
  const CASES: readonly Case[] = [
    { opcode: 0xe6, asm: 'INC &80', delta: 1, mode: 'zeroPage', bytes: [0xe6, 0x80], ea: 0x0080, cycles: 5 },
    { opcode: 0xf6, asm: 'INC &80,X', delta: 1, mode: 'zeroPageX', bytes: [0xf6, 0x80], x: 0x05, ea: 0x0085, cycles: 6 },
    { opcode: 0xee, asm: 'INC &3000', delta: 1, mode: 'absolute', bytes: [0xee, 0x00, 0x30], ea: 0x3000, cycles: 6 },
    { opcode: 0xfe, asm: 'INC &3000,X', delta: 1, mode: 'absoluteX', bytes: [0xfe, 0x00, 0x30], x: 0x05, ea: 0x3005, cycles: 7 },
    { opcode: 0xc6, asm: 'DEC &80', delta: -1, mode: 'zeroPage', bytes: [0xc6, 0x80], ea: 0x0080, cycles: 5 },
    { opcode: 0xd6, asm: 'DEC &80,X', delta: -1, mode: 'zeroPageX', bytes: [0xd6, 0x80], x: 0x05, ea: 0x0085, cycles: 6 },
    { opcode: 0xce, asm: 'DEC &3000', delta: -1, mode: 'absolute', bytes: [0xce, 0x00, 0x30], ea: 0x3000, cycles: 6 },
    { opcode: 0xde, asm: 'DEC &3000,X', delta: -1, mode: 'absoluteX', bytes: [0xde, 0x00, 0x30], x: 0x05, ea: 0x3005, cycles: 7 },
  ];

  /** Sets up the case with value at its EA. */
  function run(c: Case, value: number): ReturnType<typeof cpuWith> & { cycles: number } {
    const setup = cpuWith(c.bytes);
    setup.cpu.regs.x = c.x ?? 0;
    setup.bus.write(c.ea, value);
    setup.writes.clear();
    return { ...setup, cycles: setup.cpu.step() };
  }

  describe.each(CASES)('$asm', (c) => {
    it(`${c.asm} changes the byte at &${c.ea.toString(16).toUpperCase()} by ${String(c.delta)}`, () => {
      const { bus } = run(c, 0x41);
      expect(bus.read(c.ea)).toBe(c.delta === 1 ? 0x42 : 0x40);
    });

    it(`${c.asm} wraps: ${c.delta === 1 ? '&FF → &00 sets Z' : '&00 → &FF sets N'}, and C is untouched`, () => {
      for (const carry of [true, false]) {
        const setup = cpuWith(c.bytes);
        setup.cpu.regs.x = c.x ?? 0;
        setup.cpu.regs.c = carry;
        setup.bus.write(c.ea, c.delta === 1 ? 0xff : 0x00);
        setup.cpu.step();
        const after = c.delta === 1 ? 0x00 : 0xff;
        expect(setup.bus.read(c.ea)).toBe(after);
        expect({ n: setup.cpu.regs.n, z: setup.cpu.regs.z, c: setup.cpu.regs.c }).toEqual({
          n: after === 0xff,
          z: after === 0x00,
          c: carry,
        });
      }
    });

    it(`${c.asm} writes twice, like the NMOS 6502: the old value back, then the new one`, () => {
      const { writes } = run(c, 0x7f);
      const after = c.delta === 1 ? 0x80 : 0x7e;
      expect(writes.recorded()).toEqual([
        { address: c.ea, value: 0x7f },
        { address: c.ea, value: after },
      ]);
    });

    it(`${c.asm} leaves A, X, Y, S, V, D and I alone`, () => {
      const setup = cpuWith(c.bytes);
      const r = setup.cpu.regs;
      r.a = 0x11;
      r.x = c.x ?? 0;
      r.y = 0x33;
      r.v = true;
      r.d = true;
      const s = r.s;
      setup.cpu.step();
      expect({ a: r.a, x: r.x, y: r.y, s: r.s, v: r.v, d: r.d, i: r.i }).toEqual({
        a: 0x11,
        x: c.x ?? 0,
        y: 0x33,
        s,
        v: true,
        d: true,
        i: true, // reset set it
      });
    });

    it(`${c.asm} takes ${String(c.cycles)} cycles and advances PC by ${String(c.bytes.length)}`, () => {
      const { cpu, cycles } = run(c, 0x00);
      expect(cycles).toBe(c.cycles);
      expect(cpu.regs.pc).toBe(PROGRAM + c.bytes.length);
    });
  });

  it('INC &nnnn,X still takes 7 cycles when the index crosses a page (&30FF + 1 = &3100)', () => {
    const { cpu, bus } = cpuWith([0xfe, 0xff, 0x30]);
    cpu.regs.x = 0x01;
    bus.write(0x3100, 0x09);
    expect(cpu.step()).toBe(7);
    expect(bus.read(0x3100)).toBe(0x0a);
    expect(bus.read(0x30ff)).toBe(0x00);
  });

  it('DEC &nn,X wraps the address inside page zero (&FF + 2 = &01, not &0101)', () => {
    const { cpu, bus } = cpuWith([0xd6, 0xff]);
    cpu.regs.x = 0x02;
    bus.write(0x0001, 0x05);
    bus.write(0x0101, 0x05);
    cpu.step();
    expect(bus.read(0x0001)).toBe(0x04);
    expect(bus.read(0x0101)).toBe(0x05);
  });

  it('INC sets N from bit 7 of the new value, but not V: &7F → &80 is +127 → -128', () => {
    const { cpu, bus } = cpuWith([0xe6, 0x80]);
    bus.write(0x0080, 0x7f);
    cpu.step();
    expect(bus.read(0x0080)).toBe(0x80);
    expect(cpu.regs.n).toBe(true);
    expect(cpu.regs.z).toBe(false);
    expect(cpu.regs.v).toBe(false);
  });
});

describe('the INC_DEC table', () => {
  it('has the 12 documented opcodes, each in the main OPCODES table', () => {
    expect(INC_DEC).toHaveLength(12);
    for (const row of INC_DEC) {
      expect(OPCODES[row.opcode]?.mnemonic).toBe(row.mnemonic);
    }
  });

  it.each(INC_DEC.map((row) => [hex8(row.opcode), row] as const))('&%s has the byte count of its addressing mode', (_, row) => {
    expect(row.bytes).toBe(1 + MODES[row.mode].operandBytes);
  });
});
