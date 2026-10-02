// Transfers: TAX, TAY, TXA, TYA, TSX, TXS. Copy one register into another
// (MCS6500 Programming Manual §7). A copy, not a move: the source keeps its
// value. All are implied mode, 1 byte, 2 cycles.
//
// Five of them set N and Z from the value copied, like a load. TXS sets
// nothing: S is the stack's bookkeeping, not a value to test, and code that
// restores S (LDX saved : TXS) mustn't clobber the flags it's about to branch
// on. So TXS gets its own function rather than a "skip the flags" option.
//
// S only connects to X. There's no TAS, TSA, TYS or TSY.

import type { Cpu6502 } from '../cpu6502';
import { setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';

type Register8 = 'a' | 'x' | 'y' | 's';
/** Transfers that set N and Z land in A, X or Y, never S (that's TXS). */
type FlagSettingDestination = 'a' | 'x' | 'y';

/** Builds a flag-setting transfer's execute function, once, at module load. */
function transfer(from: Register8, to: FlagSettingDestination): (cpu: Cpu6502) => number {
  return (cpu) => {
    const value = cpu.regs[from];
    cpu.regs[to] = value;
    setNZ(cpu.regs, value);
    return 0;
  };
}

/** TXS: X → S. The one transfer that sets no flags. */
function txs(cpu: Cpu6502): number {
  cpu.regs.s = cpu.regs.x;
  return 0;
}

function implied(opcode: number, mnemonic: string, execute: (cpu: Cpu6502) => number): OpcodeDefinition {
  return { opcode, mnemonic, mode: 'implied', bytes: 1, cycles: 2, execute };
}

/**
 * The 6 transfer opcodes (MCS6500 Programming Manual, Appendix B). Transfers
 * into X or Y sit among the loads (&Ax/&Bx); transfers out of X or Y sit among
 * the stores (&8x/&9x).
 */
export const TRANSFERS: readonly OpcodeDefinition[] = [
  implied(0xaa, 'TAX', transfer('a', 'x')), // A → X, sets N Z
  implied(0xa8, 'TAY', transfer('a', 'y')), // A → Y, sets N Z
  implied(0x8a, 'TXA', transfer('x', 'a')), // X → A, sets N Z
  implied(0x98, 'TYA', transfer('y', 'a')), // Y → A, sets N Z
  implied(0xba, 'TSX', transfer('s', 'x')), // S → X, sets N Z
  implied(0x9a, 'TXS', txs), //                X → S, no flags
];
