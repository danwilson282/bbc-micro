// Number helpers for an 8-bit CPU with a 16-bit address bus.
//
// JS numbers are 64-bit floats with no fixed width, so every helper here masks
// its input to the hardware width first: & 0xff for a byte (data bus D0-D7),
// & 0xffff for a word (address bus A0-A15). Masking is what makes &FF + 1
// wrap to &00 the way an 8-bit register does.
//
// Everything except the hex formatters is allocation-free, so it is safe to
// call from the CPU hot path. The formatters build strings: use them for UI
// and trace output only.

/** Formats a byte as two upper-case hex digits, e.g. 0xc8 → "C8". No prefix. */
export function hex8(value: number): string {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/** Formats a word as four upper-case hex digits, e.g. 0xd9cd → "D9CD". No prefix. */
export function hex16(value: number): string {
  return (value & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Reads a byte as a two's-complement signed number, -128..127.
 * Bit 7 is worth -128 instead of +128, so any byte >= &80 is (byte - &100).
 * e.g. a branch offset of &FB means -5.
 */
export function toSigned8(value: number): number {
  const b = value & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/** The low byte of a word: 0xd9cd → 0xcd. */
export function lo(value: number): number {
  return value & 0xff;
}

/** The high byte of a word: 0xd9cd → 0xd9. */
export function hi(value: number): number {
  return (value >> 8) & 0xff;
}

/**
 * Builds a word from two bytes, taken in 6502 memory order (low byte first).
 * The reset vector bytes CD D9 at &FFFC/&FFFD give word(0xcd, 0xd9) = 0xd9cd.
 */
export function word(low: number, high: number): number {
  return ((high & 0xff) << 8) | (low & 0xff);
}

/** True if both nibbles of the byte are decimal digits 0-9 (100 of the 256 values). */
export function isValidBcd(value: number): boolean {
  const b = value & 0xff;
  return b >> 4 <= 9 && (b & 0x0f) <= 9;
}

/**
 * Decodes a BCD byte to a number: 0x42 → 42.
 * Throws RangeError for invalid BCD (a nibble above 9), rather than guessing.
 * The NMOS 6502's behaviour on invalid BCD is a CPU quirk handled in Stage 11.
 */
export function bcdToBinary(value: number): number {
  const b = value & 0xff;
  if (!isValidBcd(b)) {
    throw new RangeError(`&${hex8(b)} is not valid BCD (each nibble must be 0-9)`);
  }
  return (b >> 4) * 10 + (b & 0x0f);
}

/** Encodes 0-99 as a BCD byte: 42 → 0x42. Throws RangeError for anything else. */
export function binaryToBcd(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new RangeError(`${String(value)} cannot be encoded as one BCD byte (0-99 only)`);
  }
  return (Math.floor(value / 10) << 4) | value % 10;
}

/** True if bit n (0 = least significant) of value is set. */
export function bit(value: number, n: number): boolean {
  return (value & (1 << n)) !== 0;
}

/** Returns value with bit n set (on = true) or cleared (on = false). n is 0-15. */
export function setBit(value: number, n: number, on: boolean): number {
  return on ? value | (1 << n) : value & ~(1 << n);
}
