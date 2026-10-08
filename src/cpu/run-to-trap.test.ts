import { assemble } from '../asm/assembler';
import { TestBus } from '../memory/test-bus';
import { Cpu6502 } from './cpu6502';
import { runToTrap } from './run-to-trap';

/** A CPU on a flat 64K bus with source assembled into it, PC at its first byte. */
function cpuWith(source: string): Cpu6502 {
  const assembly = assemble(source);
  if (!assembly.ok) throw new Error(assembly.errors.map((e) => e.message).join('\n'));
  const bus = new TestBus();
  for (const line of assembly.lines) bus.load(line.address, line.bytes);
  const cpu = new Cpu6502(bus);
  cpu.regs.pc = assembly.entry ?? 0;
  return cpu;
}

describe('runToTrap', () => {
  test('a JMP to its own address is a trap: PC stops moving, and the trap instruction is counted', () => {
    const cpu = cpuWith(`
        *= &0400
        LDA #1          ; 2 cycles
        NOP             ; 2 cycles
done:   JMP done        ; 3 cycles, PC back to &0403
`);
    const result = runToTrap(cpu, 1000);
    expect(result).toEqual({ kind: 'trap', pc: 0x0403, cycles: 7, instructions: 3 });
  });

  test('a taken branch with offset &FE (-2) lands back on itself, so it traps too', () => {
    const cpu = cpuWith(`
        *= &0400
        LDA #0          ; Z=1
here:   BEQ here        ; F0 FE: taken, 3 cycles
`);
    const result = runToTrap(cpu, 1000);
    expect(result).toMatchObject({ kind: 'trap', pc: 0x0402, instructions: 2 });
  });

  test('a branch that is not taken falls through: not a trap', () => {
    const cpu = cpuWith(`
        *= &0400
        LDA #1          ; Z=0
here:   BEQ here        ; not taken
done:   JMP done
`);
    expect(runToTrap(cpu, 1000)).toMatchObject({ kind: 'trap', pc: 0x0404 });
  });

  test('a loop longer than one instruction is not a trap: it runs to the cycle limit', () => {
    const cpu = cpuWith(`
        *= &0400
top:    NOP             ; 2 cycles
        JMP top         ; 3 cycles
`);
    const result = runToTrap(cpu, 100);
    // Stops at the first step boundary at or past 100 cycles: 20 laps of 5.
    expect(result).toEqual({ kind: 'limit', pc: 0x0400, cycles: 100, instructions: 40 });
  });

  test('cycles and instructions count from the call, not from power-on', () => {
    const cpu = cpuWith(`
        *= &0400
done:   JMP done
`);
    cpu.cycles = 1_000_000;
    expect(runToTrap(cpu, 10)).toEqual({ kind: 'trap', pc: 0x0400, cycles: 3, instructions: 1 });
    expect(cpu.cycles).toBe(1_000_003);
  });

  test('uses the step function it is given, so a planted bug changes the outcome', () => {
    const cpu = cpuWith(`
        *= &0400
        LDA #0
        BNE fail        ; Z=1, so not taken...
done:   JMP done
fail:   JMP fail
`);
    // ...unless LDA's Z is broken.
    const result = runToTrap(cpu, 1000, (c) => {
      const cycles = c.step();
      c.regs.z = false;
      return cycles;
    });
    expect(result).toMatchObject({ kind: 'trap', pc: 0x0407 });
  });
});
