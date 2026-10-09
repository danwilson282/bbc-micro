import { hex16 } from '../util/bits';
import { SHEILA_SLOTS, VIA_REGISTERS, describeIoAddress, sheilaSlotIndex } from './sheila';

describe('the SHEILA slot table', () => {
  it('covers &FE00-&FEFF exactly, in order, with no gaps or overlaps', () => {
    let next = 0x00;
    for (const slot of SHEILA_SLOTS) {
      expect(slot.start).toBe(next);
      next = slot.start + slot.size;
    }
    expect(next).toBe(0x100);
  });

  it('gives every chip a power-of-two register count that fits its slot, so offset AND (count - 1) mirrors', () => {
    for (const slot of SHEILA_SLOTS) {
      const n = slot.registers.length;
      expect(n & (n - 1)).toBe(0);
      expect(slot.size % n).toBe(0);
    }
  });

  it('puts the System VIA at &FE40-&FE5F and the User VIA at &FE60-&FE7F, 16 registers each (6522)', () => {
    expect(SHEILA_SLOTS[sheilaSlotIndex(0x40)]?.id).toBe('systemVia');
    expect(SHEILA_SLOTS[sheilaSlotIndex(0x5f)]?.id).toBe('systemVia');
    expect(SHEILA_SLOTS[sheilaSlotIndex(0x60)]?.id).toBe('userVia');
    expect(VIA_REGISTERS).toHaveLength(16);
  });
});

describe('describeIoAddress', () => {
  it.each(([
    [0xfe44, 'System VIA reg 4 (T1C-L)'],
    [0xfe4e, 'System VIA reg 14 (IER)'],
    [0xfe5e, 'System VIA reg 14 (IER), mirror of &FE4E'],
    [0xfe6c, 'User VIA reg 12 (PCR)'],
    [0xfe00, 'CRTC reg 0 (address register)'],
    [0xfe01, 'CRTC reg 1 (register data)'],
    [0xfe06, 'CRTC reg 0 (address register), mirror of &FE00'],
    [0xfe21, 'Video ULA reg 1 (palette)'],
    [0xfe2d, 'Video ULA reg 1 (palette), mirror of &FE21'],
    [0xfe30, 'ROMSEL (paged ROM select)'],
    [0xfe3f, 'ROMSEL (paged ROM select), mirror of &FE30'],
    [0xfe84, '8271 FDC reg 4 (data)'],
    [0xfec1, 'ADC reg 1 (high byte)'],
    [0xfc00, 'FRED (1 MHz bus: nothing connected)'],
    [0xfdff, 'JIM (1 MHz bus: nothing connected)'],
  ] as const).map(([address, text]) => [hex16(address), address, text] as const))('names &%s', (_hex, address, text) => {
    expect(describeIoAddress(address).text).toBe(text);
  });

  it('gives the register a mirror reaches and the first address that reaches it', () => {
    const d = describeIoAddress(0xfe54);
    expect([d.page, d.slot?.id, d.register, d.canonical]).toEqual(['SHEILA', 'systemVia', 4, 0xfe44]);
  });

  it('rejects addresses outside the I/O pages', () => {
    expect(() => describeIoAddress(0xfbff)).toThrow(RangeError);
    expect(() => describeIoAddress(0xff00)).toThrow(RangeError);
  });
});
