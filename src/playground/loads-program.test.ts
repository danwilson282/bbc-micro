import { Cpu6502 } from '../cpu/cpu6502';
import { OPCODES } from '../cpu/opcodes';
import type { Registers } from '../cpu/registers';
import { TestBus } from '../memory/test-bus';
import { listingEnd, loadListing } from './listing';
import { LOADS_PROGRAM, LOADS_PROGRAM_START } from './loads-program';
import { loadPlaygroundData } from './setup';

/** The Stage 05 playground set-up the program relies on, then the program. */
function playground(): Cpu6502 {
  const bus = new TestBus();
  loadPlaygroundData(bus);
  loadListing(bus, LOADS_PROGRAM);
  bus.load(0xfffc, [LOADS_PROGRAM_START & 0xff, LOADS_PROGRAM_START >> 8]);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return cpu;
}

describe('the hand-assembled loads program', () => {
  it('starts at &0400 with each line straight after the one before (no gaps or overlaps)', () => {
    let next = LOADS_PROGRAM_START;
    for (const line of LOADS_PROGRAM) {
      expect(line.address).toBe(next);
      next += line.bytes.length;
    }
    expect(listingEnd(LOADS_PROGRAM)).toBe(0x0419);
  });

  it.each(LOADS_PROGRAM.map((line) => [line.source, line] as const))(
    '%s: the opcode byte is that mnemonic, and the line has as many bytes as its mode needs',
    (source, line) => {
      const entry = OPCODES[line.bytes[0] ?? -1];
      expect(entry?.mnemonic).toBe(source.slice(0, 3));
      expect(line.bytes).toHaveLength(entry?.bytes ?? -1);
    },
  );

  type Expected = Pick<Registers, 'a' | 'x' | 'y' | 'n' | 'z'> & { cycles: number };
  const expected: readonly Expected[] = [
    { a: 0x00, x: 0x00, y: 0x00, n: false, z: true, cycles: 2 }, //  LDA #&00
    { a: 0x80, x: 0x00, y: 0x00, n: true, z: false, cycles: 2 }, //  LDA #&80
    { a: 0x41, x: 0x00, y: 0x00, n: false, z: false, cycles: 2 }, // LDA #&41
    { a: 0x41, x: 0x07, y: 0x00, n: false, z: false, cycles: 2 }, // LDX #&07
    { a: 0x42, x: 0x07, y: 0x00, n: false, z: false, cycles: 4 }, // LDA &7C00,X  "B"
    { a: 0x42, x: 0x07, y: 0xf8, n: true, z: false, cycles: 2 }, //  LDY #&F8
    { a: 0x48, x: 0x07, y: 0xf8, n: false, z: false, cycles: 5 }, // LDA &7B08,Y  "H", page crossed
    { a: 0x48, x: 0x07, y: 0x04, n: false, z: false, cycles: 2 }, // LDY #&04
    { a: 0x4f, x: 0x07, y: 0x04, n: false, z: false, cycles: 5 }, // LDA (&70),Y  "O"
    { a: 0x4f, x: 0x00, y: 0x04, n: false, z: true, cycles: 3 }, //  LDX &70
    { a: 0x4f, x: 0x00, y: 0x45, n: false, z: false, cycles: 4 }, // LDY &7C01    "E"
  ];

  it('runs line by line with the registers, flags and cycles its comments promise', () => {
    expect(expected).toHaveLength(LOADS_PROGRAM.length);
    const cpu = playground();
    LOADS_PROGRAM.forEach((line, i) => {
      expect(cpu.regs.pc).toBe(line.address);
      const cycles = cpu.step();
      expect({ ...cpu.regs, cycles }).toMatchObject(expected[i] ?? {});
    });
    expect(cpu.regs.pc).toBe(0x0419);
  });

  it('takes 33 cycles in total (40 including the reset), and never touches C, V, D or I', () => {
    const cpu = playground();
    for (let i = 0; i < LOADS_PROGRAM.length; i++) cpu.step();
    expect(cpu.cycles).toBe(7 + 33);
    expect(cpu.regs).toMatchObject({ c: false, v: false, d: false, i: true });
  });
});
