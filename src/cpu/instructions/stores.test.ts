import { TestBus } from '../../memory/test-bus';
import { WriteRecorder } from '../../memory/write-recorder';
import { MODES, type AddressingMode } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import type { Registers } from '../registers';
import { hex8 } from '../../util/bits';
import { LOADS } from './loads';
import { STORES } from './stores';

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

type StoreRegister = 'a' | 'x' | 'y';

interface Case {
  readonly opcode: number;
  readonly asm: string;
  readonly register: StoreRegister;
  readonly mode: AddressingMode;
  /** Program bytes at &0400, opcode first. */
  readonly bytes: readonly number[];
  /** Index registers to set before stepping. */
  readonly index?: Partial<Pick<Registers, 'x' | 'y'>>;
  /** Extra memory (pointers) to set up: [address, byte] pairs. */
  readonly memory?: readonly (readonly [number, number])[];
  /** Where the register must be written. */
  readonly ea: number;
  readonly cycles: number;
}

// One case per opcode, none crossing a page.
const CASES: readonly Case[] = [
  // STA: 7 modes (no immediate)
  { opcode: 0x85, asm: 'STA &70', register: 'a', mode: 'zeroPage', bytes: [0x85, 0x70], ea: 0x0070, cycles: 3 },
  { opcode: 0x95, asm: 'STA &70,X', register: 'a', mode: 'zeroPageX', bytes: [0x95, 0x70], index: { x: 0x05 }, ea: 0x0075, cycles: 4 },
  { opcode: 0x8d, asm: 'STA &3000', register: 'a', mode: 'absolute', bytes: [0x8d, 0x00, 0x30], ea: 0x3000, cycles: 4 },
  { opcode: 0x9d, asm: 'STA &3000,X', register: 'a', mode: 'absoluteX', bytes: [0x9d, 0x00, 0x30], index: { x: 0x05 }, ea: 0x3005, cycles: 5 },
  { opcode: 0x99, asm: 'STA &3000,Y', register: 'a', mode: 'absoluteY', bytes: [0x99, 0x00, 0x30], index: { y: 0x05 }, ea: 0x3005, cycles: 5 },
  {
    opcode: 0x81,
    asm: 'STA (&70,X)',
    register: 'a',
    mode: 'indexedIndirectX',
    bytes: [0x81, 0x70],
    index: { x: 0x04 },
    memory: [
      [0x0074, 0x00],
      [0x0075, 0x30],
    ],
    ea: 0x3000,
    cycles: 6,
  },
  {
    opcode: 0x91,
    asm: 'STA (&70),Y',
    register: 'a',
    mode: 'indirectIndexedY',
    bytes: [0x91, 0x70],
    index: { y: 0x05 },
    memory: [
      [0x0070, 0x00],
      [0x0071, 0x30],
    ],
    ea: 0x3005,
    cycles: 6,
  },
  // STX: 3 modes, indexed by Y only in zero page
  { opcode: 0x86, asm: 'STX &70', register: 'x', mode: 'zeroPage', bytes: [0x86, 0x70], ea: 0x0070, cycles: 3 },
  { opcode: 0x96, asm: 'STX &70,Y', register: 'x', mode: 'zeroPageY', bytes: [0x96, 0x70], index: { y: 0x05 }, ea: 0x0075, cycles: 4 },
  { opcode: 0x8e, asm: 'STX &3000', register: 'x', mode: 'absolute', bytes: [0x8e, 0x00, 0x30], ea: 0x3000, cycles: 4 },
  // STY: 3 modes, indexed by X only in zero page
  { opcode: 0x84, asm: 'STY &70', register: 'y', mode: 'zeroPage', bytes: [0x84, 0x70], ea: 0x0070, cycles: 3 },
  { opcode: 0x94, asm: 'STY &70,X', register: 'y', mode: 'zeroPageX', bytes: [0x94, 0x70], index: { x: 0x05 }, ea: 0x0075, cycles: 4 },
  { opcode: 0x8c, asm: 'STY &3000', register: 'y', mode: 'absolute', bytes: [0x8c, 0x00, 0x30], ea: 0x3000, cycles: 4 },
];

/** A value for the stored register that isn't also the index register's value, so a mix-up shows. */
const VALUE = 0x5a;

