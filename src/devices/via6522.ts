// The 6522 Versatile Interface Adapter: the ports (Stage 24) and timers (Stage 25).
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
// The timers (Stage 25) are two 16-bit down-counters, clocked by the VIA's
// φ2. On the Model B that's the 1 MHz bus, so one count is 1 µs, every 2 CPU
// cycles. Writes go to latches; writing the high byte loads the counter:
//
//   T1: N, N-1 … 1, 0, &FFFF (flag: IFR bit 6), then free-run reloads N
//       └──────────── N+2 cycles ─────────────┘
//
// Built later: IER, IFR bit 7, /IRQ, handshakes, control lines and input
// latching (Stage 26). Until then SR, PCR and IER are plain storage, so all
// 16 registers exist for the panel and the CPU.

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

// ACR bits (6522 datasheet, auxiliary control register).
/** ACR bit 7: Timer 1 drives PB7 (one low pulse, or a square wave). */
export const ACR_T1_PB7_OUTPUT = 0x80;
/** ACR bit 6: Timer 1 free-runs (reloads and flags every time). 0 = one-shot. */
export const ACR_T1_FREE_RUN = 0x40;
/** ACR bit 5: Timer 2 counts pulses on PB6 instead of clock cycles. */
export const ACR_T2_PULSE_COUNT = 0x20;

// IFR bits (6522 datasheet, interrupt flag register).
/** IFR bit 6: Timer 1 has run out. */
export const IFR_T1 = 0x40;
/** IFR bit 5: Timer 2 has run out. */
export const IFR_T2 = 0x20;
/** IFR bits 0-6 are flags; bit 7 is "any enabled flag set" (Stage 26). */
const IFR_FLAGS = 0x7f;

/**
 * The Model B clocks its VIAs from the 1 MHz bus, so the timers count once
 * every 2 CPU (2 MHz) cycles: one count is one microsecond.
 */
export const CPU_CYCLES_PER_VIA_CYCLE = 2;

/** PB7, the line Timer 1 can drive. */
const PB7 = 0x80;

/** RS0-RS3: the VIA sees 4 address lines, so 16 registers. */
const REGISTER_MASK = 0x0f;

/** What the outside world does when nothing is connected: no line pulled low. */
const NOTHING_PULLING = 0xff;

/** A snapshot of both timers, for the workbench. Not used on the hot path. */
export interface ViaTimers {
  readonly t1: {
    readonly counter: number;
    readonly latch: number;
    readonly freeRun: boolean;
    /** Will the next timeout set IFR bit 6? Always true when free-running. */
    readonly armed: boolean;
    readonly drivesPb7: boolean;
    /** The level T1 puts on PB7 when drivesPb7. */
    readonly pb7: 0 | 1;
  };
  readonly t2: {
    readonly counter: number;
    readonly latchLow: number;
    readonly pulseCounting: boolean;
    readonly armed: boolean;
  };
  readonly ifr: number;
}

export class Via6522 implements IoDevice {
  private ora = 0;
  private orb = 0;
  private ddra = 0;
  private ddrb = 0;
  private outsideA = NOTHING_PULLING;
  private outsideB = NOTHING_PULLING;
  /** SR, PCR and IER, indexed by register number: storage until Stage 26 (SR for good). */
  private readonly stub = new Uint8Array(16);

  // Timers. A real chip powers up with random counters and latches; ours start at &0000.
  private t1Counter = 0;
  /** Both T1 latch bytes: high << 8 | low. */
  private t1Latch = 0;
  /** One-shot: will the next timeout set IFR bit 6? Writing T1C-H arms it. */
  private t1Armed = false;
  /**
   * The next cycle loads the latch into the counter: after a roll-over to
   * &FFFF (free-run's reload), or after a write to T1C-H.
   */
  private t1Reload = false;
  /** The level Timer 1 puts on PB7 when ACR bit 7 is set. */
  private pb7 = 1;
  private t2Counter = 0;
  /** T2 has a low-order latch only: writing T2C-H supplies the high byte. */
  private t2LatchLow = 0;
  private t2Armed = false;
  /** A write to T2C-H loads the counter on the next cycle, like T1. */
  private t2Load = false;
  /** The value that load will put in: the T2C-H byte and the low latch. */
  private t2LoadValue = 0;
  private acr = 0;
  private ifr = 0;
  /** CPU cycles not yet worth a whole VIA cycle: 0 or 1. */
  private phase = 0;

