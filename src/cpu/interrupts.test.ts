import { TestBus } from '../memory/test-bus';
import { Cpu6502, INTERRUPT_CYCLES, IRQ_VECTOR, NMI_VECTOR } from './cpu6502';

const NOP = 0xea;
const CLI = 0x58;

/**
 * A CPU on a flat 64K bus: reset to start with S = &FF and I clear, NMI
 * handler at &0600, IRQ/BRK handler at &0700, and NOPs at start.
 */
function cpuAt(start = 0x0400): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(NMI_VECTOR, [0x00, 0x06, start & 0xff, start >> 8, 0x00, 0x07]);
  bus.load(start, [NOP, NOP, NOP, NOP]);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  cpu.regs.s = 0xff;
  cpu.regs.i = false;
  return { cpu, bus };
}

describe('the vectors (MCS6500 manual, Chapter 9)', () => {
  it('are NMI at &FFFA, RESET at &FFFC and IRQ/BRK at &FFFE, each a word, low byte first', () => {
    expect([NMI_VECTOR, IRQ_VECTOR]).toEqual([0xfffa, 0xfffe]);
    expect(INTERRUPT_CYCLES).toBe(7);
  });
});

describe('IRQ: a level-sensitive input, masked by I', () => {
  it('is not taken while the line is released', () => {
    const { cpu } = cpuAt();
    expect(cpu.step()).toBe(2);
    expect(cpu.regs.pc).toBe(0x0401);
  });

  it('is taken before the next instruction: pushes PC and P with B = 0, sets I, vectors through &FFFE, 7 cycles', () => {
    const { cpu, bus } = cpuAt();
    cpu.step(); // NOP: PC = &0401
    cpu.regs.c = true; // P = &21 inside the chip
    cpu.irq = true;
    const before = cpu.cycles;
    expect(cpu.step()).toBe(7);
    expect(cpu.cycles - before).toBe(7);
    expect(cpu.regs.pc).toBe(0x0700);
    expect(bus.read(0x01ff)).toBe(0x04); // PCH
    expect(bus.read(0x01fe)).toBe(0x01); // PCL: exactly the next instruction, no "- 1"
    expect(bus.read(0x01fd)).toBe(0x21); // %0010 0001: bit 5 = 1, B = 0, C = 1
    expect(cpu.regs.s).toBe(0xfc);
    expect(cpu.regs.i).toBe(true);
  });

  it('pushes in the hardware order: PCH, PCL, P, then reads the vector low then high', () => {
    const { cpu, bus } = cpuAt();
    const log: string[] = [];
    const read = bus.read.bind(bus);
    const write = bus.write.bind(bus);
    bus.read = (address: number): number => {
      log.push(`R ${address.toString(16)}`);
      return read(address);
    };
    bus.write = (address: number, value: number): void => {
      log.push(`W ${address.toString(16)}=${value.toString(16)}`);
      write(address, value);
    };
    cpu.irq = true;
    cpu.step();
    expect(log).toEqual(['W 1ff=4', 'W 1fe=0', 'W 1fd=20', 'R fffe', 'R ffff']);
  });

  it('is held off while I is set, and the instruction runs instead', () => {
    const { cpu } = cpuAt();
    cpu.regs.i = true;
    cpu.irq = true;
    expect(cpu.step()).toBe(2);
    expect(cpu.regs.pc).toBe(0x0401);
  });

  it('is taken as soon as I is cleared, if the line is still held: nothing was lost', () => {
    const { cpu, bus } = cpuAt();
    bus.write(0x0400, CLI);
    cpu.regs.i = true;
    cpu.irq = true;
    cpu.step(); // CLI
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x0700);
  });

  it('is forgotten if the line is released before the CPU looks: a level has no memory', () => {
    const { cpu } = cpuAt();
    cpu.irq = true;
    cpu.irq = false;
    expect(cpu.step()).toBe(2);
    expect(cpu.regs.pc).toBe(0x0401);
  });

  it('is taken again after RTI if the handler never released the line', () => {
    const { cpu, bus } = cpuAt();
    bus.write(0x0700, 0x40); // the handler is just RTI: no acknowledge
    cpu.irq = true;
    expect(cpu.step()).toBe(7); // IRQ
    expect(cpu.step()).toBe(6); // RTI: I = 0 again, back to &0400
    expect(cpu.regs.pc).toBe(0x0400);
    expect(cpu.step()).toBe(7); // straight back in: the main program never gets a turn
    expect(cpu.regs.pc).toBe(0x0700);
  });

  it('leaves D alone on the NMOS 6502 (the 65C02 would clear it)', () => {
    const { cpu } = cpuAt();
    cpu.regs.d = true;
    cpu.irq = true;
    cpu.step();
    expect(cpu.regs.d).toBe(true);
  });

  it('wraps S like any push: from S = &01 it writes &0101, &0100, then &01FF', () => {
    const { cpu, bus } = cpuAt();
    cpu.regs.s = 0x01;
    cpu.irq = true;
    cpu.step();
    expect([bus.read(0x0101), bus.read(0x0100), bus.read(0x01ff)]).toEqual([0x04, 0x00, 0x20]);
    expect(cpu.regs.s).toBe(0xfe);
  });
});

