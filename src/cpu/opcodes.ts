// The opcode table: what each of the 256 possible opcode bytes means.
//
// The real 6502 decodes opcodes with a PLA (a grid of pattern-matching lines).
// In software the simplest, fastest decoder is an array indexed by the opcode
// byte. step() does OPCODES[opcode] and runs the entry's execute().
//
// A slot left undefined means "not implemented yet"; step() turns that into an
// UnimplementedOpcodeError. The table fills in stage by stage until Stage 17
// completes the 151 documented opcodes. Each instruction group lives in its
// own file under instructions/ as a list of rows; buildTable() collects them.

import type { AddressingMode } from './addressing';
import type { Cpu6502 } from './cpu6502';
import { ARITHMETIC } from './instructions/arithmetic';
import { FLAG_OPS } from './instructions/flag-ops';
import { INC_DEC } from './instructions/inc-dec';
import { LOADS } from './instructions/loads';
import { LOGIC } from './instructions/logic';
import { STORES } from './instructions/stores';
import { TRANSFERS } from './instructions/transfers';
import { hex8 } from '../util/bits';

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

/** One row of an opcode table: which byte it lives at, and what it means. */
export interface OpcodeDefinition extends Opcode {
  /** The opcode byte, &00-&FF. */
  readonly opcode: number;
}

/** NOP: do nothing. (The real chip's second cycle is a discarded read of the next byte.) */
function nop(): number {
  return 0;
}

const NOP: OpcodeDefinition = { opcode: 0xea, mnemonic: 'NOP', mode: 'implied', bytes: 1, cycles: 2, execute: nop };

/** Every implemented instruction group, in stage order. */
const GROUPS: readonly (readonly OpcodeDefinition[])[] = [[NOP], LOADS, STORES, TRANSFERS, INC_DEC, ARITHMETIC, FLAG_OPS, LOGIC];

/** Puts each row in its slot. Two rows claiming one opcode is a bug in the tables, so it throws. */
export function buildTable(groups: readonly (readonly OpcodeDefinition[])[]): readonly (Opcode | undefined)[] {
  const table = new Array<Opcode | undefined>(256).fill(undefined);
  for (const group of groups) {
    for (const row of group) {
      const code = row.opcode & 0xff;
      const existing = table[code];
      if (existing !== undefined) {
        throw new Error(`opcode &${hex8(code)} defined twice: ${existing.mnemonic} and ${row.mnemonic}`);
      }
      table[code] = row;
    }
  }
  return table;
}

/** Indexed by opcode byte, &00-&FF. Built once at module load, never per instruction. */
export const OPCODES: readonly (Opcode | undefined)[] = buildTable(GROUPS);
