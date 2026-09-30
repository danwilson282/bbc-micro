// A flat 64K bus: every address from &0000 to &FFFF is RAM.
//
// There's no address decoding, no ROM and no I/O. It's the CPU's playground in
// Part 2, where we only care that instructions read and write the right
// addresses. Stage 21 replaces it with the real BBC memory map, behind the same
// Bus interface.

import type { Bus } from './bus';
import { Ram } from './ram';

export class TestBus implements Bus {
  private readonly ram = new Ram(0x10000);

  /** Read cycle: the byte at address & 0xffff (16 address lines). */
  read(address: number): number {
    return this.ram.read(address & 0xffff);
  }

  /** Write cycle: value & 0xff (8 data lines) to address & 0xffff. */
  write(address: number, value: number): void {
    this.ram.write(address & 0xffff, value & 0xff);
  }

  /** Writes bytes in order from address, wrapping from &FFFF to &0000. For tests and demos. */
  load(address: number, bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.write(address + i, bytes[i] ?? 0x00);
  }
}
