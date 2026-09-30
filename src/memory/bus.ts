// The CPU's view of the whole machine.
//
// The 6502 has a 16-bit address bus (A0-A15), an 8-bit data bus (D0-D7) and a
// R/W line, and every clock cycle is exactly one read or one write. It has no
// separate I/O instructions: RAM, ROM and device registers are all just
// addresses (memory-mapped I/O). So from the CPU's side, everything reduces to
// these two operations.
//
// Implementations must mask: address & 0xffff, value & 0xff, and read() must
// return 0..255. A read may have side effects (reading a VIA register can clear
// an interrupt flag), which is why this is a method and not an array.

export interface Bus {
  /** Read cycle (R/W high): returns the byte, 0..255, at address & 0xffff. */
  read(address: number): number;
  /** Write cycle (R/W low): stores value & 0xff at address & 0xffff. */
  write(address: number, value: number): void;
}
