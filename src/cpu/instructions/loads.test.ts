import { TestBus } from '../../memory/test-bus';
import { MODES, type AddressingMode } from '../addressing';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import type { Registers } from '../registers';
import { hex8 } from '../../util/bits';
import { LOADS } from './loads';

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

type LoadRegister = 'a' | 'x' | 'y';

interface Case {
  readonly opcode: number;
  readonly asm: string;
  readonly register: LoadRegister;
  readonly mode: AddressingMode;
  /** Program bytes at &0400, opcode first. */
  readonly bytes: readonly number[];
  /** Index registers to set before stepping. */
  readonly index?: Partial<Pick<Registers, 'x' | 'y'>>;
  /** Extra memory (pointers) to set up: [address, byte] pairs. */
  readonly memory?: readonly (readonly [number, number])[];
  /** Where the value must be read from. */
  readonly ea: number;
  readonly cycles: number;
}

// One case per opcode, none crossing a page. The value goes at ea, so for
// immediate (ea = &0401) it overwrites the operand byte, which is exactly
// where immediate data lives.
const CASES: readonly Case[] = [
  // LDA: 8 modes
  { opcode: 0xa9, asm: 'LDA #&nn', register: 'a', mode: 'immediate', bytes: [0xa9, 0x00], ea: 0x0401, cycles: 2 },
  { opcode: 0xa5, asm: 'LDA &70', register: 'a', mode: 'zeroPage', bytes: [0xa5, 0x70], ea: 0x0070, cycles: 3 },
  { opcode: 0xb5, asm: 'LDA &70,X', register: 'a', mode: 'zeroPageX', bytes: [0xb5, 0x70], index: { x: 0x05 }, ea: 0x0075, cycles: 4 },
  { opcode: 0xad, asm: 'LDA &3000', register: 'a', mode: 'absolute', bytes: [0xad, 0x00, 0x30], ea: 0x3000, cycles: 4 },
  { opcode: 0xbd, asm: 'LDA &3000,X', register: 'a', mode: 'absoluteX', bytes: [0xbd, 0x00, 0x30], index: { x: 0x05 }, ea: 0x3005, cycles: 4 },
  { opcode: 0xb9, asm: 'LDA &3000,Y', register: 'a', mode: 'absoluteY', bytes: [0xb9, 0x00, 0x30], index: { y: 0x05 }, ea: 0x3005, cycles: 4 },
  {
    opcode: 0xa1,
    asm: 'LDA (&70,X)',
    register: 'a',
    mode: 'indexedIndirectX',
    bytes: [0xa1, 0x70],
    index: { x: 0x04 },
    memory: [
      [0x0074, 0x00],
      [0x0075, 0x30],
    ],
    ea: 0x3000,
    cycles: 6,
  },
  {
    opcode: 0xb1,
    asm: 'LDA (&70),Y',
    register: 'a',
    mode: 'indirectIndexedY',
    bytes: [0xb1, 0x70],
    index: { y: 0x05 },
    memory: [
      [0x0070, 0x00],
      [0x0071, 0x30],
    ],
    ea: 0x3005,
    cycles: 5,
  },
  // LDX: 5 modes, indexed by Y (never by X itself)
  { opcode: 0xa2, asm: 'LDX #&nn', register: 'x', mode: 'immediate', bytes: [0xa2, 0x00], ea: 0x0401, cycles: 2 },
  { opcode: 0xa6, asm: 'LDX &70', register: 'x', mode: 'zeroPage', bytes: [0xa6, 0x70], ea: 0x0070, cycles: 3 },
  { opcode: 0xb6, asm: 'LDX &70,Y', register: 'x', mode: 'zeroPageY', bytes: [0xb6, 0x70], index: { y: 0x05 }, ea: 0x0075, cycles: 4 },
  { opcode: 0xae, asm: 'LDX &3000', register: 'x', mode: 'absolute', bytes: [0xae, 0x00, 0x30], ea: 0x3000, cycles: 4 },
  { opcode: 0xbe, asm: 'LDX &3000,Y', register: 'x', mode: 'absoluteY', bytes: [0xbe, 0x00, 0x30], index: { y: 0x05 }, ea: 0x3005, cycles: 4 },
  // LDY: 5 modes, indexed by X (never by Y itself)
  { opcode: 0xa0, asm: 'LDY #&nn', register: 'y', mode: 'immediate', bytes: [0xa0, 0x00], ea: 0x0401, cycles: 2 },
  { opcode: 0xa4, asm: 'LDY &70', register: 'y', mode: 'zeroPage', bytes: [0xa4, 0x70], ea: 0x0070, cycles: 3 },
  { opcode: 0xb4, asm: 'LDY &70,X', register: 'y', mode: 'zeroPageX', bytes: [0xb4, 0x70], index: { x: 0x05 }, ea: 0x0075, cycles: 4 },
  { opcode: 0xac, asm: 'LDY &3000', register: 'y', mode: 'absolute', bytes: [0xac, 0x00, 0x30], ea: 0x3000, cycles: 4 },
  { opcode: 0xbc, asm: 'LDY &3000,X', register: 'y', mode: 'absoluteX', bytes: [0xbc, 0x00, 0x30], index: { x: 0x05 }, ea: 0x3005, cycles: 4 },
];

