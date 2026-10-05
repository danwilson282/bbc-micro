// Read-modify-write (RMW): the bus pattern INC, DEC, ASL, LSR, ROL and ROR
// share when they work on memory. Read the byte, push it through the ALU,
// write it back. All six sit in the cc = %10 group of the opcode map, so they
// have the same four modes and the same cycle counts.
//
// The NMOS 6502 can't leave the bus idle while the ALU works, so it writes the
// old value back first, then the new one: two writes to the same address. RAM
// doesn't care; a device register on SHEILA sees both. We model that dummy
// write (MCS6500 Hardware Manual, Appendix A; 6502.org cycle-by-cycle notes).

import { EFFECTIVE_ADDRESS } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import type { Registers } from '../registers';

/** The four modes the memory RMW instructions have. */
export type RmwMode = 'zeroPage' | 'zeroPageX' | 'absolute' | 'absoluteX';

/**
 * Builds an RMW execute function, once, at module load. modify is the ALU
 * half: it takes the old byte, sets flags, and returns the new byte.
 *
 * Like a store, abs,X always pays the fix-up cycle (it's in the base count of
 * 7), so pageCrossed is ignored and no extra cycles return. The indexed modes'
 * dummy read isn't modelled (PROGRESS.md parking lot).
 */
export function readModifyWrite(mode: RmwMode, modify: (regs: Registers, value: number) => number): (cpu: Cpu6502) => number {
  const effectiveAddress = EFFECTIVE_ADDRESS[mode];
  return (cpu) => {
    const ea = effectiveAddress(cpu);
    const old = cpu.bus.read(ea);
    cpu.bus.write(ea, old);
    cpu.bus.write(ea, modify(cpu.regs, old) & 0xff);
    return 0;
  };
}
