// A chip on the I/O bus, as the memory map sees it.
//
// A device doesn't know where it lives. The System VIA has four
// register-select pins (RS0-RS3, 6522 datasheet), so it sees a register
// number from 0 to 15, whether the CPU used &FE44 or its mirror &FE54. The
// memory map does the decoding and passes the offset. That's also why the
// User VIA can be the very same kind of object at &FE60.
//
// read() is the CPU's read and may have side effects: reading the VIA's
// T1C-L at &FE44 clears IFR bit 6. peek() is the debugger's read and must
// not. Each device decides what its side-effect-free view is.

export interface IoDevice {
  /** The CPU reads register `offset`. Returns 0..255. May have side effects. */
  read(offset: number): number;
  /** The CPU writes value & 0xff to register `offset`. */
  write(offset: number, value: number): void;
  /** What read(offset) would return now, with no side effects. For debuggers. */
  peek(offset: number): number;
}
