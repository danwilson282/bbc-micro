// The BBC Micro Model B: the CPU, the memory map with its ROMs, and the
// chips, put together and moved forward in time together (Stage 27).
//
//   Cpu6502 ──▶ WriteRecorder ──▶ BbcMemoryMap ──▶ RAM, ROMs, SHEILA chips, FRED card
//      ▲                                                  │
//      └──────────── /IRQ ◀── wire-OR ◀── irq ────────────┘
//
// It's a scheduler as well as a box of parts. The real chips all run at once
// off one crystal; we take turns, one instruction at a time (BUILD-PLAN §3):
//
//   step():  sync /IRQ → trace → cpu.step() → tick every device → sync /IRQ
//
// /IRQ is open-collector on the Model B. Every chip that can interrupt is
// wired to the same line and can pull it low, so it's low while ANY of them
// holds it. The machine never stores the line: it asks every source again.
//
// Two resets, because the MOS tells them apart (Stage 23): powerOn() resets
// every chip, and reset() is the BREAK key, which resets only the CPU.
//
// Stage 28 plugs in the parts the MOS talks to while it starts up, built
// just well enough: the IC32 latch on the System VIA's PB0-PB3, a keyboard
// on its port A (a stub then; the real matrix since Stage 34), and storage stubs for the CRTC (the real register file since Stage 37) and Video ULA. They
// report what they're told to the hardware log, by name.
//
//   System VIA PB0-PB3 ──▶ IC32 latch ──▶ bit 3: keyboard enable ─┐
//   System VIA PA0-PA6 ──▶ key matrix ◀───────────────────────────┘
//                               └──▶ PA7: "that key is down"
//
// Stage 29 adds the last two the boot needs: an idle ACIA (so the MOS's
// "was it the ACIA?" gets "no" and it goes on to the System VIA), and a
// fake 50 Hz vsync on the System VIA's CA1. Stage 38 replaces that with the
// CRTC's own VSYNC: the 6845 is ticked with the other chips, at the clock
// the Video ULA picks, and its pin 40 drives CA1.
//
//   ULA control bit 4 ──▶ 6845 clock ──▶ counters ──▶ VSYNC ──▶ System VIA CA1 ──▶ IFR bit 1
//
// Stage 35 lets the keyboard interrupt. Its column counter is ticked with
// the VIAs; it counts by itself while latch bit 3 is 1, and follows PA0-PA3
// while it's 0. Its CA2 output ("a key in rows 1-7 of this column") goes
// straight to the System VIA's CA2, edge by edge.
//
//   keyboard counter ──▶ column ──▶ any key? ──▶ System VIA CA2 ──▶ IFR bit 0 ──▶ /IRQ
//
// Stage 36 makes BREAK a switch you hold. It isn't in the key matrix: it
// pulls the 6502's /RES low. While it's held the CPU runs nothing, but the
// clock goes on, so the devices are still ticked. Letting go runs the reset
// sequence (6502 datasheet: the sequence starts when /RES goes high). And
// the two lock LEDs are read from IC32 bits 6 and 7 (0 = lit).
//
//   BREAK ──▶ /RES ──▶ 6502 only        IC32 bit 6 ──▶ CAPS LOCK LED
//                                       IC32 bit 7 ──▶ SHIFT LOCK LED
//
// step() and runCycles() are the hot path: no objects, closures or arrays
// are made in them, and the device lists are walked with indexed loops.

import { Cpu6502, type InterruptKind } from '../cpu/cpu6502';
import type { Registers } from '../cpu/registers';
import { Tracer } from '../cpu/trace';
import { AddressableLatch, LATCH_CAPS_LOCK_LED, LATCH_KEYBOARD_ENABLE, LATCH_SHIFT_LOCK_LED } from '../devices/addressable-latch';
import type { Clocked } from '../devices/clocked';
import { HardwareLog, type CycleClock } from '../devices/hardware-log';
import { Keyboard } from '../devices/keyboard';
import type { IrqSource } from '../devices/irq-source';
import { AciaStub } from '../devices/stubs/acia-stub';
import { Crtc6845 } from '../devices/crtc6845';
import { ULA_CONTROL_FAST_CLOCK } from '../devices/crtc-geometry';
import { VideoUlaStub } from '../devices/stubs/video-ula-stub';
import { Via6522, type PinListener, type ViaPort } from '../devices/via6522';
import { BbcMemoryMap } from '../memory/bbc-memory-map';
import type { IoDevice } from '../memory/io-device';
import type { DataBus } from '../memory/placeholder-device';
import { WriteRecorder, type WriteLog } from '../memory/write-recorder';

/** One 50 Hz PAL frame of the 2 MHz 6502: 2,000,000 / 50 (BUILD-PLAN §3). */
export const CYCLES_PER_FRAME = 40_000;

