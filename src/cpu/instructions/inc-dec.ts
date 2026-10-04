// Increment & decrement: INX, INY, DEX, DEY on the index registers, and INC,
// DEC on a byte in memory. Add or subtract 1, wrap to 8 bits, set N and Z.
// C and V are never touched: &FF + 1 = &00 sets Z, not carry (MCS6500
// Programming Manual, chapters 7 and 10). That's deliberate: counters live
// inside loops whose arithmetic needs C to survive from one pass to the next.
//
// INC and DEC are the first read-modify-write (RMW) instructions. The NMOS
// 6502 can't leave the bus idle while the ALU works, so it writes the old
// value back first, then the new one: two writes to the same address. RAM
// doesn't care; a device register on SHEILA sees both. We model that dummy
// write (MCS6500 Hardware Manual, Appendix A; 6502.org cycle-by-cycle notes).

import { EFFECTIVE_ADDRESS } from '../addressing';
import type { Cpu6502 } from '../cpu6502';
import { setNZ } from '../flags';
import type { OpcodeDefinition } from '../opcodes';

type IndexRegister = 'x' | 'y';
/** +1 for INC/INX/INY, -1 for DEC/DEX/DEY. A literal union, so a 2 won't compile. */
type Delta = 1 | -1;
/** The four modes the memory RMW instructions have. (The Stage 13 shifts have the same four.) */
type RmwMode = 'zeroPage' | 'zeroPageX' | 'absolute' | 'absoluteX';

/** INX, INY, DEX, DEY: built once at module load. (x + delta) & 0xff turns -1 into &FF. */
function stepRegister(register: IndexRegister, delta: Delta): (cpu: Cpu6502) => number {
  return (cpu) => {
    const value = (cpu.regs[register] + delta) & 0xff;
    cpu.regs[register] = value;
    setNZ(cpu.regs, value);
    return 0;
  };
}

/**
 * INC and DEC: read, write the old value back (the NMOS dummy write), write
 * the new value. Like a store, abs,X always pays the fix-up cycle (it's in
 * the base count of 7), so pageCrossed is ignored and no extra cycles return.
 * The indexed modes' dummy read isn't modelled (PROGRESS.md parking lot).
 */
function readModifyWrite(mode: RmwMode, modify: (cpu: Cpu6502, value: number) => number): (cpu: Cpu6502) => number {
  const effectiveAddress = EFFECTIVE_ADDRESS[mode];
  return (cpu) => {
    const ea = effectiveAddress(cpu);
    const old = cpu.bus.read(ea);
    cpu.bus.write(ea, old);
    cpu.bus.write(ea, modify(cpu, old) & 0xff);
    return 0;
  };
}

/** The ALU half of INC or DEC: the new value, with N and Z set from it. */
function incDec(delta: Delta): (cpu: Cpu6502, value: number) => number {
  return (cpu, value) => {
    const result = (value + delta) & 0xff;
    setNZ(cpu.regs, result);
    return result;
  };
}

const INCREMENT = incDec(1);
const DECREMENT = incDec(-1);

function implied(opcode: number, mnemonic: string, execute: (cpu: Cpu6502) => number): OpcodeDefinition {
  return { opcode, mnemonic, mode: 'implied', bytes: 1, cycles: 2, execute };
}

function inc(opcode: number, mode: RmwMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'INC', mode, bytes, cycles, execute: readModifyWrite(mode, INCREMENT) };
}

function dec(opcode: number, mode: RmwMode, bytes: number, cycles: number): OpcodeDefinition {
  return { opcode, mnemonic: 'DEC', mode, bytes, cycles, execute: readModifyWrite(mode, DECREMENT) };
}

/**
 * The 12 increment and decrement opcodes (MCS6500 Programming Manual,
 * Appendix B). No INC A on the NMOS 6502 (the 65C02 added it at &1A), and
 * memory is only ever indexed by X.
 */
export const INC_DEC: readonly OpcodeDefinition[] = [
  implied(0xe8, 'INX', stepRegister('x', 1)), // X + 1 → X
  implied(0xc8, 'INY', stepRegister('y', 1)), // Y + 1 → Y
  implied(0xca, 'DEX', stepRegister('x', -1)), // X - 1 → X
  implied(0x88, 'DEY', stepRegister('y', -1)), // Y - 1 → Y

  //  opcode  mode         bytes cycles
  inc(0xe6, 'zeroPage', 2, 5), //  INC &nn       read, write old, write new
  inc(0xf6, 'zeroPageX', 2, 6), // INC &nn,X
  inc(0xee, 'absolute', 3, 6), //  INC &nnnn
  inc(0xfe, 'absoluteX', 3, 7), // INC &nnnn,X   always 7, page cross or not
  dec(0xc6, 'zeroPage', 2, 5), //  DEC &nn
  dec(0xd6, 'zeroPageX', 2, 6), // DEC &nn,X
  dec(0xce, 'absolute', 3, 6), //  DEC &nnnn
  dec(0xde, 'absoluteX', 3, 7), // DEC &nnnn,X   always 7, page cross or not
];
