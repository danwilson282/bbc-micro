// The 6522 Versatile Interface Adapter: the ports (Stage 24).
//
// The Model B has two: the System VIA at &FE40 (keyboard, sound, latch,
// joystick buttons) and the User VIA at &FE60 (printer, user port). This
// file is the same chip for both. The memory map passes a register number
// 0-15 (RS3-RS0); the VIA never sees the address.
//
// Each port has 8 lines. DDRx says, bit by bit, which way each line goes:
//   1 = output: the VIA drives the line with the bit in ORx
//   0 = input:  the VIA lets go, and the outside world decides
// The outside world is one byte per port: a 0 bit pulls that line low (a
// switch to ground, an open-collector output, a short). So
//
//   pin level = ((ORx & DDRx) | ~DDRx) & outside
//
// and a line nobody drives floats high.
//
// Reads differ between the ports (6522 datasheet, "Port A" and "Port B"):
//   IRA: the pin level on every line
//   IRB: ORB for output lines, the pin level for input lines
//
// Built later: the timers (Stage 25), the interrupt flags, handshakes,
// control lines and input latching (Stage 26). Until then registers &4-&E
// are plain storage, so all 16 exist for the panel and the CPU.

import type { IoDevice } from '../memory/io-device';

/** Which port: A (PA0-PA7) or B (PB0-PB7). */
export type ViaPort = 'a' | 'b';

// Register numbers, by RS3-RS0 (6522 datasheet, register select table).
/** Write: ORB, output register B. Read: IRB, input register B. */
export const VIA_ORB = 0x0;
/** Write: ORA. Read: IRA. With the CA1/CA2 handshake (Stage 26). */
export const VIA_ORA = 0x1;
/** Data direction register B: 1 = output. */
export const VIA_DDRB = 0x2;
/** Data direction register A: 1 = output. */
export const VIA_DDRA = 0x3;
/** Write: T1 low-order latch. Read: T1 low-order counter. Stage 25. */
export const VIA_T1C_L = 0x4;
/** T1 high-order counter. Stage 25. */
export const VIA_T1C_H = 0x5;
/** T1 low-order latch. Stage 25. */
export const VIA_T1L_L = 0x6;
/** T1 high-order latch. Stage 25. */
export const VIA_T1L_H = 0x7;
/** Write: T2 low-order latch. Read: T2 low-order counter. Stage 25. */
export const VIA_T2C_L = 0x8;
/** T2 high-order counter. Stage 25. */
export const VIA_T2C_H = 0x9;
/** Shift register. Not planned: the Model B's MOS doesn't use it. */
export const VIA_SR = 0xa;
/** Auxiliary control register: timer modes, SR mode, input latching. Stage 25. */
export const VIA_ACR = 0xb;
/** Peripheral control register: CA1/CA2/CB1/CB2 modes. Stage 26. */
export const VIA_PCR = 0xc;
/** Interrupt flag register. Stage 26. */
export const VIA_IFR = 0xd;
/** Interrupt enable register. Stage 26. */
export const VIA_IER = 0xe;
/** ORA / IRA again, without the handshake side effects. */
export const VIA_ORA_NO_HANDSHAKE = 0xf;

/** RS0-RS3: the VIA sees 4 address lines, so 16 registers. */
const REGISTER_MASK = 0x0f;

/** What the outside world does when nothing is connected: no line pulled low. */
const NOTHING_PULLING = 0xff;

export class Via6522 implements IoDevice {
  private ora = 0;
  private orb = 0;
  private ddra = 0;
  private ddrb = 0;
  private outsideA = NOTHING_PULLING;
  private outsideB = NOTHING_PULLING;
  /** Registers &4-&E, indexed by register number: storage until Stages 25 and 26 build them. */
  private readonly stub = new Uint8Array(16);

  /** A new VIA is in its reset state: the Model B's power-on circuit always resets it. */
  constructor() {
    this.reset();
  }

  /**
   * The /RES pin. Clears every register except T1, T2 and SR (6522
   * datasheet, RES), so both DDRs are &00 and every line is an input. The
   * outside world is not part of the chip, so it's left alone.
   */
  reset(): void {
    this.ora = 0;
    this.orb = 0;
    this.ddra = 0;
    this.ddrb = 0;
    this.stub[VIA_ACR] = 0;
    this.stub[VIA_PCR] = 0;
    this.stub[VIA_IFR] = 0;
    this.stub[VIA_IER] = 0;
  }

  /** The CPU reads register offset & &0F. */
  read(offset: number): number {
    // No side effects yet: Stage 26 adds them (reading IRA/IRB clears CA1/CB1 flags, and so on).
    return this.peek(offset);
  }

  /** The CPU writes value & &FF to register offset & &0F. */
  write(offset: number, value: number): void {
    const v = value & 0xff;
    switch (offset & REGISTER_MASK) {
      case VIA_ORB:
        this.orb = v;
        break;
      case VIA_ORA:
      case VIA_ORA_NO_HANDSHAKE: // the same ORA; only the handshake differs (Stage 26)
        this.ora = v;
        break;
      case VIA_DDRB:
        this.ddrb = v;
        break;
      case VIA_DDRA:
        this.ddra = v;
        break;
      default:
        this.stub[offset & REGISTER_MASK] = v;
    }
  }

  /** What read() would return now, with no side effects. */
  peek(offset: number): number {
    switch (offset & REGISTER_MASK) {
      case VIA_ORB:
        // IRB: ORB for output lines, the pins for input lines.
        return ((this.orb & this.ddrb) | (this.pins('b') & ~this.ddrb)) & 0xff;
      case VIA_ORA:
      case VIA_ORA_NO_HANDSHAKE:
        // IRA: the pins, for every line.
        return this.pins('a');
      case VIA_DDRB:
        return this.ddrb;
      case VIA_DDRA:
        return this.ddra;
      default:
        return this.stub[offset & REGISTER_MASK] ?? 0;
    }
  }

  /** ORA or ORB: what the VIA drives on its output lines. No CPU read shows it whole. */
  outputRegister(port: ViaPort): number {
    return port === 'a' ? this.ora : this.orb;
  }

  /** DDRA or DDRB: 1 bits are outputs. */
  dataDirection(port: ViaPort): number {
    return port === 'a' ? this.ddra : this.ddrb;
  }

  /** What the outside world does to the port: a 0 bit pulls that line low. */
  outside(port: ViaPort): number {
    return port === 'a' ? this.outsideA : this.outsideB;
  }

  /** Sets what the outside world does to the port: &FF = nothing pulling, a 0 bit pulls that line low. */
  setOutside(port: ViaPort, value: number): void {
    if (port === 'a') this.outsideA = value & 0xff;
    else this.outsideB = value & 0xff;
  }

  /** The level on each line: driven by the VIA (outputs) or floating high (inputs), and pulled low by the outside. */
  pins(port: ViaPort): number {
    const or = port === 'a' ? this.ora : this.orb;
    const ddr = port === 'a' ? this.ddra : this.ddrb;
    const outside = port === 'a' ? this.outsideA : this.outsideB;
    return ((or & ddr) | ~ddr) & outside & 0xff;
  }
}
