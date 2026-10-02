import { Cpu6502 } from '../cpu/cpu6502';
import { OPCODES } from '../cpu/opcodes';
import type { Registers } from '../cpu/registers';
import { TestBus } from '../memory/test-bus';
import { WriteRecorder, type WriteRecord } from '../memory/write-recorder';
import { listingEnd, loadListing } from './listing';
import { loadPlaygroundData } from './setup';
import { STORES_PROGRAM, STORES_PROGRAM_START } from './stores-program';

/** The playground set-up, then the program, on a bus with a write recorder in front. */
function playground(): { cpu: Cpu6502; bus: TestBus; recorder: WriteRecorder } {
  const bus = new TestBus();
  loadPlaygroundData(bus);
  loadListing(bus, STORES_PROGRAM);
  bus.load(0xfffc, [STORES_PROGRAM_START & 0xff, STORES_PROGRAM_START >> 8]);
  const recorder = new WriteRecorder(bus);
  const cpu = new Cpu6502(recorder);
  cpu.reset();
  return { cpu, bus, recorder };
}

describe('the hand-assembled stores program', () => {
  it('starts at &0400 with each line straight after the one before (no gaps or overlaps)', () => {
    let next = STORES_PROGRAM_START;
    for (const line of STORES_PROGRAM) {
      expect(line.address).toBe(next);
      next += line.bytes.length;
    }
    expect(listingEnd(STORES_PROGRAM)).toBe(0x042b);
  });

  it.each(STORES_PROGRAM.map((line) => [line.source, line] as const))(
    '%s: the opcode byte is that mnemonic, and the line has as many bytes as its mode needs',
    (source, line) => {
      const entry = OPCODES[line.bytes[0] ?? -1];
      expect(entry?.mnemonic).toBe(source.slice(0, 3));
      expect(line.bytes).toHaveLength(entry?.bytes ?? -1);
    },
  );

  it('uses every transfer, and STA, STX and STY', () => {
    const mnemonics = new Set(STORES_PROGRAM.map((line) => line.source.slice(0, 3)));
    for (const m of ['TAX', 'TAY', 'TXA', 'TYA', 'TSX', 'TXS', 'STA', 'STX', 'STY']) expect(mnemonics).toContain(m);
  });

  type Expected = Pick<Registers, 'a' | 'x' | 'y' | 's' | 'n' | 'z'> & {
    readonly cycles: number;
    readonly writes: readonly WriteRecord[];
  };
  const H = 0x48;
  const E = 0x45;
  const L = 0x4c;
  const O = 0x4f;
  const expected: readonly Expected[] = [
    { a: 0x00, x: 0xfd, y: 0x00, s: 0xfd, n: true, z: false, cycles: 2, writes: [] }, //  TSX
    { a: 0x00, x: 0xff, y: 0x00, s: 0xfd, n: true, z: false, cycles: 2, writes: [] }, //  LDX #&FF
    { a: 0x00, x: 0xff, y: 0x00, s: 0xfd, n: false, z: true, cycles: 2, writes: [] }, //  LDA #&00
    { a: 0x00, x: 0xff, y: 0x00, s: 0xff, n: false, z: true, cycles: 2, writes: [] }, //  TXS: flags untouched
    { a: H, x: 0xff, y: 0x00, s: 0xff, n: false, z: false, cycles: 4, writes: [] }, //     LDA &7C00
    { a: H, x: H, y: 0x00, s: 0xff, n: false, z: false, cycles: 2, writes: [] }, //        TAX
    { a: H, x: H, y: 0x00, s: 0xff, n: false, z: false, cycles: 4, writes: [{ address: 0x7c28, value: H }] },
    { a: E, x: H, y: 0x00, s: 0xff, n: false, z: false, cycles: 4, writes: [] }, //        LDA &7C01
    { a: E, x: H, y: E, s: 0xff, n: false, z: false, cycles: 2, writes: [] }, //           TAY
    { a: E, x: H, y: E, s: 0xff, n: false, z: false, cycles: 4, writes: [{ address: 0x7c29, value: E }] },
    { a: E, x: L, y: E, s: 0xff, n: false, z: false, cycles: 4, writes: [] }, //           LDX &7C02
    { a: L, x: L, y: E, s: 0xff, n: false, z: false, cycles: 2, writes: [] }, //           TXA
    { a: L, x: L, y: E, s: 0xff, n: false, z: false, cycles: 4, writes: [{ address: 0x7c2a, value: L }] },
    { a: L, x: 0x03, y: E, s: 0xff, n: false, z: false, cycles: 2, writes: [] }, //        LDX #&03
    { a: L, x: 0x03, y: E, s: 0xff, n: false, z: false, cycles: 5, writes: [{ address: 0x7c2b, value: L }] },
    { a: L, x: 0x03, y: O, s: 0xff, n: false, z: false, cycles: 4, writes: [] }, //        LDY &7C04
    { a: O, x: 0x03, y: O, s: 0xff, n: false, z: false, cycles: 2, writes: [] }, //        TYA
    { a: O, x: 0x03, y: 0x2c, s: 0xff, n: false, z: false, cycles: 2, writes: [] }, //     LDY #&2C
    { a: O, x: 0x03, y: 0x2c, s: 0xff, n: false, z: false, cycles: 6, writes: [{ address: 0x7c2c, value: O }] },
    { a: O, x: 0x03, y: 0x2c, s: 0xff, n: false, z: false, cycles: 4, writes: [{ address: 0x7c04, value: O }] },
  ];

  it('runs line by line with the registers, flags, cycles and writes its comments promise', () => {
    expect(expected).toHaveLength(STORES_PROGRAM.length);
    const { cpu, recorder } = playground();
    STORES_PROGRAM.forEach((line, i) => {
      expect(cpu.regs.pc).toBe(line.address);
      recorder.clear();
      const cycles = cpu.step();
      expect({ ...cpu.regs, cycles, writes: recorder.recorded() }).toMatchObject(expected[i] ?? {});
    });
    expect(cpu.regs.pc).toBe(0x042b);
  });

  it('leaves "HELLO" on row 1 of the Mode 7 screen (&7C28), with row 0 unchanged', () => {
    const { cpu, bus } = playground();
    for (let i = 0; i < STORES_PROGRAM.length; i++) cpu.step();
    const text = (from: number, length: number): string =>
      String.fromCharCode(...Array.from({ length }, (_, i) => bus.read(from + i)));
    expect(text(0x7c28, 5)).toBe('HELLO');
    expect(text(0x7c00, 16)).toBe('HELLO, BBC MICRO');
  });

  it('makes 6 writes in 63 cycles (70 including the reset)', () => {
    const { cpu, recorder } = playground();
    for (let i = 0; i < STORES_PROGRAM.length; i++) cpu.step();
    expect(recorder.count).toBe(6);
    expect(cpu.cycles).toBe(7 + 63);
  });
});
