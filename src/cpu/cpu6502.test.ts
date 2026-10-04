import { TestBus } from '../memory/test-bus';
import { Cpu6502, UnimplementedOpcodeError } from './cpu6502';
import { OPCODES, buildTable, type OpcodeDefinition } from './opcodes';

const NOP = 0xea;
const RESET_VECTOR = 0xfffc;

/** A CPU on a flat 64K bus whose reset vector points at start. */
function cpuAt(start: number): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(RESET_VECTOR, [start & 0xff, start >> 8]);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return { cpu, bus };
}

describe('power-on state', () => {
  it('starts with A, X, Y, S and PC at zero, no flags set and no cycles run', () => {
    const cpu = new Cpu6502(new TestBus());
    expect(cpu.regs).toEqual({ a: 0, x: 0, y: 0, s: 0, pc: 0, n: false, v: false, d: false, i: false, z: false, c: false });
    expect(cpu.cycles).toBe(0);
  });
});

describe('reset', () => {
  it('loads PC from the vector at &FFFC (low byte) and &FFFD (high byte)', () => {
    const bus = new TestBus();
    bus.load(RESET_VECTOR, [0xcd, 0xd9]); // MOS 1.20's vector
    const cpu = new Cpu6502(bus);
    cpu.reset();
    expect(cpu.regs.pc).toBe(0xd9cd);
  });

  it('sets I so no IRQ can arrive before the OS is ready', () => {
    const { cpu } = cpuAt(0x0400);
    expect(cpu.regs.i).toBe(true);
  });

  it('moves S down by 3 (three stack reads, no writes), so &00 becomes &FD', () => {
    const { cpu } = cpuAt(0x0400);
    expect(cpu.regs.s).toBe(0xfd);
  });

  it('wraps S within 8 bits on a second reset: &FD becomes &FA, and &01 would become &FE', () => {
    const { cpu } = cpuAt(0x0400);
    cpu.reset();
    expect(cpu.regs.s).toBe(0xfa);
    cpu.regs.s = 0x01;
    cpu.reset();
    expect(cpu.regs.s).toBe(0xfe);
  });

  it('writes nothing to the stack page', () => {
    const { bus } = cpuAt(0x0400);
    for (let a = 0x0100; a <= 0x01ff; a++) expect(bus.read(a)).toBe(0);
  });

  it('leaves A, X, Y and D alone (the NMOS 6502 does not clear D)', () => {
    const { cpu } = cpuAt(0x0400);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33, d: true });
    cpu.reset();
    expect(cpu.regs).toMatchObject({ a: 0x11, x: 0x22, y: 0x33, d: true });
  });

  it('takes 7 cycles, returns them and adds them to the total', () => {
    const cpu = new Cpu6502(new TestBus());
    expect(cpu.reset()).toBe(7);
    expect(cpu.cycles).toBe(7);
    cpu.reset();
    expect(cpu.cycles).toBe(14);
  });
});

describe('NOP (&EA)', () => {
  it('advances PC by 1, costs 2 cycles and changes nothing else', () => {
    const { cpu, bus } = cpuAt(0x0400);
    bus.write(0x0400, NOP);
    const before = { ...cpu.regs };
    expect(cpu.step()).toBe(2);
    expect(cpu.regs).toEqual({ ...before, pc: 0x0401 });
    expect(cpu.cycles).toBe(7 + 2);
  });

  it('walks a page of NOPs one byte at a time, 2 cycles each', () => {
    const { cpu, bus } = cpuAt(0x0400);
    bus.load(0x0400, new Array<number>(0x100).fill(NOP));
    for (let i = 0; i < 0x100; i++) cpu.step();
    expect(cpu.regs.pc).toBe(0x0500);
    expect(cpu.cycles).toBe(7 + 0x100 * 2);
  });

  it('wraps PC from &FFFF to &0000 like the 16-bit program counter', () => {
    const { cpu, bus } = cpuAt(0xffff);
    bus.write(0xffff, NOP);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0000);
  });

  it('is described in the opcode table as implied, 1 byte, 2 cycles', () => {
    expect(OPCODES[NOP]).toMatchObject({ mnemonic: 'NOP', mode: 'implied', bytes: 1, cycles: 2 });
  });
});

