import { P_B, P_C, P_D, P_I, P_N, P_UNUSED, P_V, P_Z, packP, setNZ, unpackP, type StatusFlags } from './flags';

function clear(): StatusFlags {
  return { n: false, v: false, d: false, i: false, z: false, c: false };
}

describe('P register bit masks', () => {
  it('match the MCS6500 layout N V - B D I Z C from bit 7 down to bit 0', () => {
    expect([P_N, P_V, P_UNUSED, P_B, P_D, P_I, P_Z, P_C]).toEqual([
      0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01,
    ]);
  });
});

describe('packP', () => {
  it('always sets bit 5, which has no flip-flop and reads back as 1', () => {
    expect(packP(clear(), false)).toBe(0x20);
  });

  it('puts B in bit 4 only when the caller asks (PHP/BRK push 1, IRQ/NMI push 0)', () => {
    expect(packP(clear(), true)).toBe(0x30);
    expect(packP(clear(), false) & P_B).toBe(0);
  });

  it.each([
    ['n', P_N],
    ['v', P_V],
    ['d', P_D],
    ['i', P_I],
    ['z', P_Z],
    ['c', P_C],
  ] as const)('puts flag %s in its own bit (&%s)', (name, mask) => {
    const flags = clear();
    flags[name] = true;
    expect(packP(flags, false)).toBe(P_UNUSED | mask);
  });

  it('gives &24 for the state after reset (only I set)', () => {
    expect(packP({ ...clear(), i: true }, false)).toBe(0x24);
  });
});

describe('unpackP', () => {
  it('sets every real flag from &FF and has nowhere to put B or bit 5', () => {
    const flags = clear();
    unpackP(flags, 0xff);
    expect(flags).toEqual({ n: true, v: true, d: true, i: true, z: true, c: true });
  });

  it('clears every real flag from &30 (only B and bit 5 set)', () => {
    const flags = { n: true, v: true, d: true, i: true, z: true, c: true };
    unpackP(flags, 0x30);
    expect(flags).toEqual(clear());
  });

  it('masks its input to a byte', () => {
    const flags = clear();
    unpackP(flags, 0x101); // only bit 0 (C) survives the mask
    expect(flags).toEqual({ ...clear(), c: true });
  });
});

describe('P round trip', () => {
  it('pack(unpack(p)) keeps N V D I Z C for all 256 bytes, drops B and forces bit 5', () => {
    const flags = clear();
    for (let p = 0; p <= 0xff; p++) {
      unpackP(flags, p);
      expect(packP(flags, false)).toBe((p & 0xcf) | P_UNUSED);
      expect(packP(flags, true)).toBe((p & 0xcf) | P_UNUSED | P_B);
    }
  });
});

describe('setNZ', () => {
  it.each([
    ['00', false, true],
    ['01', false, false],
    ['41', false, false],
    ['7F', false, false],
    ['80', true, false],
    ['FE', true, false],
    ['FF', true, false],
  ])('&%s gives N = bit 7 and Z = (value is &00): N=%s Z=%s', (hex, n, z) => {
    const value = parseInt(hex, 16);
    const flags = clear();
    setNZ(flags, value);
    expect(flags).toEqual({ ...clear(), n, z });
  });

  it('leaves V, D, I and C alone, and can clear N and Z as well as set them', () => {
    const flags: StatusFlags = { n: true, v: true, d: true, i: true, z: true, c: true };
    setNZ(flags, 0x41);
    expect(flags).toEqual({ n: false, v: true, d: true, i: true, z: false, c: true });
  });

  it('looks only at the low 8 bits, as the 8-bit data bus would', () => {
    const flags = clear();
    setNZ(flags, 0x100);
    expect(flags.z).toBe(true);
    expect(flags.n).toBe(false);
  });
});
