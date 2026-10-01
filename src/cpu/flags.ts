// The processor status register P, and converting it to and from a byte.
//
//   bit:   7   6   5   4   3   2   1   0
//          N   V   -   B   D   I   Z   C
//
// Inside the chip only six of these bits are real flip-flops: N V D I Z C.
// Bit 5 and B have no storage at all. They only exist in the copy of P that
// PHP, BRK and interrupts push onto the stack: bit 5 is always pushed as 1, and
// B is pushed as 1 by PHP/BRK and 0 by IRQ/NMI (Stages 15 and 17).
//
// So the CPU keeps six booleans (fast to set on every instruction) and packs
// them into a byte only when P goes onto the stack or into the workbench.

/** P bit masks (MCS6500 Programming Manual, processor status register diagram). */
export const P_C = 0x01; // Carry
export const P_Z = 0x02; // Zero
export const P_I = 0x04; // IRQ disable
export const P_D = 0x08; // Decimal mode
export const P_B = 0x10; // Break: only in the pushed copy
export const P_UNUSED = 0x20; // No flip-flop: always pushed as 1
export const P_V = 0x40; // oVerflow
export const P_N = 0x80; // Negative

/** The six status bits the 6502 actually stores. */
export interface StatusFlags {
  n: boolean;
  v: boolean;
  d: boolean;
  i: boolean;
  z: boolean;
  c: boolean;
}

/**
 * Builds the byte the 6502 would push for P. Bit 5 is always 1. B is set only
 * if b is true: PHP and BRK pass true, IRQ and NMI pass false.
 * e.g. only I set: packP(flags, false) = &24, packP(flags, true) = &34.
 */
export function packP(flags: Readonly<StatusFlags>, b: boolean): number {
  return (
    (flags.n ? P_N : 0) |
    (flags.v ? P_V : 0) |
    P_UNUSED |
    (b ? P_B : 0) |
    (flags.d ? P_D : 0) |
    (flags.i ? P_I : 0) |
    (flags.z ? P_Z : 0) |
    (flags.c ? P_C : 0)
  );
}

/**
 * Loads the six real flags from a byte (as PLP and RTI will). Bits 4 (B) and
 * 5 are ignored because the chip has nowhere to store them. Writes into flags
 * rather than returning a new object, so it is safe on the hot path.
 */
export function unpackP(flags: StatusFlags, p: number): void {
  const byte = p & 0xff;
  flags.n = (byte & P_N) !== 0;
  flags.v = (byte & P_V) !== 0;
  flags.d = (byte & P_D) !== 0;
  flags.i = (byte & P_I) !== 0;
  flags.z = (byte & P_Z) !== 0;
  flags.c = (byte & P_C) !== 0;
}
