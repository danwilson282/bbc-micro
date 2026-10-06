import { TestBus } from '../../memory/test-bus';
import { MODES } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { createRegisters } from '../registers';
import { hex8 } from '../../util/bits';
import { COMPARE, compare } from './compare';

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

describe('compare(): a subtraction that keeps only the flags', () => {
  // The three outcomes, worked in the stage doc with CMP #&30.
  it.each([
    { register: 0x20, label: 'less', c: false, z: false, n: true },
    { register: 0x30, label: 'equal', c: true, z: true, n: false },
    { register: 0x40, label: 'greater', c: true, z: false, n: false },
  ])('&$register vs &30 is $label: C=$c Z=$z N=$n', ({ register, c, z, n }) => {
    const flags = createRegisters();
    compare(flags, register, 0x30);
    expect({ c: flags.c, z: flags.z, n: flags.n }).toEqual({ c, z, n });
  });

  it('for all 65,536 pairs: C = (reg ≥ M) unsigned, Z = (reg = M), N = bit 7 of (reg − M) & &FF', () => {
    const flags = createRegisters();
    for (let register = 0; register < 256; register++) {
      for (let m = 0; m < 256; m++) {
        compare(flags, register, m);
        const difference = (register - m + 256) % 256;
        if (flags.c !== register >= m || flags.z !== (register === m) || flags.n !== difference >= 128) {
          throw new Error(`compare &${hex8(register)} with &${hex8(m)}: C=${String(flags.c)} Z=${String(flags.z)} N=${String(flags.n)}`);
        }
      }
    }
  });

  it('N is not "less than": &FF vs &01 gives N=1 (bigger), &01 vs &FF gives N=0 (smaller). C is right both times', () => {
    const flags = createRegisters();
    compare(flags, 0xff, 0x01);
    expect({ n: flags.n, c: flags.c }).toEqual({ n: true, c: true });
    compare(flags, 0x01, 0xff);
    expect({ n: flags.n, c: flags.c }).toEqual({ n: false, c: false });
  });

  it('ignores the carry in (unlike SBC, no SEC is needed) and leaves V and D alone', () => {
    for (const carryIn of [false, true]) {
      const flags = createRegisters();
      Object.assign(flags, { c: carryIn, v: true, d: true });
      compare(flags, 0x30, 0x30);
      expect({ c: flags.c, z: flags.z, v: flags.v, d: flags.d }).toEqual({ c: true, z: true, v: true, d: true });
    }
  });
});

describe('the compare opcode table', () => {
  it('has the 14 documented opcodes: 8 CMP, 3 CPX, 3 CPY', () => {
    const count = (m: string): number => COMPARE.filter((d) => d.mnemonic === m).length;
    expect([count('CMP'), count('CPX'), count('CPY')]).toEqual([8, 3, 3]);
  });

  it('puts CMP at aaa = %110 in the cc = %01 group, with the same modes and base cycles as LDA', () => {
    for (const d of COMPARE.filter((row) => row.mnemonic === 'CMP')) {
      expect(d.opcode & 0x03).toBe(0x01);
      expect(d.opcode >> 5).toBe(0b110);
      const lda = OPCODES[(d.opcode & 0x1f) | 0xa0];
      expect({ mode: d.mode, cycles: d.cycles }).toEqual({ mode: lda?.mode, cycles: lda?.cycles });
    }
  });

  it('gives CPX and CPY only immediate (2 cycles), zero page (3) and absolute (4)', () => {
    const rows = COMPARE.filter((d) => d.mnemonic !== 'CMP').map(({ mnemonic, opcode, mode, cycles }) => ({ mnemonic, opcode, mode, cycles }));
    expect(rows).toEqual([
      { mnemonic: 'CPX', opcode: 0xe0, mode: 'immediate', cycles: 2 },
      { mnemonic: 'CPX', opcode: 0xe4, mode: 'zeroPage', cycles: 3 },
      { mnemonic: 'CPX', opcode: 0xec, mode: 'absolute', cycles: 4 },
      { mnemonic: 'CPY', opcode: 0xc0, mode: 'immediate', cycles: 2 },
      { mnemonic: 'CPY', opcode: 0xc4, mode: 'zeroPage', cycles: 3 },
      { mnemonic: 'CPY', opcode: 0xcc, mode: 'absolute', cycles: 4 },
    ]);
  });

  it('gives each opcode as many bytes as its mode needs: 1 + operand bytes', () => {
    for (const d of COMPARE) expect(d.bytes).toBe(1 + MODES[d.mode].operandBytes);
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const d of COMPARE) expect(OPCODES[d.opcode]?.mnemonic).toBe(d.mnemonic);
  });
});

