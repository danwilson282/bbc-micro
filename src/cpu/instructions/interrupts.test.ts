import { TestBus } from '../../memory/test-bus';
import { Cpu6502, IRQ_VECTOR } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { INTERRUPTS } from './interrupts';

const BRK = 0x00;
const RTI = 0x40;

/** A CPU on a flat 64K bus, reset to start with S = &FF, the IRQ/BRK vector at &041E, and the given bytes. */
function cpuAt(start: number, bytes: readonly number[]): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [start & 0xff, start >> 8, 0x1e, 0x04]);
  bus.load(start, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.regs.s = 0xff;
  cpu.regs.i = false;
  return { cpu, bus };
}

const SIX = ['n', 'v', 'd', 'i', 'z', 'c'] as const;

describe('the interrupt opcodes', () => {
  it('has BRK (&00, 7 cycles) and RTI (&40, 6 cycles), both implied, 1 byte', () => {
    expect(INTERRUPTS.map((op) => [op.mnemonic, op.opcode, op.mode, op.bytes, op.cycles])).toEqual([
      ['BRK', BRK, 'implied', 1, 7],
      ['RTI', RTI, 'implied', 1, 6],
    ]);
    for (const op of INTERRUPTS) expect(OPCODES[op.opcode]).toBe(op);
  });

  it('completes the documented instruction set: all 151 opcodes', () => {
    expect(OPCODES.filter((op) => op !== undefined)).toHaveLength(151);
  });
});

describe('BRK (&00)', () => {
  it('vectors through &FFFE in 7 cycles', () => {
    const { cpu } = cpuAt(0x0403, [BRK, 0xea]);
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x041e);
    expect(IRQ_VECTOR).toBe(0xfffe);
  });

  it('pushes its own address + 2, skipping the padding byte: &0405 for a BRK at &0403', () => {
    const { cpu, bus } = cpuAt(0x0403, [BRK, 0xea]);
    cpu.step();
    expect(bus.read(0x01ff)).toBe(0x04);
    expect(bus.read(0x01fe)).toBe(0x05);
  });

  it('pushes P with B = 1 and bit 5 = 1: no flags set pushes %0011 0000 = &30', () => {
    const { cpu, bus } = cpuAt(0x0403, [BRK]);
    cpu.step();
    expect(bus.read(0x01fd)).toBe(0x30);
    expect(cpu.regs.s).toBe(0xfc);
  });

  it('sets I, and changes no other flag (D included: NMOS)', () => {
    for (const flag of SIX) {
      const { cpu } = cpuAt(0x0403, [BRK]);
      for (const f of SIX) cpu.regs[f] = f === flag;
      cpu.step();
      for (const f of SIX) expect(cpu.regs[f]).toBe(f === flag || f === 'i');
    }
  });

  it('runs even with I set: it is an instruction, not a request', () => {
    const { cpu, bus } = cpuAt(0x0403, [BRK]);
    cpu.regs.i = true;
    cpu.step();
    expect(cpu.regs.pc).toBe(0x041e);
    expect(bus.read(0x01fd)).toBe(0x34);
  });

  it('wraps PC + 2 past &FFFF: a BRK at &FFFF pushes &0001', () => {
    const { cpu, bus } = cpuAt(0x0400, []);
    bus.write(0xffff, BRK);
    cpu.regs.pc = 0xffff;
    cpu.step(); // vector high byte is &FFFF's own &00 now, so PC = &001E; we only check the push
    expect([bus.read(0x01ff), bus.read(0x01fe)]).toEqual([0x00, 0x01]);
  });
});

describe('RTI (&40)', () => {
  it('pulls P, then PC low, then PC high, in 6 cycles, with no + 1', () => {
    const { cpu, bus } = cpuAt(0x0450, [RTI]);
    cpu.regs.s = 0xfc;
    bus.load(0x01fd, [0x20, 0x07, 0x04]); // P, PCL, PCH
    expect(cpu.step()).toBe(6);
    expect(cpu.regs.pc).toBe(0x0407);
    expect(cpu.regs.s).toBe(0xff);
  });

  it('restores all six flags from the pulled P, I included', () => {
    const { cpu, bus } = cpuAt(0x0450, [RTI]);
    cpu.regs.s = 0xfc;
    cpu.regs.i = true;
    bus.load(0x01fd, [0xcf, 0x00, 0x04]); // N V D I Z C all 1
    cpu.step();
    for (const f of SIX) expect(cpu.regs[f]).toBe(true);
    bus.load(0x01fd, [0x30, 0x00, 0x04]); // only bits 5 and 4: nowhere to put them
    cpu.regs.s = 0xfc;
    cpu.regs.pc = 0x0450;
    cpu.step();
    for (const f of SIX) expect(cpu.regs[f]).toBe(false);
  });

  it('wraps S like any pull: from S = &FE it reads &01FF, &0100, &0101', () => {
    const { cpu, bus } = cpuAt(0x0450, [RTI]);
    cpu.regs.s = 0xfe;
    bus.write(0x01ff, 0x00);
    bus.load(0x0100, [0x34, 0x12]);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x1234);
    expect(cpu.regs.s).toBe(0x01);
  });
});

describe('BRK then RTI', () => {
  it('comes back to the byte after the padding byte, with the flags as they were', () => {
    //   &0403  BRK         &041E  RTI
    //   &0404  .byte &EA   (padding, skipped)
    //   &0405  ...
    const { cpu, bus } = cpuAt(0x0403, [BRK, 0xea]);
    bus.write(0x041e, RTI);
    cpu.regs.c = true;
    cpu.step();
    expect(cpu.regs.i).toBe(true);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0405);
    expect(cpu.regs.s).toBe(0xff);
    expect(cpu.regs.i).toBe(false);
    expect(cpu.regs.c).toBe(true);
  });
});
