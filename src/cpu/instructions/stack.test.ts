import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { STACK } from './stack';

const PROGRAM = 0x0400;
const PHA = 0x48;
const PLA = 0x68;
const PHP = 0x08;
const PLP = 0x28;

/** A CPU on a flat 64K bus, reset to PROGRAM with the given bytes there, and S = &FF (an empty stack). */
function cpuWith(bytes: readonly number[]): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [PROGRAM & 0xff, PROGRAM >> 8]);
  bus.load(PROGRAM, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.regs.s = 0xff;
  return { cpu, bus };
}

const SIX = ['n', 'v', 'd', 'i', 'z', 'c'] as const;

describe('the stack instructions', () => {
  it('has PHA, PLA, PHP and PLP: implied, 1 byte, pushes 3 cycles, pulls 4', () => {
    expect(STACK.map((op) => [op.mnemonic, op.opcode, op.cycles])).toEqual([
      ['PHP', PHP, 3],
      ['PLP', PLP, 4],
      ['PHA', PHA, 3],
      ['PLA', PLA, 4],
    ]);
    for (const op of STACK) {
      expect(op).toMatchObject({ mode: 'implied', bytes: 1 });
      expect(OPCODES[op.opcode]?.mnemonic).toBe(op.mnemonic);
    }
  });
});

describe('PHA (&48)', () => {
  it('writes A to &0100 + S, decrements S, and advances PC by 1 in 3 cycles', () => {
    const { cpu, bus } = cpuWith([PHA]);
    cpu.regs.a = 0x11;
    expect(cpu.step()).toBe(3);
    expect(bus.read(0x01ff)).toBe(0x11);
    expect(cpu.regs.s).toBe(0xfe);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
  });

  it('changes no flags and leaves A alone', () => {
    const { cpu } = cpuWith([PHA]);
    Object.assign(cpu.regs, { a: 0x80, n: false, v: true, d: true, i: false, z: true, c: true });
    cpu.step();
    expect(cpu.regs).toMatchObject({ a: 0x80, n: false, v: true, d: true, i: false, z: true, c: true });
  });

  it('with S = &00 writes &0100 and wraps S to &FF', () => {
    const { cpu, bus } = cpuWith([PHA]);
    cpu.regs.s = 0x00;
    cpu.regs.a = 0xaa;
    cpu.step();
    expect(bus.read(0x0100)).toBe(0xaa);
    expect(cpu.regs.s).toBe(0xff);
  });
});

describe('PLA (&68)', () => {
  it('increments S, then loads A from &0100 + S, advancing PC by 1 in 4 cycles', () => {
    const { cpu, bus } = cpuWith([PLA]);
    bus.write(0x01ff, 0x42);
    cpu.regs.s = 0xfe;
    expect(cpu.step()).toBe(4);
    expect(cpu.regs.a).toBe(0x42);
    expect(cpu.regs.s).toBe(0xff);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
  });

  it.each([
    { value: 0x00, n: false, z: true },
    { value: 0x7f, n: false, z: false },
    { value: 0x80, n: true, z: false },
  ])('sets N and Z from the pulled byte &$value, like a load', ({ value, n, z }) => {
    const { cpu, bus } = cpuWith([PLA]);
    bus.write(0x01ff, value);
    cpu.regs.s = 0xfe;
    cpu.regs.n = !n;
    cpu.regs.z = !z;
    cpu.step();
    expect(cpu.regs).toMatchObject({ n, z });
  });

  it('leaves C, V, D and I alone', () => {
    const { cpu } = cpuWith([PLA]);
    Object.assign(cpu.regs, { v: true, d: true, i: true, c: true });
    cpu.step();
    expect(cpu.regs).toMatchObject({ v: true, d: true, i: true, c: true });
  });

  it('with S = &FF wraps S to &00 and reads &0100', () => {
    const { cpu, bus } = cpuWith([PLA]);
    bus.write(0x0100, 0x99);
    cpu.step();
    expect(cpu.regs.a).toBe(0x99);
    expect(cpu.regs.s).toBe(0x00);
  });

  it('three PHAs then three PLAs give the bytes back in reverse order', () => {
    const { cpu } = cpuWith([PHA, PHA, PHA, PLA, PLA, PLA]);
    const pulled: number[] = [];
    for (const a of [0x11, 0x22, 0x33]) {
      cpu.regs.a = a;
      cpu.step();
    }
    expect(cpu.regs.s).toBe(0xfc);
    for (let i = 0; i < 3; i++) {
      cpu.step();
      pulled.push(cpu.regs.a);
    }
    expect(pulled).toEqual([0x33, 0x22, 0x11]);
    expect(cpu.regs.s).toBe(0xff);
  });
});