describe('the compare instructions on the CPU', () => {
  // Every mode, each comparing &30 with a stored &30 (so Z=1 C=1) at a different EA.
  const CASES = [
    { asm: 'CMP #&30', bytes: [0xc9, 0x30], cycles: 2, set: {} },
    { asm: 'CMP &80', bytes: [0xc5, 0x80], cycles: 3, set: {} },
    { asm: 'CMP &7F,X', bytes: [0xd5, 0x7f], cycles: 4, set: { x: 0x01 } },
    { asm: 'CMP &2000', bytes: [0xcd, 0x00, 0x20], cycles: 4, set: {} },
    { asm: 'CMP &1FFF,X', bytes: [0xdd, 0xff, 0x1f], cycles: 5, set: { x: 0x01 } }, // crosses into &2000
    { asm: 'CMP &1FF0,Y', bytes: [0xd9, 0xf0, 0x1f], cycles: 5, set: { y: 0x10 } }, // &1FF0 + &10 = &2000: crosses
    { asm: 'CMP (&7E,X)', bytes: [0xc1, 0x7e], cycles: 6, set: { x: 0x02 } }, // pointer at &80 → &2000
    { asm: 'CMP (&80),Y', bytes: [0xd1, 0x80], cycles: 5, set: { y: 0x00 } },
    { asm: 'CMP &2000,Y', bytes: [0xd9, 0x00, 0x20], cycles: 4, set: { y: 0x00 } }, // no crossing: base 4
    { asm: 'CPX #&30', bytes: [0xe0, 0x30], cycles: 2, set: {} },
    { asm: 'CPX &80', bytes: [0xe4, 0x80], cycles: 3, set: {} },
    { asm: 'CPX &2000', bytes: [0xec, 0x00, 0x20], cycles: 4, set: {} },
    { asm: 'CPY #&30', bytes: [0xc0, 0x30], cycles: 2, set: {} },
    { asm: 'CPY &80', bytes: [0xc4, 0x80], cycles: 3, set: {} },
    { asm: 'CPY &2000', bytes: [0xcc, 0x00, 0x20], cycles: 4, set: {} },
  ] as const;

  describe.each(CASES)('$asm', ({ asm, bytes, cycles, set }) => {
    const register = asm.startsWith('CPX') ? 'x' : asm.startsWith('CPY') ? 'y' : 'a';

    function run(value: number): Cpu6502 {
      const { cpu, bus } = cpuWith(bytes);
      // The zero-page modes compare with the &30 at &80. The pointer modes
      // use &80/&81 as a pointer to &2000 instead, which also holds &30.
      bus.write(0x0080, 0x30);
      bus.write(0x2000, 0x30);
      if (asm.startsWith('CMP (')) {
        bus.write(0x0080, 0x00);
        bus.write(0x0081, 0x20);
      }
      Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33 }, set);
      cpu.regs[register] = value;
      cpu.step();
      return cpu;
    }

    it(`${asm} with ${register.toUpperCase()} = &30 (equal): Z=1 C=1 N=0`, () => {
      const r = run(0x30).regs;
      expect({ z: r.z, c: r.c, n: r.n }).toEqual({ z: true, c: true, n: false });
    });

    it(`${asm} with ${register.toUpperCase()} = &20 (less): Z=0 C=0 N=1, and the register is unchanged`, () => {
      const r = run(0x20).regs;
      expect({ z: r.z, c: r.c, n: r.n, value: r[register] }).toEqual({ z: false, c: false, n: true, value: 0x20 });
    });

    it(`${asm} with ${register.toUpperCase()} = &40 (greater): Z=0 C=1 N=0`, () => {
      const r = run(0x40).regs;
      expect({ z: r.z, c: r.c, n: r.n }).toEqual({ z: false, c: true, n: false });
    });

    it(`${asm} takes ${String(cycles)} cycles, advances PC by ${String(bytes.length)} and writes nothing`, () => {
      const { cpu, bus } = cpuWith(bytes);
      bus.write(0x0080, 0x00);
      bus.write(0x0081, 0x20);
      Object.assign(cpu.regs, set);
      const before = Array.from({ length: 0x10000 }, (_, i) => bus.read(i));
      expect(cpu.step()).toBe(cycles);
      expect(cpu.regs.pc).toBe(PROGRAM + bytes.length);
      expect(Array.from({ length: 0x10000 }, (_, i) => bus.read(i))).toEqual(before);
    });
  });

  it('CMP leaves A, X, Y, S, V, D and I alone', () => {
    const { cpu } = cpuWith([0xc9, 0x01]);
    Object.assign(cpu.regs, { a: 0x80, x: 0x22, y: 0x33, s: 0x44, v: true, d: true, i: true });
    cpu.step();
    const r = cpu.regs;
    expect({ a: r.a, x: r.x, y: r.y, s: r.s, v: r.v, d: r.d, i: r.i }).toEqual({ a: 0x80, x: 0x22, y: 0x33, s: 0x44, v: true, d: true, i: true });
  });

  it('CMP is binary even in decimal mode: &00 vs &21 gives N=1 from binary &DF, not N=0 from BCD &79', () => {
    const { cpu } = cpuWith([0xc9, 0x21]);
    Object.assign(cpu.regs, { a: 0x00, d: true });
    cpu.step();
    expect({ n: cpu.regs.n, z: cpu.regs.z, c: cpu.regs.c }).toEqual({ n: true, z: false, c: false });
  });
});
