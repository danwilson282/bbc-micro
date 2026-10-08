import { TestBus } from '../memory/test-bus';
import { Cpu6502 } from './cpu6502';
import { TRACE_HEADER, Tracer, formatFlags, formatTraceLine } from './trace';

/** A CPU at &0400 with the given program, S = &FD after reset, and a tracer over the same memory. */
function setup(program: readonly number[], capacity?: number): { cpu: Cpu6502; bus: TestBus; tracer: Tracer } {
  const bus = new TestBus();
  bus.load(0xfffc, [0x00, 0x04]);
  bus.load(0x0400, program);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  const tracer = new Tracer((a) => bus.read(a), capacity);
  return { cpu, bus, tracer };
}

/** Record, then step: the order an owner of the CPU uses. */
function tracedSteps(cpu: Cpu6502, tracer: Tracer, count: number): void {
  for (let i = 0; i < count; i++) {
    tracer.record(cpu);
    cpu.step();
  }
}

describe('Tracer.record: one entry per step, with the state BEFORE it runs', () => {
  it('records PC, the bytes at PC, A X Y S, P and the cycle count', () => {
    const { cpu, tracer } = setup([0xa2, 0xff, 0x9a]); // LDX #&FF, TXS
    tracedSteps(cpu, tracer, 2);
    expect(tracer.recent(2)).toEqual([
      { kind: 'instruction', cycles: 7, pc: 0x0400, bytes: [0xa2, 0xff], a: 0, x: 0x00, y: 0, s: 0xfd, p: 0x24 },
      { kind: 'instruction', cycles: 9, pc: 0x0402, bytes: [0x9a], a: 0, x: 0xff, y: 0, s: 0xfd, p: 0xa4 },
    ]);
  });

  it("keeps only the instruction's own bytes (1 to 3, from the opcode's length)", () => {
    const { cpu, tracer } = setup([0xe8, 0xa9, 0x41, 0x8d, 0x00, 0x7c]); // INX, LDA #&41, STA &7C00
    tracedSteps(cpu, tracer, 3);
    expect(tracer.recent(3).map((e) => e.bytes)).toEqual([[0xe8], [0xa9, 0x41], [0x8d, 0x00, 0x7c]]);
  });

  it('copies the bytes when the instruction runs, so self-modifying code shows each version', () => {
    // &0400 STA &7C28 / &0403 INC &0401 / &0406 JMP &0400
    const { cpu, tracer } = setup([0x8d, 0x28, 0x7c, 0xee, 0x01, 0x04, 0x4c, 0x00, 0x04]);
    tracedSteps(cpu, tracer, 7);
    const stores = tracer.recent(7).filter((e) => e.pc === 0x0400);
    expect(stores.map((e) => formatTraceLine(e).slice(16, 40).trim())).toEqual(['8D 28 7C  STA &7C28', '8D 29 7C  STA &7C29', '8D 2A 7C  STA &7C2A']);
  });

  it('records an IRQ step as an interrupt, not the instruction at PC (I clear, IRQ held)', () => {
    const { cpu, tracer } = setup([0x58, 0xea]); // CLI, NOP
    tracedSteps(cpu, tracer, 1);
    cpu.irq = true;
    tracedSteps(cpu, tracer, 1);
    expect(tracer.recent(1)[0]).toMatchObject({ kind: 'irq', pc: 0x0401, bytes: [] });
  });

  it('records an NMI step as an NMI, even with I set', () => {
    const { cpu, tracer } = setup([0xea]);
    cpu.setNmi(true);
    tracedSteps(cpu, tracer, 1);
    expect(tracer.recent(1)[0]).toMatchObject({ kind: 'nmi', pc: 0x0400 });
  });

  it("doesn't touch the bus through read(): it reads memory only through the peek it was given", () => {
    const bus = new TestBus();
    const cpu = new Cpu6502(bus);
    const peeked: number[] = [];
    const tracer = new Tracer((a) => {
      peeked.push(a);
      return 0xea;
    });
    const read = jest.spyOn(bus, 'read');
    tracer.record(cpu);
    expect(read).not.toHaveBeenCalled();
    expect(peeked).toEqual([0x0000, 0x0001, 0x0002]);
  });
});

describe('the ring buffer', () => {
  it('rejects a capacity that is not a power of two', () => {
    expect(() => new Tracer(() => 0, 1000)).toThrow(RangeError);
  });

  it('holds the most recent `capacity` entries, oldest first, once it has wrapped', () => {
    const { cpu, tracer } = setup(new Array<number>(10).fill(0xe8), 4); // INX × 10
    tracedSteps(cpu, tracer, 10);
    expect(tracer.recorded).toBe(10);
    expect(tracer.length).toBe(4);
    expect(tracer.recent(100).map((e) => e.pc)).toEqual([0x0406, 0x0407, 0x0408, 0x0409]);
  });

  it('recent(n) gives the last n, oldest first', () => {
    const { cpu, tracer } = setup(new Array<number>(5).fill(0xe8));
    tracedSteps(cpu, tracer, 5);
    expect(tracer.recent(2).map((e) => e.pc)).toEqual([0x0403, 0x0404]);
  });

  it('clear() empties it', () => {
    const { cpu, tracer } = setup([0xe8, 0xe8]);
    tracedSteps(cpu, tracer, 2);
    tracer.clear();
    expect(tracer.recorded).toBe(0);
    expect(tracer.recent(10)).toEqual([]);
  });
});

describe('formatting a trace line', () => {
  it('lines up under TRACE_HEADER: cycle, PC, bytes, instruction, A X Y S, flags', () => {
    const { cpu, tracer } = setup([0xa2, 0xff]);
    tracedSteps(cpu, tracer, 1);
    const entry = tracer.recent(1).at(-1);
    if (entry === undefined) throw new Error('no entry');
    expect(TRACE_HEADER).toBe('  cycle  PC     bytes     instruction       A  X  Y  S  NV--DIZC');
    expect(formatTraceLine(entry)).toBe('      7  &0400  A2 FF     LDX #&FF          00 00 00 FD nv--dIzc');
  });

  it('uses labels for operands when given them', () => {
    const { cpu, tracer } = setup([0x20, 0x10, 0x04]);
    tracedSteps(cpu, tracer, 1);
    const entry = tracer.recent(1).at(-1);
    if (entry === undefined) throw new Error('no entry');
    expect(formatTraceLine(entry, new Map([[0x0410, 'one']]))).toContain('JSR one ');
  });

  it('shows an interrupt step with its vector and no bytes', () => {
    const { cpu, tracer } = setup([0xea]);
    cpu.setNmi(true);
    tracedSteps(cpu, tracer, 1);
    const entry = tracer.recent(1).at(-1);
    if (entry === undefined) throw new Error('no entry');
    expect(formatTraceLine(entry)).toBe('      7  &0400            NMI (via &FFFA)   00 00 00 FD nv--dIzc');
  });

  it('flags: capital = set, and bits 5 and 4 (not stored in the chip) are always "-"', () => {
    expect(formatFlags(0xff)).toBe('NV--DIZC');
    expect(formatFlags(0x00)).toBe('nv--dizc');
    expect(formatFlags(0x81)).toBe('Nv--dizC');
  });
});
