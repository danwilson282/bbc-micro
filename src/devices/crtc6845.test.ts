import type { IoDevice } from '../memory/io-device';
import {
  CRTC_ADDRESS,
  CRTC_DATA,
  CRTC_R12_START_ADDRESS_HIGH,
  CRTC_R14_CURSOR_ADDRESS_HIGH,
  CRTC_R15_CURSOR_ADDRESS_LOW,
  CRTC_R16_LIGHT_PEN_HIGH,
  CRTC_REGISTER_ACCESS,
  CRTC_REGISTER_BITS,
  CRTC_REGISTER_COUNT,
  Crtc6845,
} from './crtc6845';
import { HardwareLog } from './hardware-log';

/** Rn := value, the way the MOS does it: the address register, then the data. */
function set(crtc: IoDevice, n: number, value: number): void {
  crtc.write(CRTC_ADDRESS, n);
  crtc.write(CRTC_DATA, value);
}

/** What the CPU reads back from Rn. */
function get(crtc: IoDevice, n: number): number {
  crtc.write(CRTC_ADDRESS, n);
  return crtc.read(CRTC_DATA);
}

const MODE7_R0_R11 = [0x3f, 0x28, 0x33, 0x24, 0x1e, 0x02, 0x19, 0x1b, 0x93, 0x12, 0x72, 0x13];

describe('Crtc6845 register file', () => {
  it('&FE00 picks the register and &FE01 stores into it: R0 := &3F', () => {
    const crtc = new Crtc6845();
    set(crtc, 0, 0x3f);
    expect(crtc.register(0)).toBe(0x3f);
  });

  it('keeps the MOS\'s MODE 7 table, R0-R11, exactly as written (none of it is cut by the widths)', () => {
    const crtc = new Crtc6845();
    MODE7_R0_R11.forEach((value, r) => {
      set(crtc, r, value);
    });
    expect(crtc.registers().slice(0, 12)).toEqual(MODE7_R0_R11);
    expect(crtc.registers()).toHaveLength(CRTC_REGISTER_COUNT);
  });

  it('the address register holds: two data writes in a row go to the same register', () => {
    const crtc = new Crtc6845();
    crtc.write(CRTC_ADDRESS, 12);
    crtc.write(CRTC_DATA, 0x20);
    crtc.write(CRTC_DATA, 0x28);
    expect(crtc.register(12)).toBe(0x28);
    expect(crtc.addressRegister).toBe(12);
  });

  it('the address register is 5 bits: &21 picks R1', () => {
    const crtc = new Crtc6845();
    set(crtc, 0x21, 0x50);
    expect(crtc.register(1)).toBe(0x50);
  });

  it('the one register-select line is address bit 0: &FE02/&FE03 (and &FE06/&FE07) are the same pair', () => {
    const crtc = new Crtc6845();
    crtc.write(2, 7);
    crtc.write(7, 0x1b);
    expect(crtc.register(7)).toBe(0x1b);
  });

  it('R18-R31 don\'t exist: a write there changes nothing, and a read gives &00', () => {
    const crtc = new Crtc6845();
    const before = crtc.registers();
    set(crtc, 20, 0xff);
    expect(crtc.registers()).toEqual(before);
    expect(get(crtc, 20)).toBe(0x00);
  });
});