describe('PHP (&08)', () => {
  it('pushes P with bit 5 and B (bit 4) both 1, advancing PC by 1 in 3 cycles', () => {
    const { cpu, bus } = cpuWith([PHP]);
    Object.assign(cpu.regs, { n: false, v: false, d: true, i: true, z: false, c: true });
    expect(cpu.step()).toBe(3);
    expect(bus.read(0x01ff)).toBe(0x3d); // %0011 1101: - and B are 1
    expect(cpu.regs.s).toBe(0xfe);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
  });

  it('pushes &30 with every flag clear, and &FF with every flag set', () => {
    const clear = cpuWith([PHP]);
    for (const f of SIX) clear.cpu.regs[f] = false;
    clear.cpu.step();
    expect(clear.bus.read(0x01ff)).toBe(0x30);

    const set = cpuWith([PHP]);
    for (const f of SIX) set.cpu.regs[f] = true;
    set.cpu.step();
    expect(set.bus.read(0x01ff)).toBe(0xff);
  });

  it.each([
    { flag: 'n', bit: 0x80 },
    { flag: 'v', bit: 0x40 },
    { flag: 'd', bit: 0x08 },
    { flag: 'i', bit: 0x04 },
    { flag: 'z', bit: 0x02 },
    { flag: 'c', bit: 0x01 },
  ] as const)('puts $flag in bit &$bit of the pushed byte', ({ flag, bit }) => {
    const { cpu, bus } = cpuWith([PHP]);
    for (const f of SIX) cpu.regs[f] = false;
    cpu.regs[flag] = true;
    cpu.step();
    expect(bus.read(0x01ff)).toBe(0x30 | bit);
  });

  it('changes no flags', () => {
    const { cpu } = cpuWith([PHP]);
    Object.assign(cpu.regs, { n: true, v: false, d: true, i: false, z: true, c: false });
    cpu.step();
    expect(cpu.regs).toMatchObject({ n: true, v: false, d: true, i: false, z: true, c: false });
  });
});

describe('PLP (&28)', () => {
  it('increments S, then loads all six flags from &0100 + S, advancing PC by 1 in 4 cycles', () => {
    const { cpu, bus } = cpuWith([PLP]);
    bus.write(0x01ff, 0xc3); // %1100 0011: N V . . . . Z C
    cpu.regs.s = 0xfe;
    expect(cpu.step()).toBe(4);
    expect(cpu.regs).toMatchObject({ n: true, v: true, d: false, i: false, z: true, c: true });
    expect(cpu.regs.s).toBe(0xff);
    expect(cpu.regs.pc).toBe(PROGRAM + 1);
  });

  it('ignores bits 5 and 4 (B): pulling &30 clears all six flags', () => {
    const { cpu, bus } = cpuWith([PLP]);
    bus.write(0x01ff, 0x30);
    cpu.regs.s = 0xfe;
    for (const f of SIX) cpu.regs[f] = true;
    cpu.step();
    for (const f of SIX) expect(cpu.regs[f]).toBe(false);
  });

  it('can set V, which has no SEV, and clear I, like CLI', () => {
    const { cpu, bus } = cpuWith([PLP]);
    bus.write(0x01ff, 0xc0);
    cpu.regs.s = 0xfe;
    cpu.regs.i = true;
    cpu.step();
    expect(cpu.regs).toMatchObject({ n: true, v: true, i: false });
  });

  it('PHP then PLP restores every flag exactly', () => {
    const { cpu } = cpuWith([PHP, PLP]);
    Object.assign(cpu.regs, { n: true, v: false, d: true, i: true, z: false, c: true });
    cpu.step();
    for (const f of SIX) cpu.regs[f] = !cpu.regs[f];
    cpu.step();
    expect(cpu.regs).toMatchObject({ n: true, v: false, d: true, i: true, z: false, c: true });
    expect(cpu.regs.s).toBe(0xff);
  });

  it('PHP then PLA reads the flags into A as a byte', () => {
    const { cpu } = cpuWith([PHP, PLA]);
    Object.assign(cpu.regs, { n: false, v: false, d: true, i: true, z: false, c: true });
    cpu.step();
    cpu.step();
    expect(cpu.regs.a).toBe(0x3d);
  });

  it('leaves A, X and Y alone', () => {
    const { cpu } = cpuWith([PLP]);
    Object.assign(cpu.regs, { a: 0x12, x: 0x34, y: 0x56 });
    cpu.step();
    expect(cpu.regs).toMatchObject({ a: 0x12, x: 0x34, y: 0x56 });
  });
});