/** What irqHolders calls the two VIAs. */
export const SYSTEM_VIA_NAME = 'System VIA';
export const USER_VIA_NAME = 'User VIA';

/** Enough for a boot's worth of CRTC, ULA and latch writes. */
export const HARDWARE_LOG_CAPACITY = 4096;

/** PA7: the keyboard's "that key is down" line (Advanced User Guide, System VIA port A). */
const PA7 = 0x80;

/**
 * While BREAK holds /RES low, step() moves time on by this much: one 1 MHz
 * tick, the smallest step the VIAs and the keyboard's counter take.
 */
const BREAK_HELD_STEP_CYCLES = 2;

/**
 * A card on the 1 MHz bus: it answers FRED (&FC00-&FCFF), can pull /IRQ
 * low, and is reset by the bus's /RST line (Advanced User Guide; BeebWiki "1MHz bus").
 */
export interface OneMhzBusCard extends IoDevice, IrqSource {
  /** For irqHolders, e.g. "the doorbell". */
  readonly name: string;
  reset(): void;
}

export class BbcModelB implements PinListener, DataBus, CycleClock {
  readonly name: string;
  readonly systemVia = new Via6522();
  readonly userVia = new Via6522();
  /** What the CRTC, Video ULA and latch were told, by name (Stage 28). */
  readonly hardwareLog: HardwareLog;
  /** IC32, on the System VIA's PB0-PB3. */
  readonly latch: AddressableLatch;
  /** The key matrix (Stage 34) and its scan counter (Stage 35). A press or release recomputes PA7 and CA2 at once. */
  readonly keyboard: Keyboard;
  /** The 6845: its registers (Stage 37), and its counters and VSYNC (Stage 38). */
  readonly crtc: Crtc6845;
  /** Always idle: serial and cassette are out of scope. The MOS asks it first on every IRQ (Stage 29). */
  readonly acia = new AciaStub();
  readonly videoUla: VideoUlaStub;
  readonly map: BbcMemoryMap;
  readonly cpu: Cpu6502;
  /** The last 1,024 steps, each recorded just before it ran. */
  readonly trace: Tracer;
  private readonly recorder: WriteRecorder;

  /** Everything ticked after a step. Pushed to only by plugIn(). */
  private readonly clocked: Clocked[];
  /** Everything wired to /IRQ, with the names the workbench shows. */
  private readonly irqSources: IrqSource[];
  private readonly irqNames: string[];
  private readonly cards: OneMhzBusCard[] = [];
  /**
   * Cycles still owed to runCycles(). An instruction can overshoot the
   * budget; the debt is carried into the next call, so time never drifts.
   */
  private budget = 0;
  /** BREAK is down: /RES is low and the CPU is held (Stage 36). */
  private breakDown = false;
  /** Is the CRTC's VSYNC connected to the System VIA's CA1? Cut only to experiment (Stage 38). */
  private vsyncToCa1 = true;

  constructor(name = 'BBC Model B') {
    this.name = name;
    // The log asks this machine the time (its cycles), and the ULA asks it for the floating bus.
    this.hardwareLog = new HardwareLog(this, HARDWARE_LOG_CAPACITY);
    this.latch = new AddressableLatch(this.hardwareLog);
    this.crtc = new Crtc6845(this.hardwareLog);
    this.videoUla = new VideoUlaStub(this, this.hardwareLog);
    this.keyboard = new Keyboard(undefined, () => {
      this.answerKeyboard();
    });
    // Made once here, so the hot path (the keyboard's tick) only calls it.
    this.keyboard.connectCa2((level) => {
      this.systemVia.setControlLine('ca2', level);
    });
    // Made once here too: the CRTC calls these from its tick.
    this.crtc.connectClock(() => (this.videoUla.control & ULA_CONTROL_FAST_CLOCK) !== 0);
    this.crtc.connectVsync((level) => {
      if (this.vsyncToCa1) this.systemVia.setControlLine('ca1', level);
    });
    this.map = new BbcMemoryMap({
      devices: { acia: this.acia, systemVia: this.systemVia, userVia: this.userVia, crtc: this.crtc, videoUla: this.videoUla },
    });
    this.recorder = new WriteRecorder(this.map);
    this.cpu = new Cpu6502(this.recorder);
    // Now the CPU exists to count cycles, wire the System VIA's pins to the latch and keyboard.
    this.systemVia.connectPins(this);
    this.latchFollowsPins();
    this.trace = new Tracer((address) => this.map.peek(address));
    this.clocked = [this.systemVia, this.userVia, this.crtc, this.keyboard];
    this.irqSources = [this.systemVia, this.userVia];
    this.irqNames = [SYSTEM_VIA_NAME, USER_VIA_NAME];
  }