/** Sets up a case with value at its EA, steps once, and returns the CPU and what it took. */
function run(c: Case, value: number): { cpu: Cpu6502; before: Registers; cycles: number } {
  const { cpu, bus } = cpuWith(c.bytes);
  for (const [address, byte] of c.memory ?? []) bus.write(address, byte);
  bus.write(c.ea, value);
  Object.assign(cpu.regs, c.index);
  const before = { ...cpu.regs };
  const cycles = cpu.step();
  return { cpu, before, cycles };
}

describe('the load opcode table', () => {
  it('has the 18 documented loads: 8 LDA, 5 LDX, 5 LDY', () => {
    expect(LOADS).toHaveLength(18);
    expect(LOADS.filter((l) => l.mnemonic === 'LDA')).toHaveLength(8);
    expect(LOADS.filter((l) => l.mnemonic === 'LDX')).toHaveLength(5);
    expect(LOADS.filter((l) => l.mnemonic === 'LDY')).toHaveLength(5);
  });

  it('puts every load in &A0-&BF (aaa = %101 means "load" in the decoder)', () => {
    for (const load of LOADS) expect(load.opcode >> 5).toBe(0b101);
  });

  it('gives each opcode as many bytes as its mode needs: 1 + operand bytes', () => {
    for (const load of LOADS) expect(load.bytes).toBe(1 + MODES[load.mode].operandBytes);
  });

  it('is installed in OPCODES at each opcode byte', () => {
    for (const load of LOADS) {
      expect(OPCODES[load.opcode]).toMatchObject({ mnemonic: load.mnemonic, mode: load.mode, bytes: load.bytes, cycles: load.cycles });
    }
  });

  it('matches the test cases one for one', () => {
    const byValue = (a: number, b: number): number => a - b;
    expect(CASES.map((c) => c.opcode).sort(byValue)).toEqual(LOADS.map((l) => l.opcode).sort(byValue));
    for (const c of CASES) {
      expect(LOADS.find((l) => l.opcode === c.opcode)).toMatchObject({ mode: c.mode, cycles: c.cycles });
    }
  });
});

describe.each(CASES.map((c) => [`${c.asm} (&${hex8(c.opcode)})`, c] as const))('%s', (_name, c) => {
  const name = c.register.toUpperCase();

  it(`copies the byte at the effective address into ${name}`, () => {
    const { cpu } = run(c, 0x41);
    expect(cpu.regs[c.register]).toBe(0x41);
  });

  it('sets Z and clears N when the value is &00', () => {
    const { cpu } = run(c, 0x00);
    expect(cpu.regs).toMatchObject({ n: false, z: true });
  });

  it('sets N and clears Z when bit 7 is set (&80)', () => {
    const { cpu } = run(c, 0x80);
    expect(cpu.regs).toMatchObject({ n: true, z: false });
  });

  it('clears both N and Z for a positive non-zero value (&41)', () => {
    const { cpu } = run(c, 0x41);
    expect(cpu.regs).toMatchObject({ n: false, z: false });
  });

  it(`changes only ${name}, N, Z and PC: the other registers and C, V, D, I are untouched`, () => {
    const { cpu, bus } = cpuWith(c.bytes);
    for (const [address, byte] of c.memory ?? []) bus.write(address, byte);
    bus.write(c.ea, 0xff);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33, c: true, v: true, d: true, i: true, n: false, z: true }, c.index);
    const before = { ...cpu.regs };
    cpu.step();
    expect(cpu.regs).toEqual({ ...before, [c.register]: 0xff, n: true, z: false, pc: PROGRAM + c.bytes.length });
  });

  it(`advances PC by ${String(c.bytes.length)} and takes ${String(c.cycles)} cycles`, () => {
    const { cpu, cycles } = run(c, 0x41);
    expect(cpu.regs.pc).toBe(PROGRAM + c.bytes.length);
    expect(cycles).toBe(c.cycles);
    expect(cpu.cycles).toBe(7 + c.cycles);
  });
});

