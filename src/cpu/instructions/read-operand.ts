// The shape shared by every instruction that reads one operand and hands it
// to the ALU: ADC/SBC (Stage 10), AND/ORA/EOR/BIT (Stage 12) and
// CMP/CPX/CPY (Stage 14). The bus work is LDA's; only the ALU's job differs.

import { EFFECTIVE_ADDRESS, type AddressedMode } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import type { Registers } from '../registers';

/** An ALU job: takes the operand and changes registers or flags. Writes into regs, so it's safe on the hot path. */
export type OperandAlu = (regs: Registers, value: number) => void;

/**
 * Builds an execute function, once, at module load: find the effective
 * address, read the byte there, run the ALU on it. Like LDA, a page crossing
 * costs +1 (Stage 05).
 */
export function readOperand(mode: AddressedMode, alu: OperandAlu): (cpu: Cpu6502) => number {
  const effectiveAddress = EFFECTIVE_ADDRESS[mode];
  return (cpu) => {
    alu(cpu.regs, cpu.bus.read(effectiveAddress(cpu)));
    return cpu.pageCrossed ? 1 : 0;
  };
}
