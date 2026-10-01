// The opcode table: what each of the 256 possible opcode bytes means.
//
// The real 6502 decodes opcodes with a PLA (a grid of pattern-matching lines).
// In software the simplest, fastest decoder is an array indexed by the opcode
// byte. step() does OPCODES[opcode] and runs the entry's execute().
//
// A slot left undefined means "not implemented yet"; step() turns that into an
// UnimplementedOpcodeError. The table fills in stage by stage until Stage 17
// completes the 151 documented opcodes.

import type { Cpu6502 } from './cpu6502';

/** How an instruction finds its operand. Stage 05 adds the other 12 modes. */
export type AddressingMode = 'implied';

export interface Opcode {
  readonly mnemonic: string;
  readonly mode: AddressingMode;
  /** Instruction length including the opcode byte. */
  readonly bytes: number;
  /** Base cycle count (MCS6500 Programming Manual, Appendix A). */
  readonly cycles: number;
  /**
   * Does the work, after step() has fetched the opcode and advanced PC past
   * it. Returns any EXTRA cycles (page crossings, taken branches); 0 if none.
   */
  readonly execute: (cpu: Cpu6502) => number;
}

/** NOP: do nothing. (The real chip's second cycle is a discarded read of the next byte.) */
function nop(): number {
  return 0;
}

function buildTable(): readonly (Opcode | undefined)[] {
  const table = new Array<Opcode | undefined>(256).fill(undefined);
  table[0xea] = { mnemonic: 'NOP', mode: 'implied', bytes: 1, cycles: 2, execute: nop };
  return table;
}

/** Indexed by opcode byte, &00-&FF. Built once at module load, never per instruction. */
export const OPCODES: readonly (Opcode | undefined)[] = buildTable();
