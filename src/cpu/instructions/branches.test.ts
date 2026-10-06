import { TestBus } from '../../memory/test-bus';
import { Cpu6502 } from '../cpu6502';
import { OPCODES } from '../opcodes';
import { hex16 } from '../../util/bits';
import { BRANCHES } from './branches';

/** A CPU on a flat 64K bus, reset to start, with the given bytes there. */
function cpuAt(start: number, bytes: readonly number[]): Cpu6502 {
  const bus = new TestBus();
  bus.load(0xfffc, [start & 0xff, start >> 8]);
  bus.load(start, bytes);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return cpu;
}

// Each branch, the flag it tests, and the value that makes it branch.
const CASES = [
  { mnemonic: 'BPL', opcode: 0x10, flag: 'n', when: false },
  { mnemonic: 'BMI', opcode: 0x30, flag: 'n', when: true },
  { mnemonic: 'BVC', opcode: 0x50, flag: 'v', when: false },
  { mnemonic: 'BVS', opcode: 0x70, flag: 'v', when: true },
  { mnemonic: 'BCC', opcode: 0x90, flag: 'c', when: false },
  { mnemonic: 'BCS', opcode: 0xb0, flag: 'c', when: true },
  { mnemonic: 'BNE', opcode: 0xd0, flag: 'z', when: false },
  { mnemonic: 'BEQ', opcode: 0xf0, flag: 'z', when: true },
] as const;

describe('the branch opcode table', () => {
  it('has the 8 branches, all relative mode, 2 bytes, 2 base cycles, each in OPCODES', () => {
    expect(BRANCHES.map((d) => d.mnemonic)).toEqual(CASES.map((c) => c.mnemonic));
    for (const d of BRANCHES) {
      expect(d).toMatchObject({ mode: 'relative', bytes: 2, cycles: 2 });
      expect(OPCODES[d.opcode]?.mnemonic).toBe(d.mnemonic);
    }
  });

  it('follows the xxy1 0000 pattern: xx picks N, V, C or Z, y is the value that branches', () => {
    const FLAGS = ['n', 'v', 'c', 'z'];
    for (const c of CASES) {
      expect(c.opcode & 0x1f).toBe(0x10);
      expect(FLAGS[c.opcode >> 6]).toBe(c.flag);
      expect((c.opcode & 0x20) !== 0).toBe(c.when);
    }
  });
});

describe.each(CASES)('$mnemonic (&$opcode): branch if $flag = $when', ({ opcode, flag, when }) => {
  it('not taken: PC moves on to the next instruction, 2 cycles', () => {
    const cpu = cpuAt(0x0400, [opcode, 0x10]);
    cpu.regs[flag] = !when;
    expect(cpu.step()).toBe(2);
    expect(cpu.regs.pc).toBe(0x0402);
  });

  it('taken forwards: target = next instruction + offset, 3 cycles', () => {
    const cpu = cpuAt(0x0400, [opcode, 0x10]);
    cpu.regs[flag] = when;
    expect(cpu.step()).toBe(3);
    expect(cpu.regs.pc).toBe(0x0412); // &0402 + &10
  });

  it('taken backwards: offset &FD is −3, so &0413 − 3 = &0410', () => {
    const cpu = cpuAt(0x0411, [opcode, 0xfd]);
    cpu.regs[flag] = when;
    expect(cpu.step()).toBe(3);
    expect(cpu.regs.pc).toBe(0x0410);
  });

  it('taken into a different page: 4 cycles', () => {
    const cpu = cpuAt(0x04f0, [opcode, 0x20]); // &04F2 + &20 = &0512
    cpu.regs[flag] = when;
    expect(cpu.step()).toBe(4);
    expect(cpu.regs.pc).toBe(0x0512);
  });

  it('leaves every register and flag alone, apart from PC', () => {
    const cpu = cpuAt(0x0400, [opcode, 0x10]);
    Object.assign(cpu.regs, { a: 0x11, x: 0x22, y: 0x33, s: 0x44, n: true, v: true, d: true, i: true, z: true, c: true });
    cpu.regs[flag] = when;
    const before = { ...cpu.regs };
    cpu.step();
    expect({ ...cpu.regs, pc: before.pc }).toEqual(before);
  });
});

describe('branch page crossing and wrap-around', () => {
  it('compares the target with the NEXT instruction: BNE at &04FE back to &04F0 crosses (next is &0500), 4 cycles', () => {
    const cpu = cpuAt(0x04fe, [0xd0, 0xf0]); // &0500 − 16 = &04F0
    cpu.regs.z = false;
    expect(cpu.step()).toBe(4);
    expect(cpu.regs.pc).toBe(0x04f0);
  });

  it('BNE at &04FE with offset &00 lands on &0500 in 3 cycles: the target is in the next instruction\'s page, not the BNE\'s', () => {
    const cpu = cpuAt(0x04fe, [0xd0, 0x00]);
    cpu.regs.z = false;
    expect(cpu.step()).toBe(3);
    expect(cpu.regs.pc).toBe(0x0500);
  });

  it('offset &FE branches to itself: the classic "wait here forever"', () => {
    const cpu = cpuAt(0x0400, [0xd0, 0xfe]);
    cpu.regs.z = false;
    cpu.step();
    expect(cpu.regs.pc).toBe(0x0400);
  });

  it('the furthest reaches are +127 (&7F) and −128 (&80) from the next instruction', () => {
    const forward = cpuAt(0x0400, [0xd0, 0x7f]);
    forward.step();
    expect(hex16(forward.regs.pc)).toBe(hex16(0x0402 + 127));
    const back = cpuAt(0x0400, [0xd0, 0x80]);
    expect(back.step()).toBe(4); // &0382 is in page &03
    expect(hex16(back.regs.pc)).toBe(hex16(0x0402 - 128));
  });

  it('wraps round the top of memory: BCS at &FFF0 forward &20 lands on &0012', () => {
    const cpu = cpuAt(0xfff0, [0xb0, 0x20]);
    cpu.regs.c = true;
    expect(cpu.step()).toBe(4);
    expect(cpu.regs.pc).toBe(0x0012);
  });
});

describe('a backwards branch makes a loop', () => {
  it('LDX #5; loop: DEX; BNE loop runs DEX 5 times, in 2 + 5×2 + 4×3 + 2 = 26 cycles', () => {
    // &0400 A2 05   LDX #5
    // &0402 CA      DEX
    // &0403 D0 FD   BNE &0402
    const cpu = cpuAt(0x0400, [0xa2, 0x05, 0xca, 0xd0, 0xfd]);
    let cycles = 0;
    let dexes = 0;
    while (cpu.regs.pc !== 0x0405) {
      if (cpu.regs.pc === 0x0402) dexes++;
      cycles += cpu.step();
    }
    expect({ dexes, x: cpu.regs.x, cycles }).toEqual({ dexes: 5, x: 0, cycles: 26 });
  });
});