  /** A new VIA is in its reset state: the Model B's power-on circuit always resets it. */
  constructor() {
    this.reset();
  }

  /**
   * The /RES pin. Clears every register except T1, T2 and SR (6522
   * datasheet, RES), so both DDRs are &00 and every line is an input. The
   * outside world is not part of the chip, so it's left alone.
   *
   * The counters keep running and the latches keep their values, but with
   * IFR and ACR cleared nothing is armed: no flag until T1C-H or T2C-H is written.
   */
  reset(): void {
    this.ora = 0;
    this.orb = 0;
    this.ddra = 0;
    this.ddrb = 0;
    this.acr = 0;
    this.ifr = 0;
    this.t1Armed = false;
    this.t2Armed = false;
    this.stub[VIA_PCR] = 0;
    this.stub[VIA_IER] = 0;
  }

  /**
   * Moves the VIA on by this many CPU (2 MHz) cycles. Every 2 of them is
   * one VIA cycle; an odd one is kept for next time. No allocation: this runs
   * after every instruction.
   */
  tick(cpuCycles: number): void {
    this.phase += cpuCycles;
    while (this.phase >= CPU_CYCLES_PER_VIA_CYCLE) {
      this.phase -= CPU_CYCLES_PER_VIA_CYCLE;
      this.clockOnce();
    }
  }

  /** One φ2 cycle of both timers (6522 datasheet, timer timing diagrams). */
  private clockOnce(): void {
    // Timer 1: N … 0, &FFFF (timeout), then the latch again.
    if (this.t1Reload) {
      this.t1Reload = false;
      this.t1Counter = this.t1Latch;
    } else if (this.t1Counter === 0) {
      this.t1Counter = 0xffff;
      // The latch always reloads, even in one-shot mode (see the Stage 25 doc's Gotchas).
      this.t1Reload = true;
      const freeRun = (this.acr & ACR_T1_FREE_RUN) !== 0;
      if (freeRun || this.t1Armed) {
        this.ifr |= IFR_T1;
        this.pb7 = freeRun ? this.pb7 ^ 1 : 1;
        this.t1Armed = freeRun;
      }
    } else {
      this.t1Counter--;
    }

    // Timer 2: a fresh load first; in pulse-counting mode it waits for PB6
    // (not built), so clock cycles don't count.
    if (this.t2Load) {
      this.t2Load = false;
      this.t2Counter = this.t2LoadValue;
    } else if ((this.acr & ACR_T2_PULSE_COUNT) === 0) {
      if (this.t2Counter === 0 && this.t2Armed) {
        this.ifr |= IFR_T2;
        this.t2Armed = false;
      }
      this.t2Counter = (this.t2Counter - 1) & 0xffff; // no reload: &0000 → &FFFF and on down
    }
  }

