// The 6522 Versatile Interface Adapter: the ports (Stage 24), timers (Stage 25),
// and interrupts and control lines (Stage 26).
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
// Interrupts (Stage 26). Each source sets its own IFR bit (a flag); IER says
// which flags may interrupt. The /IRQ pin is low while
//
//   IFR & IER & &7F ≠ 0
//
// and IFR bit 7 reads that same test. The control lines CA1/CB1 (inputs) and
// CA2/CB2 (inputs or outputs) set their flags on an edge, chosen by the PCR.
//
// The shift register isn't built (not planned): SR is plain storage.

import type { IoDevice } from '../memory/io-device';
import type { IrqSource } from './irq-source';

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
/** Shift register. Not planned: the Model B's MOS doesn't use it. Plain storage. */
export const VIA_SR = 0xa;
/** Auxiliary control register: timer modes, SR mode, input latching. Stage 25. */
export const VIA_ACR = 0xb;
/** Peripheral control register: CA1/CA2/CB1/CB2 modes. */
export const VIA_PCR = 0xc;
/** Interrupt flag register: write 1s to clear flags. Bit 7 = "an enabled flag is set". */
export const VIA_IFR = 0xd;
/** Interrupt enable register: bit 7 of a write says set (1) or clear (0) the 1 bits. Reads with bit 7 = 1. */
export const VIA_IER = 0xe;
/** ORA / IRA again, without the handshake: it doesn't clear CA1/CA2 or touch CA2's output. */
export const VIA_ORA_NO_HANDSHAKE = 0xf;

// ACR bits (6522 datasheet, auxiliary control register).
/** ACR bit 7: Timer 1 drives PB7 (one low pulse, or a square wave). */
export const ACR_T1_PB7_OUTPUT = 0x80;
/** ACR bit 6: Timer 1 free-runs (reloads and flags every time). 0 = one-shot. */
export const ACR_T1_FREE_RUN = 0x40;
/** ACR bit 5: Timer 2 counts pulses on PB6 instead of clock cycles. */
export const ACR_T2_PULSE_COUNT = 0x20;
/** ACR bit 1: IRB's input bits come from the pins at the last active CB1 edge. */
export const ACR_PB_LATCH = 0x02;
/** ACR bit 0: IRA reads the pins as they were at the last active CA1 edge. */
export const ACR_PA_LATCH = 0x01;

// IFR bits (6522 datasheet, interrupt flag register).
// IER uses the same layout.
/** IFR bit 7: an enabled flag is set, so /IRQ is low. Read-only. */
export const IFR_IRQ = 0x80;
/** IFR bit 6: Timer 1 has run out. */
export const IFR_T1 = 0x40;
/** IFR bit 5: Timer 2 has run out. */
export const IFR_T2 = 0x20;
/** IFR bit 4: an active edge on CB1. */
export const IFR_CB1 = 0x10;
/** IFR bit 3: an active edge on CB2 (input modes). */
export const IFR_CB2 = 0x08;
/** IFR bit 2: the shift register has shifted 8 bits. Never set here: no shift register. */
export const IFR_SR = 0x04;
/** IFR bit 1: an active edge on CA1. */
export const IFR_CA1 = 0x02;
/** IFR bit 0: an active edge on CA2 (input modes). */
export const IFR_CA2 = 0x01;
/** IFR bits 0-6 are flags; bit 7 is "any enabled flag set". */
const IFR_FLAGS = 0x7f;
/** IER write, bit 7: 1 = set the bits written as 1, 0 = clear them. */
export const IER_SET = 0x80;

// PCR fields (6522 datasheet, peripheral control register).
/** PCR bit 0: CA1 flags a rising edge (1) or a falling edge (0). */
export const PCR_CA1_POSITIVE = 0x01;
/** PCR bit 4: the same for CB1. */
export const PCR_CB1_POSITIVE = 0x10;
/** CA2's 3-bit mode is PCR bits 3-1. */
const PCR_CA2_SHIFT = 1;
/** CB2's 3-bit mode is PCR bits 7-5. */
const PCR_CB2_SHIFT = 5;

/**
 * The CA2/CB2 modes, the 3-bit PCR field. Value 4 (1xx) makes it an output.
 * For the inputs (0xx), value 2 picks the rising edge and value 1 makes it
 * "independent" (port accesses leave its flag alone).
 */
export const C2_MODE = {
  inputNegative: 0b000,
  independentNegative: 0b001,
  inputPositive: 0b010,
  independentPositive: 0b011,
  handshake: 0b100,
  pulse: 0b101,
  low: 0b110,
  high: 0b111,
} as const;
const C2_INDEPENDENT = 0b001;
const C2_POSITIVE = 0b010;
const C2_OUTPUT = 0b100;

/** The four control lines: CA1, CB1 always inputs; CA2, CB2 inputs or outputs. */
export type ControlLine = 'ca1' | 'ca2' | 'cb1' | 'cb2';
export type Level = 0 | 1;

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

