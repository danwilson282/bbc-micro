import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { JUMPS } from './jumps';

const JMP_ABSOLUTE = 0x4c;
const JMP_INDIRECT = 0x6c;

/** A CPU on a flat 64K bus, reset to start, with the given bytes there. */
function cpuAt(start: number, bytes: readonly number[]): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [start & 0xff, start >> 8]);
  bus.load(start, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return { cpu, bus };
}

const SIX = ['n', 'v', 'd', 'i', 'z', 'c'] as const;

describe('the JMP opcodes', () => {
  it('has JMP absolute (&4C, 3 cycles) and JMP indirect (&6C, 5 cycles), both 3 bytes', () => {
    expect(JUMPS.map((op) => [op.mnemonic, op.opcode, op.mode, op.bytes, op.cycles])).toEqual([
      ['JMP', JMP_ABSOLUTE, 'absolute', 3, 3],
      ['JMP', JMP_INDIRECT, 'indirect', 3, 5],
    ]);
    for (const op of JUMPS) expect(OPCODES[op.opcode]).toBe(op);
  });
});

describe('JMP &nnnn (&4C)', () => {
  it('sets PC to the operand, low byte first, in 3 cycles', () => {
    const { cpu } = cpuAt(0x0400, [JMP_ABSOLUTE, 0x34, 0x12]);
    expect(cpu.step()).toBe(3);
    expect(cpu.regs.pc).toBe(0x1234);
  });

  it('can jump to itself: an endless loop that changes nothing', () => {
    const { cpu } = cpuAt(0x0400, [JMP_ABSOLUTE, 0x00, 0x04]);
    cpu.step();
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0400);
    expect(cpu.cycles).toBe(7 + 3 + 3);
  });

  it('never reads or writes the target address, and changes no register but PC', () => {
    const { cpu, bus } = cpuAt(0x0400, [JMP_ABSOLUTE, 0x00, 0x30]);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33, s: 0x44, n: true, v: false, d: true, i: false, z: true, c: false });
    const reads: number[] = [];
    const read = bus.read.bind(bus);
    bus.read = (address: number): number => {
      reads.push(address);
      return read(address);
    };
    cpu.step();
    expect(reads).toEqual([0x0400, 0x0401, 0x0402]);
    expect(cpu.regs).toMatchObject({ a: 0x11, x: 0x22, y: 0x33, s: 0x44, n: true, v: false, d: true, i: false, z: true, c: false });
  });
});

describe('JMP (&nnnn) (&6C)', () => {
  it('sets PC to the word stored at the pointer, low byte first, in 5 cycles', () => {
    const { cpu, bus } = cpuAt(0x0400, [JMP_INDIRECT, 0x0e, 0x02]); // JMP (&020E): WRCHV
    bus.load(0x020e, [0x00, 0x30]);
    expect(cpu.step()).toBe(5);
    expect(cpu.regs.pc).toBe(0x3000);
  });

  it('has the NMOS page-boundary bug: JMP (&10FF) reads its high byte from &1000, not &1100', () => {
    const { cpu, bus } = cpuAt(0x0400, [JMP_INDIRECT, 0xff, 0x10]);
    bus.write(0x10ff, 0x80);
    bus.write(0x1000, 0x04);
    bus.write(0x1100, 0x05);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0480); // a 65C02 would go to &0580
  });

  it('wraps a pointer at &FFFF to &FF00 for its high byte, not &0000', () => {
    const { cpu, bus } = cpuAt(0x0400, [JMP_INDIRECT, 0xff, 0xff]);
    bus.write(0xffff, 0x34);
    bus.write(0xff00, 0x12);
    bus.write(0x0000, 0x99);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x1234);
  });

  it('changes no flags', () => {
    const { cpu } = cpuAt(0x0400, [JMP_INDIRECT, 0x00, 0x30]);
    for (const f of SIX) cpu.regs[f] = true;
    cpu.step();
    for (const f of SIX) expect(cpu.regs[f]).toBe(true);
  });
});