  /** The CPU reads register offset & &0F. */
  read(offset: number): number {
    const reg = offset & REGISTER_MASK;
    const value = this.peek(reg);
    // Reading a timer's low counter byte acknowledges its timeout (datasheet, IFR).
    if (reg === VIA_T1C_L) this.ifr &= ~IFR_T1;
    else if (reg === VIA_T2C_L) this.ifr &= ~IFR_T2;
    // Stage 26 adds the port reads' side effects (reading IRA/IRB clears CA1/CB1 flags, and so on).
    return value;
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
      case VIA_T1C_L:
      case VIA_T1L_L: // the same low latch: only the reads differ
        this.t1Latch = (this.t1Latch & 0xff00) | v;
        break;
      case VIA_T1C_H:
        // High latch, then both latches into the counter, all 16 bits at once.
        // The counter takes N in the cycle after the write (datasheet timing
        // diagram), so the flag comes N+1.5 cycles after it, not N+0.5.
        this.t1Latch = (v << 8) | (this.t1Latch & 0x00ff);
        this.t1Reload = true;
        this.t1Armed = true;
        this.ifr &= ~IFR_T1;
        this.pb7 = 0; // PB7 goes low at the start of the count (seen only with ACR bit 7)
        break;
      case VIA_T1L_H:
        // The high latch only. Clearing the flag here is the common reading of the datasheet (see the Gotchas).
        this.t1Latch = (v << 8) | (this.t1Latch & 0x00ff);
        this.ifr &= ~IFR_T1;
        break;
      case VIA_T2C_L:
        this.t2LatchLow = v;
        break;
      case VIA_T2C_H:
        // Loads on the next cycle, as T1C-H does.
        this.t2LoadValue = (v << 8) | this.t2LatchLow;
        this.t2Load = true;
        this.t2Armed = true;
        this.ifr &= ~IFR_T2;
        break;
      case VIA_ACR:
        this.acr = v;
        break;
      case VIA_IFR:
        // A 1 clears that flag; a 0 leaves it alone (datasheet, IFR).
        this.ifr &= ~(v & IFR_FLAGS);
        break;
      default:
        this.stub[offset & REGISTER_MASK] = v;
    }
  }

  /** What read() would return now, with no side effects. */
  peek(offset: number): number {
    switch (offset & REGISTER_MASK) {
      case VIA_ORB: {
        // IRB: ORB for output lines, the pins for input lines. PB7 counts as an
        // output when Timer 1 drives it, and reads Timer 1's level.
        const ddrb = this.ddrbSeenByPins();
        return ((this.orbSeenByPins() & ddrb) | (this.pins('b') & ~ddrb)) & 0xff;
      }
      case VIA_ORA:
      case VIA_ORA_NO_HANDSHAKE:
        // IRA: the pins, for every line.
        return this.pins('a');
      case VIA_DDRB:
        return this.ddrb;
      case VIA_DDRA:
        return this.ddra;
      case VIA_T1C_L:
        return this.t1Counter & 0xff;
      case VIA_T1C_H:
        return this.t1Counter >> 8;
      case VIA_T1L_L:
        return this.t1Latch & 0xff;
      case VIA_T1L_H:
        return this.t1Latch >> 8;
      case VIA_T2C_L:
        return this.t2Counter & 0xff;
      case VIA_T2C_H:
        return this.t2Counter >> 8;
      case VIA_ACR:
        return this.acr;
      case VIA_IFR:
        return this.ifr; // bit 7 needs IER: Stage 26
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
    const or = port === 'a' ? this.ora : this.orbSeenByPins();
    const ddr = port === 'a' ? this.ddra : this.ddrbSeenByPins();
    const outside = port === 'a' ? this.outsideA : this.outsideB;
    return ((or & ddr) | ~ddr) & outside & 0xff;
  }

  /** Is Timer 1 driving PB7 (ACR bit 7)? Then PB7 is an output, whatever DDRB says. */
  timer1DrivesPb7(): boolean {
    return (this.acr & ACR_T1_PB7_OUTPUT) !== 0;
  }

  /** Both timers and the IFR, for the workbench. */
  timers(): ViaTimers {
    return {
      t1: {
        counter: this.t1Counter,
        latch: this.t1Latch,
        freeRun: (this.acr & ACR_T1_FREE_RUN) !== 0,
        armed: this.t1Armed || (this.acr & ACR_T1_FREE_RUN) !== 0,
        drivesPb7: this.timer1DrivesPb7(),
        pb7: this.pb7 === 0 ? 0 : 1,
      },
      t2: {
        counter: this.t2Counter,
        latchLow: this.t2LatchLow,
        pulseCounting: (this.acr & ACR_T2_PULSE_COUNT) !== 0,
        armed: this.t2Armed,
      },
      ifr: this.ifr,
    };
  }

  /** ORB, with Timer 1's level in bit 7 when it drives PB7. */
  private orbSeenByPins(): number {
    return this.timer1DrivesPb7() ? (this.orb & ~PB7) | (this.pb7 << 7) : this.orb;
  }

  /** DDRB, with bit 7 forced to output when Timer 1 drives PB7. */
  private ddrbSeenByPins(): number {
    return this.timer1DrivesPb7() ? this.ddrb | PB7 : this.ddrb;
  }
}