/** Sets up a case with VALUE in its register, steps once, and returns the CPU, the bus and what it took. */
function run(c: Case): { cpu: Cpu6502; bus: TestBus; cycles: number } {
  const { cpu, bus } = cpuWith(c.bytes);
  for (const [address, byte] of c.memory ?? []) bus.write(address, byte);
  cpu.regs[c.register] = VALUE;
  Object.assign(cpu.regs, c.index);
  const cycles = cpu.step();
  return { cpu, bus, cycles };
}

describe('the store opcode table', () => {
  it('has the 13 documented stores: 7 STA, 3 STX, 3 STY', () => {
    expect(STORES).toHaveLength(13);
    expect(STORES.filter((s) => s.mnemonic === 'STA')).toHaveLength(7);
    expect(STORES.filter((s) => s.mnemonic === 'STX')).toHaveLength(3);
    expect(STORES.filter((s) => s.mnemonic === 'STY')).toHaveLength(3);
  });

  it('puts every store in &80-&9F (aaa = %100 means "store" in the decoder)', () => {
    for (const store of STORES) expect(store.opcode >> 5).toBe(0b100);
  });

  it('has no immediate store: &89, where STA #&nn would be, stays empty', () => {
    expect(STORES.some((s) => s.mode === 'immediate')).toBe(false);
    expect(OPCODES[0x89]).toBeUndefined();
  });

  it('has no absolute indexed STX or STY: &9E (STX &nnnn,Y) and &9C (STY &nnnn,X) stay empty', () => {
    expect(OPCODES[0x9e]).toBeUndefined();
    expect(OPCODES[0x9c]).toBeUndefined();
  });

  it('gives each opcode as many bytes as its mode needs: 1 + operand bytes', () => {
    for (const store of STORES) expect(store.bytes).toBe(1 + MODES[store.mode].operandBytes);
  });

  it('charges indexed absolute and (zp),Y stores one cycle more than the matching LDA base time', () => {
    for (const mode of ['absoluteX', 'absoluteY', 'indirectIndexedY'] as const) {
      const sta = STORES.find((s) => s.mnemonic === 'STA' && s.mode === mode);
      const lda = LOADS.find((l) => l.mnemonic === 'LDA' && l.mode === mode);
      expect(sta?.cycles).toBe((lda?.cycles ?? 0) + 1);
    }
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const store of STORES) {
      expect(OPCODES[store.opcode]).toMatchObject({ mnemonic: store.mnemonic, mode: store.mode, bytes: store.bytes, cycles: store.cycles });
    }
  });

  it('matches the test cases one for one', () => {
    const byValue = (a: number, b: number): number => a - b;
    expect(CASES.map((c) => c.opcode).sort(byValue)).toEqual(STORES.map((s) => s.opcode).sort(byValue));
    for (const c of CASES) {
      expect(STORES.find((s) => s.opcode === c.opcode)).toMatchObject({ mode: c.mode, cycles: c.cycles });
    }
  });
});

describe.each(CASES.map((c) => [`${c.asm} (&${hex8(c.opcode)})`, c] as const))('%s', (_name, c) => {
  const name = c.register.toUpperCase();

  it(`writes ${name} to the effective address`, () => {
    const { bus } = run(c);
    expect(bus.read(c.ea)).toBe(VALUE);
  });

  it('makes exactly one bus write: the register, at the effective address', () => {
    const bus = new TestBus();
    bus.load(0xfffc, [PROGRAM & 0xff, PROGRAM >> 8]);
    bus.load(PROGRAM, c.bytes);
    for (const [address, byte] of c.memory ?? []) bus.write(address, byte);
    const recorder = new WriteRecorder(bus);
    const cpu = new Cpu6502(recorder);
    cpu.reset();
    cpu.regs[c.register] = VALUE;
    Object.assign(cpu.regs, c.index);
    cpu.step();
    expect(recorder.recorded()).toEqual([{ address: c.ea, value: VALUE }]);
  });

  it('changes no registers and no flags, only PC', () => {
    for (const flags of [
      { n: true, v: true, d: true, i: true, z: true, c: true },
      { n: false, v: false, d: false, i: false, z: false, c: false },
    ]) {
      const { cpu, bus } = cpuWith(c.bytes);
      for (const [address, byte] of c.memory ?? []) bus.write(address, byte);
      // Storing &00 or &80 would make a load set Z or N; a store mustn't.
      Object.assign(cpu.regs, { a: 0x00, x: 0x00, y: 0x00, s: 0xfd, ...flags }, { [c.register]: flags.n ? 0x00 : 0x80 }, c.index);
      const before = { ...cpu.regs };
      cpu.step();
      expect(cpu.regs).toEqual({ ...before, pc: PROGRAM + c.bytes.length });
    }
  });

  it(`advances PC by ${String(c.bytes.length)} and takes ${String(c.cycles)} cycles`, () => {
    const { cpu, cycles } = run(c);
    expect(cpu.regs.pc).toBe(PROGRAM + c.bytes.length);
    expect(cycles).toBe(c.cycles);
    expect(cpu.cycles).toBe(7 + c.cycles);
  });
});

