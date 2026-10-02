import { TestBus } from '../../memory/test-bus';
import { playgroundTarget, type CpuTarget } from './debug-target';
import { buildRegistersView, describeRun, formatCycles, stepMany } from './registers-view-model';

const NOP = 0xea;

/** A playground whose reset vector points at &0400, reset already done. */
function playground(program: readonly number[] = []): { target: CpuTarget; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [0x00, 0x04]);
  bus.load(0x0400, program);
  const target = playgroundTarget(bus);
  target.reset();
  return { target, bus };
}

describe('playgroundTarget', () => {
  it('exposes the live registers and cycle count of its CPU', () => {
    const { target } = playground([NOP]);
    expect(target.registers.pc).toBe(0x0400);
    expect(target.cycles).toBe(7);
    target.step();
    expect(target.registers.pc).toBe(0x0401);
    expect(target.cycles).toBe(9);
  });
});

describe('playgroundTarget writes', () => {
  it('records the CPU\'s writes, but not the debugger\'s pokes', () => {
    const { target, bus } = playground([0x8d, 0x28, 0x7c]); // STA &7C28
    target.poke(0x7c00, 0x99);
    expect(target.writes.count).toBe(0);
    target.step();
    expect(target.writes.recorded()).toEqual([{ address: 0x7c28, value: 0x00 }]);
    expect(bus.read(0x7c00)).toBe(0x99);
  });
});

describe('buildRegistersView', () => {
  it('shows each register in & hex, with PC as four digits', () => {
    const { target } = playground();
    const view = buildRegistersView(target);
    expect(view.registers.map((r) => [r.name, r.hex])).toEqual([
      ['A', '&00'],
      ['X', '&00'],
      ['Y', '&00'],
      ['S', '&FD'],
      ['PC', '&0400'],
      ['P', '&24'],
    ]);
  });

  it('explains S as an address in page 1 and P in binary', () => {
    const { target } = playground();
    const view = buildRegistersView(target);
    expect(view.registers.find((r) => r.name === 'S')?.detail).toBe('next push → &01FD');
    expect(view.registers.find((r) => r.name === 'P')?.detail).toBe('%00100100');
  });

  it('shows A, X and Y in decimal and as signed bytes too', () => {
    const { target } = playground();
    Object.assign(target.registers, { a: 0xff });
    expect(buildRegistersView(target).registers[0]?.detail).toBe('255 / −1');
  });

  it('lights the flags N V - B D I Z C from bit 7 down, marking B and bit 5 as not stored', () => {
    const { target } = playground();
    const flags = buildRegistersView(target).flags;
    expect(flags.map((f) => f.name)).toEqual(['N', 'V', '-', 'B', 'D', 'I', 'Z', 'C']);
    expect(flags.map((f) => f.on)).toEqual([false, false, true, false, false, true, false, false]);
    expect(flags.filter((f) => !f.stored).map((f) => f.name)).toEqual(['-', 'B']);
  });

  it('shows the opcode at PC, and its mnemonic if it is implemented', () => {
    const { target } = playground([NOP, 0xa9, 0x41, 0xe8]); // NOP, LDA #&41, INX (Stage 09)
    expect(buildRegistersView(target).next).toEqual({ address: 0x0400, opcode: NOP, text: '&0400: &EA NOP' });
    target.step();
    expect(buildRegistersView(target).next.text).toBe('&0401: &A9 LDA');
    target.step();
    expect(buildRegistersView(target).next.text).toBe('&0403: &E8 (not implemented yet)');
  });

  it('marks only the registers and flags that changed since the previous view', () => {
    const { target } = playground([NOP]);
    const before = buildRegistersView(target);
    target.step();
    Object.assign(target.registers, { c: true });
    const after = buildRegistersView(target, before);
    expect(after.registers.filter((r) => r.changed).map((r) => r.name)).toEqual(['PC', 'P']);
    expect(after.flags.filter((f) => f.changed).map((f) => f.name)).toEqual(['C']);
  });

  it('marks nothing on the first view', () => {
    const { target } = playground();
    const view = buildRegistersView(target);
    expect(view.registers.some((r) => r.changed)).toBe(false);
    expect(view.flags.some((f) => f.changed)).toBe(false);
  });
});

describe('formatCycles', () => {
  it('shows cycles with their emulated time at 2 MHz', () => {
    expect(formatCycles(9)).toBe('9 cycles = 4.5 µs at 2 MHz');
    expect(formatCycles(1)).toBe('1 cycle = 0.5 µs at 2 MHz');
    expect(formatCycles(40_000)).toBe('40,000 cycles = 20,000 µs at 2 MHz');
  });
});

describe('stepMany', () => {
  it('steps n instructions and reports how many ran', () => {
    const { target } = playground(new Array<number>(16).fill(NOP));
    expect(stepMany(target, 16)).toEqual({ steps: 16, cycles: 32, writes: 0, error: undefined });
    expect(target.registers.pc).toBe(0x0410);
  });

  it('clears the write log once, then counts every write of the run', () => {
    // STA &70 : STX &71 : STY &72, then NOPs
    const { target } = playground([0x85, 0x70, 0x86, 0x71, 0x84, 0x72, NOP, NOP, NOP]);
    stepMany(target, 1);
    expect(target.writes.recorded().map((w) => w.address)).toEqual([0x70]);
    const result = stepMany(target, 4);
    expect(result).toMatchObject({ steps: 4, writes: 2 });
    expect(target.writes.recorded().map((w) => w.address)).toEqual([0x71, 0x72]);
    expect(stepMany(target, 1)).toMatchObject({ steps: 1, writes: 0 });
    expect(target.writes.count).toBe(0);
  });

  it('stops at an unimplemented opcode and returns the error message instead of throwing', () => {
    const { target } = playground([NOP, NOP, 0x00]);
    expect(stepMany(target, 16)).toEqual({ steps: 2, cycles: 4, writes: 0, error: 'unimplemented opcode &00 at &0402' });
    expect(target.registers.pc).toBe(0x0402);
  });
});

describe('describeRun', () => {
  it('reports steps and cycles, and leaves writes out when there were none', () => {
    expect(describeRun({ steps: 1, cycles: 5, writes: 0, error: undefined })).toBe('Ran 1 (5 cycles)');
  });

  it('adds the number of writes', () => {
    expect(describeRun({ steps: 1, cycles: 4, writes: 1, error: undefined })).toBe('Ran 1 (4 cycles), 1 write');
    expect(describeRun({ steps: 16, cycles: 50, writes: 3, error: undefined })).toBe('Ran 16 (50 cycles), 3 writes');
  });

  it('puts the error after what ran, or shows it alone if nothing ran', () => {
    expect(describeRun({ steps: 2, cycles: 8, writes: 1, error: 'unimplemented opcode &00 at &0500' })).toBe(
      'Ran 2, 1 write, then stopped: unimplemented opcode &00 at &0500',
    );
    expect(describeRun({ steps: 0, cycles: 0, writes: 0, error: 'unimplemented opcode &00 at &0500' })).toBe(
      'unimplemented opcode &00 at &0500',
    );
  });
});