  /**
   * Plugs a card into the 1 MHz bus: it answers FRED and joins the /IRQ
   * wire-OR. One card at a time, like the one socket. Not for the hot path.
   */
  plugIn(card: OneMhzBusCard): void {
    this.map.plugFred(card);
    this.cards.push(card);
    this.irqSources.push(card);
    this.irqNames.push(card.name);
    this.syncIrq();
  }

  // ── Time ───────────────────────────────────────────────────────────────

  /**
   * One instruction (or interrupt sequence), then every device ticked by the
   * cycles it took. Returns those cycles. May throw UnimplementedOpcodeError.
   */
  step(): number {
    if (this.breakDown) return this.stepHeldInReset();
    // The debugger may have changed a device since the last step (a VIA panel button).
    this.syncIrq();
    this.trace.record(this.cpu);
    const cycles = this.cpu.step();
    this.tick(cycles);
    // A timer may have run out, or the handler acknowledged a flag.
    this.syncIrq();
    return cycles;
  }

  /**
   * Runs whole instructions until n more cycles have been used, counting any
   * overshoot left from the last call. Returns the cycles actually run: a
   * few more or fewer than n, but the running total never drifts more than
   * one instruction from the sum of the n's.
   */
  runCycles(n: number): number {
    this.budget += n;
    let ran = 0;
    while (this.budget > 0) {
      const cycles = this.step();
      this.budget -= cycles;
      ran += cycles;
    }
    return ran;
  }

  /**
   * BREAK is held: the 6502 does nothing, but its clock still runs, and so
   * do the VIAs, the CRTC and the keyboard's counter. The cycles are added
   * to the CPU's count so the frame budget and the logs' timestamps move.
   */
  private stepHeldInReset(): number {
    this.cpu.cycles += BREAK_HELD_STEP_CYCLES;
    this.tick(BREAK_HELD_STEP_CYCLES);
    return BREAK_HELD_STEP_CYCLES;
  }

  /** One 50 Hz frame's worth: runCycles(40,000). */
  runFrame(): number {
    return this.runCycles(CYCLES_PER_FRAME);
  }

  // ── Resets ─────────────────────────────────────────────────────────────

  /**
   * Switching on: every chip's /RES (the VIAs clear IER, so the MOS sees
   * &80 at &FE4E), the CRTC's counters back to the top of a field, the 1 MHz bus
   * cards, and the CPU's reset sequence. RAM is left as it is: clearing it
   * is the MOS's job. Returns the CPU's 7 cycles.
   */
  powerOn(): number {
    this.latch.reset();
    // The CRTC first: if VSYNC was high, CA1 falls now, and the VIA's reset then clears the flag it made.
    this.crtc.reset();
    this.systemVia.reset();
    this.userVia.reset();
    this.keyboard.resetScan();
    this.latchFollowsPins();
    return this.reset();
  }

  /**
   * The BREAK key: the CPU's reset sequence. The VIAs keep their registers,
   * which is how the MOS knows it's a BREAK (Stage 23). The 1 MHz bus cards
   * are reset too (see the Stage 27 doc's Gotchas). The trace and the frame
   * budget start again; the reset's 7 cycles pass for the devices.
   */
  reset(): number {
    for (let i = 0; i < this.cards.length; i++) this.cards[i]?.reset();
    this.trace.clear();
    this.budget = 0;
    this.syncIrq();
    const cycles = this.cpu.reset();
    this.tick(cycles);
    this.syncIrq();
    return cycles;
  }

  /**
   * The BREAK key as a switch (Stage 36). Pressing it holds the CPU in
   * reset; letting go runs reset() (the CPU's reset sequence). Pressing a
   * held BREAK, or letting go of one that's up, does nothing. reset() is
   * still the quick tap: down and up at once.
   */
  setBreak(down: boolean): void {
    if (down === this.breakDown) return;
    this.breakDown = down;
    if (!down) this.reset();
  }

  /** Is BREAK held down (/RES low)? */
  get breakHeld(): boolean {
    return this.breakDown;
  }

  /** One pulse on /NMI (asserted then released): one falling edge for the CPU's latch. */
  pulseNmi(): void {
    this.cpu.setNmi(true);
    this.cpu.setNmi(false);
  }

  // ── The System VIA's pins ──────────────────────────────────────────────

  /**
   * The System VIA calls this when its pins change. Port B's low four lines
   * are IC32's inputs. Either port may change the keyboard's answer: port A
   * carries the key number, and latch bit 3 says whether the CPU is asking.
   */
  pinsChanged(port: ViaPort, pins: number): void {
    if (port === 'b') this.latch.drive(pins);
    this.answerKeyboard();
  }