// The three indexed stores that could cross a page: base &30F8 + &10 = &3108.
const CROSSING: readonly Case[] = [
  { opcode: 0x9d, asm: 'STA &30F8,X', register: 'a', mode: 'absoluteX', bytes: [0x9d, 0xf8, 0x30], index: { x: 0x10 }, ea: 0x3108, cycles: 5 },
  { opcode: 0x99, asm: 'STA &30F8,Y', register: 'a', mode: 'absoluteY', bytes: [0x99, 0xf8, 0x30], index: { y: 0x10 }, ea: 0x3108, cycles: 5 },
  {
    opcode: 0x91,
    asm: 'STA (&70),Y',
    register: 'a',
    mode: 'indirectIndexedY',
    bytes: [0x91, 0x70],
    index: { y: 0x10 },
    memory: [
      [0x0070, 0xf8],
      [0x0071, 0x30],
    ],
    ea: 0x3108,
    cycles: 6,
  },
];

describe.each(CROSSING)('$asm crossing from page &30 to &31', (c) => {
  it(`writes the fixed-up address &3108, not &3008, in the same ${String(c.cycles)} cycles`, () => {
    const { bus, cycles } = run(c);
    expect(bus.read(0x3108)).toBe(VALUE);
    expect(bus.read(0x3008)).toBe(0x00);
    expect(cycles).toBe(c.cycles);
  });

  it('takes the same time when the index stays inside the page (&30F8 + &07 = &30FF)', () => {
    const indexName = c.index?.x === undefined ? 'y' : 'x';
    const { bus, cycles } = run({ ...c, index: { [indexName]: 0x07 } });
    expect(bus.read(0x30ff)).toBe(VALUE);
    expect(cycles).toBe(c.cycles);
  });
});

describe('stores and wrap-around', () => {
  it('STA &FF,X with X=&01 writes &0000: zero-page indexing never leaves page zero', () => {
    const { cpu, bus } = cpuWith([0x95, 0xff]);
    cpu.regs.a = VALUE;
    cpu.regs.x = 0x01;
    cpu.step();
    expect(bus.read(0x0000)).toBe(VALUE);
    expect(bus.read(0x0100)).toBe(0x00);
  });

  it('STX &FF,Y with Y=&02 writes &0001', () => {
    const { cpu, bus } = cpuWith([0x96, 0xff]);
    cpu.regs.x = VALUE;
    cpu.regs.y = 0x02;
    cpu.step();
    expect(bus.read(0x0001)).toBe(VALUE);
  });

  it('STA (&FF),Y reads its pointer from &FF and &00', () => {
    const { cpu, bus } = cpuWith([0x91, 0xff]);
    bus.write(0x00ff, 0x00);
    bus.write(0x0000, 0x30);
    cpu.regs.a = VALUE;
    cpu.regs.y = 0x02;
    cpu.step();
    expect(bus.read(0x3002)).toBe(VALUE);
  });
});

describe('a store followed by a load', () => {
  it('round-trips the byte: STA &3000 then LDX &3000 gives X = A', () => {
    const { cpu } = cpuWith([0x8d, 0x00, 0x30, 0xae, 0x00, 0x30]); // STA &3000 : LDX &3000
    cpu.regs.a = 0xc3;
    cpu.step();
    cpu.step();
    expect(cpu.regs).toMatchObject({ x: 0xc3, n: true, z: false });
  });
});
