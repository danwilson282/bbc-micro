// Stores: STA, STX, STY. Copy a register into memory. No flags change: a
// store doesn't make a new value, it only puts one somewhere (MCS6500
// Programming Manual §2).
//
// The mirror image of loads.ts, with one timing difference. A load's indexed
// read is optimistic: it reads before fixing the high byte, and only pays +1
// if the add carried. A store can't do that, because writing to the
// not-yet-fixed address would destroy the wrong byte. So a store always spends
// the fix-up cycle, carry or not, and that cycle is already in its base count:
// STA &nnnn,X is 5 cycles, never 4 or 6.

import { EFFECTIVE_ADDRESS, type AddressedMode } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import type { OpcodeDefinition } from '../opcodes';

type StoreRegister = 'a' | 'x' | 'y';

/**
 * Builds a store's execute function, once, at module load. The EA function
 * still sets cpu.pageCrossed; a store just never looks at it.
 */
function store(register: StoreRegister, mode: AddressedMode): (cpu: Cpu6502) => number {
  const effectiveAddress = EFFECTIVE_ADDRESS[mode];
  return (cpu) => {
    cpu.bus.write(effectiveAddress(cpu), cpu.regs[register]);
    return 0;
  };
}

function sta(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'STA', mode, bytes, cycles, execute: store('a', mode) };
}

function stx(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'STX', mode, bytes, cycles, execute: store('x', mode) };
}

function sty(opcode: number, mode: AddressedMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'STY', mode, bytes, cycles, execute: store('y', mode) };
}

/**
 * The 13 store opcodes (MCS6500 Programming Manual, Appendix B). No immediate
 * mode: "store into the operand byte" would overwrite the program.
 */
export const STORES: readonly OpcodeDefinition[] = [
  //  opcode  mode                bytes cycles
  sta(0x85, 'zeroPage', 2, 3), //         STA &nn
  sta(0x95, 'zeroPageX', 2, 4), //        STA &nn,X
  sta(0x8d, 'absolute', 3, 4), //         STA &nnnn
  sta(0x9d, 'absoluteX', 3, 5), //        STA &nnnn,X   always 5 (LDA is 4+)
  sta(0x99, 'absoluteY', 3, 5), //        STA &nnnn,Y   always 5 (LDA is 4+)
  sta(0x81, 'indexedIndirectX', 2, 6), // STA (&nn,X)
  sta(0x91, 'indirectIndexedY', 2, 6), // STA (&nn),Y   always 6 (LDA is 5+)

  // STX indexes by Y, and only in zero page: there's no STX &nnnn,Y.
  stx(0x86, 'zeroPage', 2, 3), //         STX &nn
  stx(0x96, 'zeroPageY', 2, 4), //        STX &nn,Y
  stx(0x8e, 'absolute', 3, 4), //         STX &nnnn

  // STY indexes by X, and only in zero page: there's no STY &nnnn,X.
  sty(0x84, 'zeroPage', 2, 3), //         STY &nn
  sty(0x94, 'zeroPageX', 2, 4), //        STY &nn,X
  sty(0x8c, 'absolute', 3, 4), //         STY &nnnn
];
