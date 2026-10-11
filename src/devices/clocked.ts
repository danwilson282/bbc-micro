// A device that moves forward in time as the CPU runs (BUILD-PLAN §3).
//
// The CPU runs a whole instruction and says how many cycles it took; then
// whoever owns the devices ticks each one by that many. Cycles are always
// the CPU's (2 MHz): a device on the 1 MHz bus, like the 6522, divides them
// itself.

export interface Clocked {
  /** Moves the device on by this many 2 MHz CPU cycles. */
  tick(cpuCycles: number): void;
}
