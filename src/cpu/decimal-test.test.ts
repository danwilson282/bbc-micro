import { assemble } from '../asm/assembler';
import type { Cpu6502 } from './cpu6502';
import { OPCODES } from './opcodes';
import type { StepFunction } from './singlestep';
import {
  ALL_FLAGS,
  A_AND_C_ONLY,
  DECIMAL_TEST_START,
  DECIMAL_TEST_ZP,
  decimalTestSource,
  runDecimalTest,
} from './decimal-test';

/** Runs one real step, then lets `after` break something if the opcode was one of `opcodes`. */
function plant(opcodes: readonly number[], after: (cpu: Cpu6502) => void): StepFunction {
  return (cpu) => {
    const opcode = cpu.bus.read(cpu.regs.pc);
    const cycles = cpu.step();
    if (opcodes.includes(opcode)) after(cpu);
    return cycles;
  };
}

/** Every ADC and SBC opcode, from the CPU's own table. */
function opcodesOf(mnemonic: string): number[] {
  return OPCODES.flatMap((entry, opcode) => (entry?.mnemonic === mnemonic ? [opcode] : []));
}
const ADC = opcodesOf('ADC');
const SBC = opcodesOf('SBC');

describe("Bruce Clark's decimal test: the program", () => {
  test('assembles with our Stage 08 assembler, starting at &0200 with LDY #1', () => {
    const assembly = assemble(decimalTestSource(ALL_FLAGS));
    if (!assembly.ok) throw new Error(assembly.errors.map((e) => e.message).join('\n'));
    expect(assembly.entry).toBe(DECIMAL_TEST_START);
    expect(assembly.lines[0]?.bytes).toEqual([0xa0, 0x01]);
    expect(assembly.symbols.get('N2H')).toBe(DECIMAL_TEST_ZP.N2H);
    // ADC N2H,X is zero page,X (&75), as in Clark's listing.
    expect(assembly.lines.some((line) => line.bytes[0] === 0x75 && line.bytes[1] === 0x0f)).toBe(true);
  });

  test('the flag checks are switched by plain if: 4 bytes of AND #mask per checked flag', () => {
    const all = decimalTestSource(ALL_FLAGS);
    const none = decimalTestSource(A_AND_C_ONLY);
    expect(all).toMatch(/AND #&80/);
    expect(all).toMatch(/AND #&40/);
    expect(all).toMatch(/AND #&02/);
    expect(none).not.toMatch(/AND #&80|AND #&40|AND #&02/);
    expect(none).toMatch(/AND #&01/); // C is always checked
  });
});

describe("Bruce Clark's decimal test: our CPU", () => {
  test('checking N, V and Z costs exactly 12 instructions and 30 cycles per COMPARE, 262,144 times', () => {
    // Worked out by hand, not measured: each passing check is LDA zp (3) + EOR zp (3)
    // + AND # (2) + BNE not taken (2) = 4 instructions, 10 cycles; 3 checks per COMPARE,
    // and COMPARE runs twice for each of 2 × 256 × 256 cases.
    const all = runDecimalTest(ALL_FLAGS).trap;
    const ac = runDecimalTest(A_AND_C_ONLY).trap;
    const compares = 2 * 2 * 256 * 256;
    expect(all.instructions - ac.instructions).toBe(compares * 12);
    expect(all.cycles - ac.cycles).toBe(compares * 30);
  }, 60_000);

  test('passes with every flag checked (NMOS N, V and Z) across all 262,144 ADCs and SBCs', () => {
    const result = runDecimalTest(ALL_FLAGS);
    expect(result.trap.kind).toBe('trap');
    expect(result.error).toBe(0);
    expect(result.passed).toBe(true);
    // Measured with our core (which matches SingleStepTests' cycle counts), so
    // these pin it against future changes; they don't come from elsewhere.
    expect(result.trap.instructions).toBe(17_609_916);
    expect(result.trap.cycles).toBe(53_953_828);
  }, 60_000);

  test('a 65C02-style Z (from the decimal result) fails with all flags checked: ADC, &99 + &00 + carry', () => {
    const z65c02 = plant(ADC, (cpu) => {
      if (cpu.regs.d) cpu.regs.z = cpu.regs.a === 0;
    });
    const result = runDecimalTest(ALL_FLAGS, z65c02);
    expect(result).toMatchObject({ passed: false, error: 1, n1: 0x99, n2: 0x00, carryIn: true });
    expect(result.actualA).toBe(0x00);
    expect(result.actualP & 0x02).toBe(0x02); // Z = 1 where the NMOS chip gives 0
  }, 60_000);

  test('...but the same bug passes when only A and C are checked, as in Dormann\'s default', () => {
    const z65c02 = plant(ADC, (cpu) => {
      if (cpu.regs.d) cpu.regs.z = cpu.regs.a === 0;
    });
    expect(runDecimalTest(A_AND_C_ONLY, z65c02).passed).toBe(true);
  }, 60_000);

  test('an SBC that skips the decimal fix-up is caught as error 2 at the first borrow', () => {
    const binarySbc = plant(SBC, (cpu) => {
      if (cpu.regs.d) cpu.regs.a = (cpu.bus.read(DECIMAL_TEST_ZP.N1) - cpu.bus.read(DECIMAL_TEST_ZP.N2) - (cpu.regs.y === 1 ? 0 : 1)) & 0xff;
    });
    const result = runDecimalTest(A_AND_C_ONLY, binarySbc);
    expect(result).toMatchObject({ passed: false, error: 2 });
    expect(result.actualA).not.toBe(result.predictedA);
  });
});
