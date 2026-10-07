import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { SUBROUTINES } from './subroutines';

const JSR = 0x20;
const RTS = 0x60;

/** A CPU on a flat 64K bus, reset to start with S = &FF, with the given bytes there. */
function cpuAt(start: number, bytes: readonly number[]): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [start & 0xff, start >> 8]);
  bus.load(start, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.regs.s = 0xff;
  return { cpu, bus };
}

const SIX = ['n', 'v', 'd', 'i', 'z', 'c'] as const;

describe('the subroutine opcodes', () => {
  it('has JSR absolute (&20, 3 bytes) and RTS implied (&60, 1 byte), both 6 cycles', () => {
    expect(SUBROUTINES.map((op) => [op.mnemonic, op.opcode, op.mode, op.bytes, op.cycles])).toEqual([
      ['JSR', JSR, 'absolute', 3, 6],
      ['RTS', RTS, 'implied', 1, 6],
    ]);
    for (const op of SUBROUTINES) expect(OPCODES[op.opcode]).toBe(op);
  });
});

describe('JSR &nnnn (&20)', () => {
  it('jumps to the operand in 6 cycles', () => {
    const { cpu } = cpuAt(0x0407, [JSR, 0x28, 0x04]);
    expect(cpu.step()).toBe(6);
    expect(cpu.regs.pc).toBe(0x0428);
  });

  it('pushes the address of its own last byte (PC - 1): high byte to &01FF, low byte to &01FE', () => {
    const { cpu, bus } = cpuAt(0x0407, [JSR, 0x28, 0x04]);
    cpu.step();
    expect(bus.read(0x01ff)).toBe(0x04);
    expect(bus.read(0x01fe)).toBe(0x09); // &0409, not &040A
    expect(cpu.regs.s).toBe(0xfd);
  });

  it('pushes the high byte first: the pushed word reads low byte first, like any other', () => {
    const { cpu, bus } = cpuAt(0x12fe, [JSR, 0x00, 0x30]); // last byte at &1300
    const writes: number[][] = [];
    const write = bus.write.bind(bus);
    bus.write = (address: number, value: number): void => {
      writes.push([address, value]);
      write(address, value);
    };
    cpu.step();
    expect(writes).toEqual([
      [0x01ff, 0x13],
      [0x01fe, 0x00],
    ]);
  });

  it('fetches its high operand byte after both pushes, so the PC it pushes still points at that byte', () => {
    const { cpu, bus } = cpuAt(0x0407, [JSR, 0x28, 0x04]);
    const log: string[] = [];
    const read = bus.read.bind(bus);
    const write = bus.write.bind(bus);
    bus.read = (address: number): number => {
      log.push(`R ${address.toString(16)}`);
      return read(address);
    };
    bus.write = (address: number, value: number): void => {
      log.push(`W ${address.toString(16)}`);
      write(address, value);
    };
    cpu.step();
    expect(log).toEqual(['R 407', 'R 408', 'W 1ff', 'W 1fe', 'R 409']);
  });

  it('wraps S like any push: from S = &00 it writes &0100 then &01FF', () => {
    const { cpu, bus } = cpuAt(0x0400, [JSR, 0x00, 0x30]);
    cpu.regs.s = 0x00;
    cpu.step();
    expect(bus.read(0x0100)).toBe(0x04);
    expect(bus.read(0x01ff)).toBe(0x02);
    expect(cpu.regs.s).toBe(0xfe);
  });

  it('changes no flags and no register but PC and S', () => {
    const { cpu } = cpuAt(0x0400, [JSR, 0x00, 0x30]);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33 });
    for (const f of SIX) cpu.regs[f] = true;
    cpu.step();
    expect(cpu.regs).toMatchObject({ a: 0x11, x: 0x22, y: 0x33 });
    for (const f of SIX) expect(cpu.regs[f]).toBe(true);
  });
});

describe('RTS (&60)', () => {
  it('pulls the low byte then the high byte, adds 1, and goes there in 6 cycles', () => {
    const { cpu, bus } = cpuAt(0x0440, [RTS]);
    cpu.regs.s = 0xfd;
    bus.load(0x01fe, [0x09, 0x04]);
    expect(cpu.step()).toBe(6);
    expect(cpu.regs.pc).toBe(0x040a);
    expect(cpu.regs.s).toBe(0xff);
  });

  it('wraps a pulled &FFFF round to &0000', () => {
    const { cpu, bus } = cpuAt(0x0400, [RTS]);
    cpu.regs.s = 0xfd;
    bus.load(0x01fe, [0xff, 0xff]);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0000);
  });

  it('wraps S like any pull: from S = &FF it reads &0100 then &0101', () => {
    const { cpu, bus } = cpuAt(0x0400, [RTS]);
    bus.load(0x0100, [0x33, 0x12]);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x1234);
    expect(cpu.regs.s).toBe(0x01);
  });

  it('changes no flags and no register but PC and S', () => {
    const { cpu } = cpuAt(0x0400, [RTS]);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33 });
    for (const f of SIX) cpu.regs[f] = false;
    cpu.step();
    expect(cpu.regs).toMatchObject({ a: 0x11, x: 0x22, y: 0x33 });
    for (const f of SIX) expect(cpu.regs[f]).toBe(false);
  });

  it('can be used as a computed jump: push (target - 1), high byte first, then RTS', () => {
    // LDA #&2F : PHA : LDA #&FF : PHA : RTS   → goes to &2FFF + 1 = &3000
    const { cpu } = cpuAt(0x0400, [0xa9, 0x2f, 0x48, 0xa9, 0xff, 0x48, RTS]);
    for (let i = 0; i < 5; i++) cpu.step();
    expect(cpu.regs.pc).toBe(0x3000);
    expect(cpu.regs.s).toBe(0xff);
  });
});

describe('JSR and RTS together', () => {
  it('round trip: RTS comes back to the instruction after the JSR, with S where it started', () => {
    // &0400 JSR &0410 ; &0403 NOP ... &0410 RTS
    const { cpu, bus } = cpuAt(0x0400, [JSR, 0x10, 0x04, 0xea]);
    bus.write(0x0410, RTS);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0410);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0403);
    expect(cpu.regs.s).toBe(0xff);
    expect(cpu.cycles).toBe(7 + 6 + 6);
  });

  it('nests: two calls deep, the stack holds both return addresses and they come back in reverse order', () => {
    // &0400 JSR &0410 ; &0410 JSR &0420 ; &0413 RTS ; &0420 RTS
    const { cpu, bus } = cpuAt(0x0400, [JSR, 0x10, 0x04]);
    bus.load(0x0410, [JSR, 0x20, 0x04, RTS]);
    bus.write(0x0420, RTS);
    cpu.step();
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0420);
    expect(cpu.regs.s).toBe(0xfb);
    expect([0x01ff, 0x01fe, 0x01fd, 0x01fc].map((a) => bus.read(a))).toEqual([0x04, 0x02, 0x04, 0x12]);
    cpu.step(); // the inner RTS
    expect(cpu.regs.pc).toBe(0x0413);
    cpu.step(); // the outer RTS
    expect(cpu.regs.pc).toBe(0x0403);
    expect(cpu.regs.s).toBe(0xff);
  });
});