describe('Crtc6845 register widths (bits above a register\'s width are lost on the write)', () => {
  it.each([
    [4, 'R4 vertical total, 7 bits', 0xff, 0x7f],
    [5, 'R5 vertical total adjust, 5 bits', 0xff, 0x1f],
    [6, 'R6 vertical displayed, 7 bits', 0xff, 0x7f],
    [7, 'R7 vertical sync position, 7 bits', 0xff, 0x7f],
    [9, 'R9 max scan line address, 5 bits', 0xff, 0x1f],
    [10, 'R10 cursor start, 7 bits', 0xff, 0x7f],
    [11, 'R11 cursor end, 5 bits', 0xff, 0x1f],
    [12, 'R12 start address high, 6 bits', 0xff, 0x3f],
    [14, 'R14 cursor address high, 6 bits', 0xff, 0x3f],
  ])('R%i (%s): &%s written, %s kept', (n, _name, written, kept) => {
    const crtc = new Crtc6845();
    set(crtc, n, written);
    expect(crtc.register(n)).toBe(kept);
  });

  it('R0-R3, R13 and R15 keep all 8 bits', () => {
    const crtc = new Crtc6845();
    for (const n of [0, 1, 2, 3, 13, 15]) set(crtc, n, 0xff);
    expect([0, 1, 2, 3, 13, 15].map((n) => crtc.register(n))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });

  it('the width table and the access table both have an entry for each of R0-R17', () => {
    expect(CRTC_REGISTER_BITS).toHaveLength(CRTC_REGISTER_COUNT);
    expect(CRTC_REGISTER_ACCESS).toHaveLength(CRTC_REGISTER_COUNT);
  });
});

describe('Crtc6845 read rules (6845 data sheet; Advanced User Guide)', () => {
  it('R0-R13 are write-only: each reads &00 even though it holds the MODE 7 value', () => {
    const crtc = new Crtc6845();
    MODE7_R0_R11.forEach((value, r) => {
      set(crtc, r, value);
    });
    set(crtc, 12, 0x28);
    set(crtc, 13, 0x00);
    expect(Array.from({ length: 14 }, (_, r) => get(crtc, r))).toEqual(new Array<number>(14).fill(0));
  });

  it('R14/R15, the cursor address, read back: &08 &C9 written, &08 &C9 read', () => {
    const crtc = new Crtc6845();
    set(crtc, CRTC_R14_CURSOR_ADDRESS_HIGH, 0x08);
    set(crtc, CRTC_R15_CURSOR_ADDRESS_LOW, 0xc9);
    expect([get(crtc, 14), get(crtc, 15)]).toEqual([0x08, 0xc9]);
  });

  it('R14 reads back only its 6 bits: &FF written, &3F read', () => {
    const crtc = new Crtc6845();
    set(crtc, CRTC_R14_CURSOR_ADDRESS_HIGH, 0xff);
    expect(get(crtc, 14)).toBe(0x3f);
  });

  it('R16/R17, the light pen, are read-only: a CPU write is ignored and they still read &00', () => {
    const crtc = new Crtc6845();
    set(crtc, CRTC_R16_LIGHT_PEN_HIGH, 0x12);
    set(crtc, 17, 0x34);
    expect([get(crtc, 16), get(crtc, 17)]).toEqual([0x00, 0x00]);
    expect([crtc.register(16), crtc.register(17)]).toEqual([0, 0]);
  });

  it('the address register itself is write-only: &FE00 reads &00', () => {
    const crtc = new Crtc6845();
    crtc.write(CRTC_ADDRESS, 14);
    expect(crtc.read(CRTC_ADDRESS)).toBe(0x00);
  });

  it('peek gives what read would, and a read changes nothing (no 6845 read has a side effect)', () => {
    const crtc = new Crtc6845();
    set(crtc, 15, 0xc9);
    expect(crtc.peek(CRTC_DATA)).toBe(0xc9);
    expect(crtc.read(CRTC_DATA)).toBe(0xc9);
    expect(crtc.read(CRTC_DATA)).toBe(0xc9);
    expect(crtc.addressRegister).toBe(15);
  });

  it('the access table says so: write for R0-R13, read-write for R14-R15, read for R16-R17', () => {
    expect(CRTC_REGISTER_ACCESS.slice(0, CRTC_R12_START_ADDRESS_HIGH + 2)).toEqual(new Array<string>(14).fill('write'));
    expect(CRTC_REGISTER_ACCESS.slice(14)).toEqual(['read-write', 'read-write', 'read', 'read']);
  });
});

describe('Crtc6845 and the hardware log', () => {
  it('reports each data write as (register, value written); an address write alone isn\'t one', () => {
    const log = new HardwareLog({ cycles: 0 });
    const crtc = new Crtc6845(log);
    crtc.write(CRTC_ADDRESS, 7);
    crtc.write(CRTC_DATA, 0x1b);
    expect(log.recent().map((w) => [w.device, w.register, w.value])).toEqual([['crtc', 7, 0x1b]]);
  });

  it('logs what the MOS sent, not what the register kept: R12 := &FF is logged as &FF', () => {
    const log = new HardwareLog({ cycles: 0 });
    const crtc = new Crtc6845(log);
    set(crtc, 12, 0xff);
    expect(log.recent().map((w) => w.value)).toEqual([0xff]);
    expect(crtc.register(12)).toBe(0x3f);
  });

  it('a new chip holds &00 everywhere (a real one powers up with junk until the MOS writes its table)', () => {
    const crtc = new Crtc6845();
    expect(crtc.registers()).toEqual(new Array<number>(CRTC_REGISTER_COUNT).fill(0));
    expect(crtc.addressRegister).toBe(0);
  });
});