describe('NMI: an edge-triggered input that I cannot mask', () => {
  it('a falling edge latches a request, taken before the next instruction through &FFFA, 7 cycles', () => {
    const { cpu, bus } = cpuAt();
    cpu.setNmi(true);
    expect(cpu.nmiPending).toBe(true);
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x0600);
    expect([bus.read(0x01ff), bus.read(0x01fe), bus.read(0x01fd)]).toEqual([0x04, 0x00, 0x20]);
    expect(cpu.regs.i).toBe(true);
    expect(cpu.nmiPending).toBe(false);
  });

  it('is taken even with I set', () => {
    const { cpu, bus } = cpuAt();
    cpu.regs.i = true;
    cpu.setNmi(true);
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x0600);
    expect(bus.read(0x01fd)).toBe(0x24); // the I it interrupted is saved: RTI will put it back
  });

  it('is remembered after the line is released: a quick pulse still counts', () => {
    const { cpu } = cpuAt();
    cpu.setNmi(true);
    cpu.setNmi(false);
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x0600);
  });

  it('fires once per edge: holding the line low does not fire again', () => {
    const { cpu, bus } = cpuAt();
    bus.write(0x0600, 0x40); // RTI
    cpu.setNmi(true);
    cpu.step(); // NMI
    cpu.step(); // RTI
    cpu.setNmi(true); // still held: no new edge
    expect(cpu.nmiPending).toBe(false);
    expect(cpu.step()).toBe(2); // the NOP at &0400 runs
  });

  it('fires again after the line goes high and then low again', () => {
    const { cpu, bus } = cpuAt();
    bus.write(0x0600, 0x40); // RTI
    cpu.setNmi(true);
    cpu.step(); // NMI
    cpu.step(); // RTI
    cpu.setNmi(false);
    cpu.setNmi(true);
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x0600);
  });

  it('wins over an IRQ waiting at the same boundary; the IRQ then waits for I to clear', () => {
    const { cpu, bus } = cpuAt();
    bus.write(0x0600, 0x40); // the NMI handler is just RTI
    cpu.irq = true;
    cpu.setNmi(true);
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0600);
    cpu.step(); // RTI: back to &0400 with I = 0
    expect(cpu.step()).toBe(7);
    expect(cpu.regs.pc).toBe(0x0700);
  });
});

describe('pendingInterrupt: what the next step() will do instead of an instruction', () => {
  it('names the NMI first, then an unmasked IRQ, else undefined', () => {
    const { cpu } = cpuAt();
    expect(cpu.pendingInterrupt).toBeUndefined();
    cpu.irq = true;
    expect(cpu.pendingInterrupt).toBe('irq');
    cpu.regs.i = true;
    expect(cpu.pendingInterrupt).toBeUndefined();
    cpu.setNmi(true);
    expect(cpu.pendingInterrupt).toBe('nmi');
  });
});

describe('reset and the interrupt inputs', () => {
  it('clears a latched NMI (our choice), and leaves the IRQ line to whoever drives it', () => {
    const { cpu } = cpuAt();
    cpu.setNmi(true);
    cpu.irq = true;
    cpu.reset();
    expect(cpu.nmiPending).toBe(false);
    expect(cpu.irq).toBe(true);
    expect(cpu.regs.i).toBe(true); // so the held IRQ waits for CLI
  });
});
