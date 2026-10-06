// Branches: test one flag and, if it's the way the opcode wants, move PC by a
// signed offset (MCS6500 Programming Manual, chapter 4).
//
//   bit:  7 6   5   4 3 2 1 0
//         x x   y   1 0 0 0 0      xx: %00 N, %01 V, %10 C, %11 Z
//                                  y:  branch if the flag equals y
//
// The offset (−128…+127) counts from the NEXT instruction, because PC has
// already moved past the offset byte when it's added. Cycles (Appendix A):
//   2  not taken
//   3  taken, target in the same page as the next instruction
//   4  taken, target in a different page: the high byte needs fixing up

import { addrRelative } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import type { OpcodeDefinition } from '../opcodes';

/** The four flags a branch can test. */
export type BranchFlag = 'n' | 'v' | 'c' | 'z';

/**
 * Builds a branch's execute function, once, at module load. It always
 * fetches the offset (so PC moves past it either way), then returns the
 * extra cycles: 0 if not taken, 1 if taken, 2 if taken across a page.
 */
function branch(flag: BranchFlag, when: boolean): (cpu: Cpu6502) => number {
  return (cpu) => {
    const target = addrRelative(cpu);
    if (cpu.regs[flag] !== when) return 0;
    cpu.regs.pc = target;
    return cpu.pageCrossed ? 2 : 1;
  };
}

function row(mnemonic: string, opcode: number, flag: BranchFlag, when: boolean): OpcodeDefinition {
  return { opcode, mnemonic, mode: 'relative', bytes: 2, cycles: 2, execute: branch(flag, when) };
}

/** The 8 branches, in opcode order. All relative, 2 bytes, 2 base cycles. */
export const BRANCHES: readonly OpcodeDefinition[] = [
  row('BPL', 0x10, 'n', false), // branch if plus:            N = 0
  row('BMI', 0x30, 'n', true), //  branch if minus:           N = 1
  row('BVC', 0x50, 'v', false), // branch if overflow clear:  V = 0
  row('BVS', 0x70, 'v', true), //  branch if overflow set:    V = 1
  row('BCC', 0x90, 'c', false), // branch if carry clear:     C = 0   (after CMP: less than)
  row('BCS', 0xb0, 'c', true), //  branch if carry set:       C = 1   (after CMP: greater or equal)
  row('BNE', 0xd0, 'z', false), // branch if not equal:       Z = 0
  row('BEQ', 0xf0, 'z', true), //  branch if equal:           Z = 1
];
