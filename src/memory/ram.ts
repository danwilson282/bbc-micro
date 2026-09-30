// A block of RAM of 2^n bytes.
//
// A memory chip with 2^n bytes has only n address lines. Any higher lines
// aren't connected to it, so if the decoder selects it over a wider range the
// same bytes repeat ("mirror"). We model that with one AND: offset & (size - 1).
// The Model B's 32K (&8000 bytes) needs 15 lines, A0-A14.

export class Ram {
  readonly size: number;
  private readonly bytes: Uint8Array;
  private readonly mask: number;

  /** size must be a power of two from 1 to 64K (&10000); anything else throws RangeError. */
  constructor(size: number) {
    const isPowerOfTwo = Number.isInteger(size) && size > 0 && (size & (size - 1)) === 0;
    if (!isPowerOfTwo || size > 0x10000) {
      throw new RangeError(`RAM size must be a power of two up to 65536, got ${String(size)}`);
    }
    this.size = size;
    this.mask = size - 1;
    // Zero-filled. Real DRAM powers up holding junk, but determinism matters more here.
    this.bytes = new Uint8Array(size);
  }

  /** Returns the byte at offset, ignoring address lines above the chip's size. */
  read(offset: number): number {
    return this.bytes[offset & this.mask] ?? 0x00;
  }

  /** Stores the low 8 bits of value at offset, ignoring address lines above the chip's size. */
  write(offset: number, value: number): void {
    this.bytes[offset & this.mask] = value & 0xff;
  }

  /** Copies bytes in order from offset, wrapping past the end of the chip. For tests and demos. */
  load(offset: number, bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.write(offset + i, bytes[i] ?? 0x00);
  }
}