describe('the opcode table', () => {
  it('has exactly 256 slots, one per possible opcode byte', () => {
    expect(OPCODES).toHaveLength(256);
  });

  it('implements NOP, 18 loads, 13 stores, 6 transfers, 12 increments/decrements and 16 ADC/SBC so far (Stage 10)', () => {
    const implemented = OPCODES.flatMap((op) => (op ? [op.mnemonic] : []));
    expect(implemented).toHaveLength(1 + 18 + 13 + 6 + 12 + 16);
    expect(new Set(implemented)).toEqual(
      new Set(['NOP', 'LDA', 'LDX', 'LDY', 'STA', 'STX', 'STY', 'TAX', 'TAY', 'TXA', 'TYA', 'TSX', 'TXS', 'INX', 'INY', 'DEX', 'DEY', 'INC', 'DEC', 'ADC', 'SBC']),
    );
  });
});

describe('buildTable', () => {
  const row = (opcode: number, mnemonic: string): OpcodeDefinition => ({
    opcode,
    mnemonic,
    mode: 'implied',
    bytes: 1,
    cycles: 2,
    execute: () => 0,
  });

  it('puts each row at its opcode byte and leaves the rest empty', () => {
    const table = buildTable([[row(0x10, 'ONE')], [row(0x20, 'TWO')]]);
    expect(table[0x10]?.mnemonic).toBe('ONE');
    expect(table[0x20]?.mnemonic).toBe('TWO');
    expect(table.filter((op) => op !== undefined)).toHaveLength(2);
  });

  it('refuses two rows for the same opcode, naming both', () => {
    expect(() => buildTable([[row(0xa9, 'LDA')], [row(0xa9, 'OOPS')]])).toThrow('opcode &A9 defined twice: LDA and OOPS');
  });
});

describe('unimplemented opcodes', () => {
  it('throw an error naming the opcode and its address', () => {
    const { cpu, bus } = cpuAt(0x0400);
    bus.write(0x0400, 0x29); // AND #: Stage 12
    expect(() => cpu.step()).toThrow(new UnimplementedOpcodeError(0x29, 0x0400));
    expect(() => cpu.step()).toThrow('unimplemented opcode &29 at &0400');
  });

  it('leave PC on the opcode and the cycle count unchanged', () => {
    const { cpu, bus } = cpuAt(0x0400);
    bus.load(0x0400, [NOP, 0x00]); // NOP, then BRK (Stage 17)
    cpu.step();
    expect(() => cpu.step()).toThrow(UnimplementedOpcodeError);
    expect(cpu.regs.pc).toBe(0x0401);
    expect(cpu.cycles).toBe(7 + 2);
  });

  it('carry the opcode and address as fields for the UI', () => {
    const error = new UnimplementedOpcodeError(0x00, 0x0500);
    expect(error.opcode).toBe(0x00);
    expect(error.address).toBe(0x0500);
    expect(error.name).toBe('UnimplementedOpcodeError');
  });
});

describe('fetchByte', () => {
  it('reads the byte at PC and advances PC, wrapping at &FFFF', () => {
    const { cpu, bus } = cpuAt(0xffff);
    bus.write(0xffff, 0x42);
    bus.write(0x0000, 0x43);
    expect(cpu.fetchByte()).toBe(0x42);
    expect(cpu.regs.pc).toBe(0x0000);
    expect(cpu.fetchByte()).toBe(0x43);
    expect(cpu.regs.pc).toBe(0x0001);
  });
});

describe('separate CPUs', () => {
  it('share no state', () => {
    const one = cpuAt(0x0400);
    const two = cpuAt(0x0800);
    one.bus.write(0x0400, NOP);
    one.cpu.step();
    expect(two.cpu.regs.pc).toBe(0x0800);
    expect(two.cpu.cycles).toBe(7);
  });
});