  /**
   * The latch sees PB0-PB3 as they are now, whether or not they just
   * changed: at power-on they float high (&F), so bit 7 is set before the
   * MOS runs at all.
   */
  private latchFollowsPins(): void {
    this.latch.drive(this.systemVia.pins('b'));
    this.answerKeyboard();
  }

  /**
   * The keyboard sees latch bit 3 (autoscan) and port A. With autoscan off
   * its counter follows PA0-PA3 (and CA2 may change with it, Stage 35). It
   * drives PA7: high if the key on PA0-PA6 is down. Only PA7: the other
   * lines keep whatever else pulls them (a VIA panel button). Setting it
   * calls pinsChanged again; the key number is the same, so the answer is
   * too, and it settles.
   */
  private answerKeyboard(): void {
    const autoscan = this.latch.bit(LATCH_KEYBOARD_ENABLE) === 1;
    const pins = this.systemVia.pins('a');
    this.keyboard.setAutoscan(autoscan);
    this.keyboard.selectColumn(pins);
    const down = this.keyboard.pa7(pins, autoscan) === 1;
    const others = this.systemVia.outside('a') & ~PA7 & 0xff;
    this.systemVia.setOutside('a', down ? others | PA7 : others);
  }

  // ── VSYNC to CA1 ───────────────────────────────────────────────────────

  /**
   * The wire from the CRTC's VSYNC to the System VIA's CA1 (Stage 38). Cut,
   * CA1 is left high and nothing interrupts at 50 Hz: for showing what
   * vsync is for, and for the playground, where the VIA panel's CA1 button
   * needs the pin to itself. Joined again, CA1 takes VSYNC's level.
   */
  get vsyncWired(): boolean {
    return this.vsyncToCa1;
  }

  set vsyncWired(on: boolean) {
    this.vsyncToCa1 = on;
    // A cut wire floats high, like the fake vsync's idle level (Stage 29).
    const level = this.crtc.vsync ? 1 : 0;
    this.systemVia.setControlLine('ca1', on ? level : 1);
  }

  // ── The lock LEDs ──────────────────────────────────────────────────────

  /** Is the CAPS LOCK LED lit? IC32 bit 6, active low (Advanced User Guide, addressable latch). */
  get capsLockLed(): boolean {
    return this.latch.bit(LATCH_CAPS_LOCK_LED) === 0;
  }

  /** Is the SHIFT LOCK LED lit? IC32 bit 7, active low. */
  get shiftLockLed(): boolean {
    return this.latch.bit(LATCH_SHIFT_LOCK_LED) === 0;
  }

  /** The last byte on the data bus: what a read nobody answers sees. */
  get dataBus(): number {
    return this.map.dataBus;
  }

  // ── The IRQ line ───────────────────────────────────────────────────────

  /** The wire-OR, worked out now: is any source holding /IRQ low? */
  get irqLine(): boolean {
    const sources = this.irqSources;
    for (let i = 0; i < sources.length; i++) if (sources[i]?.irq) return true;
    return false;
  }

  /** Who is holding /IRQ, by name. Allocates: for panels and demos, not the hot path. */
  get irqHolders(): readonly string[] {
    const holders: string[] = [];
    this.irqSources.forEach((source, i) => {
      if (source.irq) holders.push(this.irqNames[i] ?? '?');
    });
    return holders;
  }

  /** Is the CPU's NMI edge latch set? */
  get nmiPending(): boolean {
    return this.cpu.nmiPending;
  }

  /** What the next step() will do instead of an instruction, if anything. Nothing while BREAK holds the CPU. */
  get pendingInterrupt(): InterruptKind | undefined {
    if (this.breakDown) return undefined;
    this.syncIrq();
    return this.cpu.pendingInterrupt;
  }

  // ── For the debugger ───────────────────────────────────────────────────

  get registers(): Readonly<Registers> {
    return this.cpu.regs;
  }

  /** CPU cycles since the machine was made, resets included. */
  get cycles(): number {
    return this.cpu.cycles;
  }

  /** The CPU's bus writes since the log was last cleared. */
  get writes(): WriteLog {
    return this.recorder;
  }

  /** The byte at address, with no side effects. */
  peek(address: number): number {
    return this.map.peek(address & 0xffff);
  }

  /** A tool's write: RAM, the ROM images (an EPROM programmer), or a device register. */
  poke(address: number, value: number): void {
    this.map.poke(address & 0xffff, value & 0xff);
  }

  private tick(cycles: number): void {
    const devices = this.clocked;
    for (let i = 0; i < devices.length; i++) devices[i]?.tick(cycles);
  }

  /** Copies the wire-OR to the CPU's /IRQ pin. */
  private syncIrq(): void {
    this.cpu.irq = this.irqLine;
  }
}