export class Via6522 implements IoDevice, IrqSource {
  private ora = 0;
  private orb = 0;
  private ddra = 0;
  private ddrb = 0;
  private outsideA = NOTHING_PULLING;
  private outsideB = NOTHING_PULLING;
  /** The shift register: storage only. */
  private sr = 0;

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
  /** Bits 6-0 only: bit 7 isn't stored, it always reads 1. */
  private ier = 0;
  private pcr = 0;

  // Control lines (Stage 26). The outside world's level on each: 1 = nothing pulling.
  private ca1 = 1;
  private ca2 = 1;
  private cb1 = 1;
  private cb2 = 1;
  /** What the VIA drives on CA2/CB2 in handshake or pulse mode. */
  private ca2Out = 1;
  private cb2Out = 1;
  /** A pulse-mode low that ends at the next VIA cycle. */
  private ca2Pulse = false;
  private cb2Pulse = false;
  /** The pins at the last active CA1/CB1 edge, for input latching. Unknown on a real chip until the first edge. */
  private latchA = 0xff;
  private latchB = 0xff;
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
    this.pcr = 0;
    this.ier = 0;
    // PCR = 0 makes CA2/CB2 inputs, so their output state starts again.
    this.ca2Out = 1;
    this.cb2Out = 1;
    this.ca2Pulse = false;
    this.cb2Pulse = false;
  }

  /**
   * The /IRQ pin: true while the VIA pulls it low, because a flag is set
   * and enabled. Computed, not stored, so it can't get out of step.
   */
  get irq(): boolean {
    return (this.ifr & this.ier & IFR_FLAGS) !== 0;
  }

  /**
   * The outside world drives a control line to this level. An active edge
   * (as the PCR chooses) sets the line's IFR flag. A CA2/CB2 that the PCR
   * makes an output ignores it. Edges count the moment they happen; a real
   * chip notices at its next φ2 cycle, which is never visible between instructions.
   */
  setControlLine(line: ControlLine, level: Level): void {
    const now = level === 0 ? 0 : 1;
    switch (line) {
      case 'ca1': {
        const was = this.ca1;
        this.ca1 = now;
        if (isEdge(was, now, (this.pcr & PCR_CA1_POSITIVE) !== 0)) {
          this.ifr |= IFR_CA1;
          this.latchA = this.pins('a');
          // The peripheral's "got it": a CA2 handshake ends.
          if (this.c2Mode('a') === C2_MODE.handshake) this.ca2Out = 1;
        }
        break;
      }
      case 'cb1': {
        const was = this.cb1;
        this.cb1 = now;
        if (isEdge(was, now, (this.pcr & PCR_CB1_POSITIVE) !== 0)) {
          this.ifr |= IFR_CB1;
          this.latchB = this.pins('b');
          if (this.c2Mode('b') === C2_MODE.handshake) this.cb2Out = 1;
        }
        break;
      }
      case 'ca2': {
        const was = this.ca2;
        this.ca2 = now;
        const mode = this.c2Mode('a');
        if ((mode & C2_OUTPUT) === 0 && isEdge(was, now, (mode & C2_POSITIVE) !== 0)) this.ifr |= IFR_CA2;
        break;
      }
      case 'cb2': {
        const was = this.cb2;
        this.cb2 = now;
        const mode = this.c2Mode('b');
        if ((mode & C2_OUTPUT) === 0 && isEdge(was, now, (mode & C2_POSITIVE) !== 0)) this.ifr |= IFR_CB2;
        break;
      }
    }
  }

  /** The level on a control line: the outside's, or for a CA2/CB2 output, the VIA's. */
  controlLine(line: ControlLine): Level {
    switch (line) {
      case 'ca1':
        return this.ca1 === 0 ? 0 : 1;
      case 'cb1':
        return this.cb1 === 0 ? 0 : 1;
      case 'ca2':
        return c2Level(this.c2Mode('a'), this.ca2, this.ca2Out);
      case 'cb2':
        return c2Level(this.c2Mode('b'), this.cb2, this.cb2Out);
    }
  }

  /** CA2's or CB2's 3-bit mode from the PCR: see C2_MODE. */
  c2Mode(port: ViaPort): number {
    return (this.pcr >> (port === 'a' ? PCR_CA2_SHIFT : PCR_CB2_SHIFT)) & 0b111;
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
    // A pulse-mode CA2/CB2 low lasts one cycle.
    if (this.ca2Pulse) {
      this.ca2Pulse = false;
      this.ca2Out = 1;
    }
    if (this.cb2Pulse) {
      this.cb2Pulse = false;
      this.cb2Out = 1;
    }

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
    // Reading a timer's low counter byte acknowledges its timeout, and reading
    // a port acknowledges its control lines (datasheet, IFR). Register 15 doesn't.
    if (reg === VIA_T1C_L) this.ifr &= ~IFR_T1;
    else if (reg === VIA_T2C_L) this.ifr &= ~IFR_T2;
    else if (reg === VIA_ORA) this.portAAccess();
    else if (reg === VIA_ORB) this.portBAccess(false);
    return value;
  }

  /** The CPU writes value & &FF to register offset & &0F. */
  write(offset: number, value: number): void {
    const v = value & 0xff;
    switch (offset & REGISTER_MASK) {
      case VIA_ORB:
        this.orb = v;
        this.portBAccess(true);
        break;
      case VIA_ORA:
        this.ora = v;
        this.portAAccess();
        break;
      case VIA_ORA_NO_HANDSHAKE: // the same ORA, with no flag clearing and no handshake
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
      case VIA_PCR:
        this.writePcr(v);
        break;
      case VIA_IFR:
        // A 1 clears that flag; a 0 leaves it alone; bit 7 can't be written (datasheet, IFR).
        this.ifr &= ~(v & IFR_FLAGS);
        break;
      case VIA_IER:
        // Bit 7 says what to do with the 1 bits: set them, or clear them.
        if ((v & IER_SET) !== 0) this.ier |= v & IFR_FLAGS;
        else this.ier &= ~(v & IFR_FLAGS);
        break;
      case VIA_SR:
        this.sr = v;
        break;
    }
  }

  /** A new PCR. A CA2/CB2 that changes mode starts with its handshake output high. */
  private writePcr(v: number): void {
    const oldA = this.c2Mode('a');
    const oldB = this.c2Mode('b');
    this.pcr = v;
    if (this.c2Mode('a') !== oldA) {
      this.ca2Out = 1;
      this.ca2Pulse = false;
    }
    if (this.c2Mode('b') !== oldB) {
      this.cb2Out = 1;
      this.cb2Pulse = false;
    }
  }

  /**
   * A CPU read or write of register 1 (ORA/IRA, with handshake): clears CA1's
   * flag, and CA2's unless it's independent; starts a CA2 handshake or pulse.
   */
  private portAAccess(): void {
    this.ifr &= ~IFR_CA1;
    const mode = this.c2Mode('a');
    if ((mode & (C2_OUTPUT | C2_INDEPENDENT)) === 0) this.ifr &= ~IFR_CA2;
    if (mode === C2_MODE.handshake) this.ca2Out = 0;
    else if (mode === C2_MODE.pulse) {
      this.ca2Out = 0;
      this.ca2Pulse = true;
    }
  }

  /** The same for register 0 (ORB/IRB), except that only a write starts a CB2 handshake or pulse. */
  private portBAccess(isWrite: boolean): void {
    this.ifr &= ~IFR_CB1;
    const mode = this.c2Mode('b');
    if ((mode & (C2_OUTPUT | C2_INDEPENDENT)) === 0) this.ifr &= ~IFR_CB2;
    if (!isWrite) return;
    if (mode === C2_MODE.handshake) this.cb2Out = 0;
    else if (mode === C2_MODE.pulse) {
      this.cb2Out = 0;
      this.cb2Pulse = true;
    }
  }

  /** What read() would return now, with no side effects. */
  peek(offset: number): number {
    switch (offset & REGISTER_MASK) {
      case VIA_ORB: {
        // IRB: ORB for output lines, the pins for input lines. PB7 counts as an
        // output when Timer 1 drives it, and reads Timer 1's level. With
        // latching on, the input bits are the pins at the last CB1 edge.
        const ddrb = this.ddrbSeenByPins();
        const inputs = (this.acr & ACR_PB_LATCH) !== 0 ? this.latchB : this.pins('b');
        return ((this.orbSeenByPins() & ddrb) | (inputs & ~ddrb)) & 0xff;
      }
      case VIA_ORA:
      case VIA_ORA_NO_HANDSHAKE:
        // IRA: the pins, for every line, or the pins at the last CA1 edge.
        return (this.acr & ACR_PA_LATCH) !== 0 ? this.latchA : this.pins('a');
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
      case VIA_SR:
        return this.sr;
      case VIA_PCR:
        return this.pcr;
      case VIA_IFR:
        return this.irq ? this.ifr | IFR_IRQ : this.ifr;
      case VIA_IER:
        return this.ier | IER_SET; // bit 7 always reads 1 (the MOS's power-on test relies on it)
      default:
        return 0; // unreachable: all 16 registers are above
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

/** Did a line go the way that counts? Rising (0 → 1) if positive, else falling (1 → 0). */
function isEdge(was: number, now: number, positive: boolean): boolean {
  return positive ? was === 0 && now === 1 : was === 1 && now === 0;
}

/** CA2/CB2's level: the outside's for an input mode, else the VIA's. */
function c2Level(mode: number, outside: number, handshakeOut: number): Level {
  if (mode === C2_MODE.low) return 0;
  if (mode === C2_MODE.high) return 1;
  if ((mode & C2_OUTPUT) !== 0) return handshakeOut === 0 ? 0 : 1;
  return outside === 0 ? 0 : 1;
}
