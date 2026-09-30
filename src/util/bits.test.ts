import {
  bcdToBinary,
  binaryToBcd,
  bit,
  hex16,
  hex8,
  hi,
  isValidBcd,
  lo,
  setBit,
  toSigned8,
  word,
} from './bits';

describe('hex8', () => {
  it('formats a byte as two upper-case hex digits', () => {
    expect(hex8(0x00)).toBe('00');
    expect(hex8(0x0d)).toBe('0D');
    expect(hex8(0x7f)).toBe('7F');
    expect(hex8(0x80)).toBe('80');
    expect(hex8(0xc8)).toBe('C8');
    expect(hex8(0xff)).toBe('FF');
  });

  it('round-trips every byte value &00-&FF', () => {
    for (let v = 0; v <= 0xff; v++) {
      const text = hex8(v);
      expect(text).toHaveLength(2);
      expect(parseInt(text, 16)).toBe(v);
    }
  });

  it('wraps like an 8-bit register: &FF + 1 formats as 00, and -1 as FF', () => {
    expect(hex8(0xff + 1)).toBe('00');
    expect(hex8(-1)).toBe('FF');
    expect(hex8(0x1c8)).toBe('C8');
  });
});

describe('hex16', () => {
  it('formats a word as four upper-case hex digits', () => {
    expect(hex16(0x0000)).toBe('0000');
    expect(hex16(0x0d00)).toBe('0D00');
    expect(hex16(0xd9cd)).toBe('D9CD');
    expect(hex16(0xffff)).toBe('FFFF');
  });

  it('wraps like the 16-bit address bus: &FFFF + 1 formats as 0000', () => {
    expect(hex16(0xffff + 1)).toBe('0000');
    expect(hex16(-1)).toBe('FFFF');
  });
});

describe('toSigned8 (two\'s complement)', () => {
  it('reads the edge bytes as the 6502 would for a branch offset', () => {
    expect(toSigned8(0x00)).toBe(0);
    expect(toSigned8(0x01)).toBe(1);
    expect(toSigned8(0x7f)).toBe(127);
    expect(toSigned8(0x80)).toBe(-128);
    expect(toSigned8(0xfb)).toBe(-5);
    expect(toSigned8(0xff)).toBe(-1);
  });

  it('is negative exactly when bit 7 (the N flag bit) is set, for every byte', () => {
    for (let v = 0; v <= 0xff; v++) {
      const signed = toSigned8(v);
      expect(signed < 0).toBe(bit(v, 7));
      expect(signed).toBeGreaterThanOrEqual(-128);
      expect(signed).toBeLessThanOrEqual(127);
      // Masking the signed value recovers the original bits.
      expect(signed & 0xff).toBe(v);
    }
  });

  it('masks its input to 8 bits first', () => {
    expect(toSigned8(0x1ff)).toBe(-1);
    expect(toSigned8(0x100)).toBe(0);
  });
});

describe('lo / hi / word (little-endian words)', () => {
  it('splits the MOS 1.20 reset vector &D9CD into lo &CD and hi &D9', () => {
    expect(lo(0xd9cd)).toBe(0xcd);
    expect(hi(0xd9cd)).toBe(0xd9);
  });

  it('builds a word from bytes in memory order: CD D9 at &FFFC is &D9CD', () => {
    expect(word(0xcd, 0xd9)).toBe(0xd9cd);
    expect(word(0x00, 0x0d)).toBe(0x0d00); // NMI vector bytes at &FFFA
    expect(word(0x1c, 0xdc)).toBe(0xdc1c); // IRQ vector bytes at &FFFE
  });

  it('round-trips every word &0000-&FFFF through lo/hi/word', () => {
    for (let w = 0; w <= 0xffff; w++) {
      const l = lo(w);
      const h = hi(w);
      if (word(l, h) !== w) {
        throw new Error(`round-trip failed for &${hex16(w)}`);
      }
    }
  });

  it('masks each byte, so an out-of-range byte cannot leak into the other half', () => {
    expect(word(0x1cd, 0xd9)).toBe(0xd9cd);
    expect(word(0xcd, 0x1d9)).toBe(0xd9cd);
    expect(hi(0x1d9cd)).toBe(0xd9);
    expect(lo(-1)).toBe(0xff);
  });
});

describe('BCD', () => {
  it('accepts exactly the 100 bytes whose nibbles are both 0-9', () => {
    let valid = 0;
    for (let v = 0; v <= 0xff; v++) {
      const expected = (v >> 4) <= 9 && (v & 0x0f) <= 9;
      expect(isValidBcd(v)).toBe(expected);
      if (expected) valid++;
    }
    expect(valid).toBe(100);
  });

  it('encodes 42 as &42 and decodes &42 as 42', () => {
    expect(binaryToBcd(42)).toBe(0x42);
    expect(bcdToBinary(0x42)).toBe(42);
  });

  it('round-trips every valid BCD value 0-99', () => {
    for (let n = 0; n <= 99; n++) {
      const encoded = binaryToBcd(n);
      expect(isValidBcd(encoded)).toBe(true);
      // The hex digits of a BCD byte read as the decimal number.
      expect(hex8(encoded)).toBe(String(n).padStart(2, '0'));
      expect(bcdToBinary(encoded)).toBe(n);
    }
  });

  it('refuses bytes with a nibble above 9, such as &3A and &C8', () => {
    expect(() => bcdToBinary(0x3a)).toThrow(RangeError);
    expect(() => bcdToBinary(0xc8)).toThrow(RangeError);
    expect(() => bcdToBinary(0xff)).toThrow(RangeError);
  });

  it('refuses to encode numbers that do not fit in two BCD digits', () => {
    expect(() => binaryToBcd(100)).toThrow(RangeError);
    expect(() => binaryToBcd(200)).toThrow(RangeError);
    expect(() => binaryToBcd(-1)).toThrow(RangeError);
    expect(() => binaryToBcd(4.5)).toThrow(RangeError);
  });
});

describe('bit / setBit', () => {
  it('reads flag bits out of a status byte: P=&24 has I (bit 2) set and C (bit 0) clear', () => {
    expect(bit(0x24, 2)).toBe(true);
    expect(bit(0x24, 5)).toBe(true);
    expect(bit(0x24, 0)).toBe(false);
    expect(bit(0x24, 7)).toBe(false);
  });

  it('sets and clears single bits without disturbing the others', () => {
    expect(setBit(0x24, 0, true)).toBe(0x25);
    expect(setBit(0x24, 2, false)).toBe(0x20);
    expect(setBit(0x24, 2, true)).toBe(0x24);
    expect(setBit(0xff, 7, false)).toBe(0x7f);
    expect(setBit(0x00, 15, true)).toBe(0x8000);
  });

  it('agrees with setBit for every byte and bit position', () => {
    for (let v = 0; v <= 0xff; v++) {
      for (let n = 0; n <= 7; n++) {
        expect(bit(setBit(v, n, true), n)).toBe(true);
        expect(bit(setBit(v, n, false), n)).toBe(false);
      }
    }
  });
});