// Each indexed read that can cross a page: base &30F8 + &10 = &3108.
const CROSSING: readonly Case[] = [
  { opcode: 0xbd, asm: 'LDA &30F8,X', register: 'a', mode: 'absoluteX', bytes: [0xbd, 0xf8, 0x30], index: { x: 0x10 }, ea: 0x3108, cycles: 5 },
  { opcode: 0xb9, asm: 'LDA &30F8,Y', register: 'a', mode: 'absoluteY', bytes: [0xb9, 0xf8, 0x30], index: { y: 0x10 }, ea: 0x3108, cycles: 5 },
  {
    opcode: 0xb1,
    asm: 'LDA (&70),Y',
    register: 'a',
    mode: 'indirectIndexedY',
    bytes: [0xb1, 0x70],
    index: { y: 0x10 },
    memory: [
      [0x0070, 0xf8],
      [0x0071, 0x30],
    ],
    ea: 0x3108,
    cycles: 6,
  },
  { opcode: 0xbe, asm: 'LDX &30F8,Y', register: 'x', mode: 'absoluteY', bytes: [0xbe, 0xf8, 0x30], index: { y: 0x10 }, ea: 0x3108, cycles: 5 },
  { opcode: 0xbc, asm: 'LDY &30F8,X', register: 'y', mode: 'absoluteX', bytes: [0xbc, 0xf8, 0x30], index: { x: 0x10 }, ea: 0x3108, cycles: 5 },
];

describe.each(CROSSING)('$asm crossing from page &30 to &31', (c) => {
  it(`reads &3108 and pays +1 cycle for the high-byte fix-up (${String(c.cycles)} cycles)`, () => {
    const { cpu, cycles } = run(c, 0x5a);
    expect(cpu.regs[c.register]).toBe(0x5a);
    expect(cycles).toBe(c.cycles);
  });

  it('pays nothing extra when the index stops at the last byte of the page (&30F8 + &07 = &30FF)', () => {
    const indexName = c.index?.x === undefined ? 'y' : 'x';
    const noCross: Case = { ...c, index: { [indexName]: 0x07 }, ea: 0x30ff };
    const { cpu, cycles } = run(noCross, 0x5a);
    expect(cpu.regs[c.register]).toBe(0x5a);
    expect(cycles).toBe(c.cycles - 1);
  });
});

describe('loads in sequence', () => {
  it('leave N and Z describing the LAST value loaded, whichever register it went into', () => {
    const { cpu } = cpuWith([0xa9, 0x80, 0xa2, 0x00]); // LDA #&80 : LDX #&00
    cpu.step();
    expect(cpu.regs).toMatchObject({ a: 0x80, n: true, z: false });
    cpu.step();
    expect(cpu.regs).toMatchObject({ a: 0x80, x: 0x00, n: false, z: true });
  });

  it('LDA &FF,X with X=&01 reads &0000: the zero-page wrap reaches the instruction', () => {
    const { cpu, bus } = cpuWith([0xb5, 0xff]);
    bus.write(0x0000, 0x99);
    bus.write(0x0100, 0x11); // where a wrong 16-bit add would look
    cpu.regs.x = 0x01;
    cpu.step();
    expect(cpu.regs.a).toBe(0x99);
  });

  it('LDA #&nn reads its operand, not the memory the operand would point at', () => {
    const { cpu, bus } = cpuWith([0xa9, 0x70]);
    bus.write(0x0070, 0x99);
    cpu.step();
    expect(cpu.regs.a).toBe(0x70);
  });
});
