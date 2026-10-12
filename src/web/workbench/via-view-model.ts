// What the VIA panel shows, worked out without the DOM so Jest can test it:
//   - all 16 registers, with what a CPU read would return now (peek: no side
//     effects) and whether each one is built yet;
//   - a bit grid for each port: per line, its direction, the output register
//     bit, what the outside does, the pin level, and what the CPU reads;
//   - the two timers (Stage 25): counter, latch, mode, and flag;
//   - the interrupt sources (Stage 26): each IFR bit's flag and IER enable,
//     and what the Model B wires to it; the four control lines' modes and levels.

import type { ControlLine, Level, ViaPort, ViaTimers } from '../../devices/via6522';
import { C2_MODE, IFR_T1, IFR_T2, PCR_CA1_POSITIVE, PCR_CB1_POSITIVE, VIA_ACR, VIA_IER, VIA_IFR, VIA_ORA, VIA_ORB, VIA_PCR, VIA_SR } from '../../devices/via6522';
import { VIA_REGISTERS } from '../../memory/sheila';
import { hex16, hex8 } from '../../util/bits';

/** The System VIA's registers start here (Advanced User Guide, SHEILA address list). */
export const SYSTEM_VIA_BASE = 0xfe40;
/** The User VIA's registers start here. */
export const USER_VIA_BASE = 0xfe60;

/** The parts of a Via6522 the panel reads. */
export interface ViaSource {
  peek(offset: number): number;
  outputRegister(port: ViaPort): number;
  dataDirection(port: ViaPort): number;
  outside(port: ViaPort): number;
  pins(port: ViaPort): number;
  timers(): ViaTimers;
  controlLine(line: ControlLine): Level;
}

/** The part of a Via6522 the panel's control-line buttons change. */
export interface ViaControlLines {
  controlLine(line: ControlLine): Level;
  setControlLine(line: ControlLine, level: Level): void;
}

/** The part of a Via6522 the panel's "pull low" buttons change. */
export interface ViaOutside {
  outside(port: ViaPort): number;
  setOutside(port: ViaPort, value: number): void;
}

export interface ViaChoice {
  /** e.g. "User VIA". */
  readonly name: string;
  /** The address of register 0, e.g. &FE60. */
  readonly base: number;
  readonly via: ViaSource;
}

export interface ViaRegisterRow {
  readonly number: number;
  /** e.g. "&FE62". */
  readonly address: string;
  /** e.g. "DDRB". */
  readonly name: string;
  /** What a CPU read would return now, e.g. "&F5". */
  readonly value: string;
  /** The same, in binary: "1111 0101". */
  readonly binary: string;
  /** "built", or which stage replaces the stub. */
  readonly status: string;
  readonly isStub: boolean;
}

export type Bit = 0 | 1;

export interface ViaLine {
  /** e.g. "PB3". */
  readonly name: string;
  readonly isOutput: boolean;
  /** The output register's bit. */
  readonly or: Bit;
  /** 0 = the outside pulls this line low. */
  readonly outside: Bit;
  /** The level on the line. */
  readonly pin: Bit;
  /** What the CPU reads for this bit. */
  readonly read: Bit;
  /** Where that read comes from: port B outputs read the register, everything else the pin. */
  readonly readFrom: 'register' | 'pin';
  /** The bit number, 0-7. */
  readonly bit: number;
  /** PB7 only: Timer 1 drives it (ACR bit 7), so it's an output whatever DDRB says. */
  readonly timer1: boolean;
}

export interface ViaPortView {
  readonly port: ViaPort;
  /** "Port A". */
  readonly label: string;
  /** The output register's name: "ORA". */
  readonly orName: string;
  /** "DDRA". */
  readonly ddrName: string;
  /** What a CPU read is called: "IRA". */
  readonly readName: string;
  /** Lines from bit 7 down to bit 0, the way a byte is written. */
  readonly lines: readonly ViaLine[];
  readonly hex: { readonly ddr: string; readonly or: string; readonly outside: string; readonly pins: string; readonly read: string };
}

export interface ViaTimerRow {
  readonly name: 'T1' | 'T2';
  /** e.g. "&270E". */
  readonly counter: string;
  /** e.g. "9,998": one count is 1 µs on the Model B. */
  readonly decimal: string;
  /** T1: "&270E". T2 has a low latch only: "&xx34". */
  readonly latch: string;
  /** "free-running", "one-shot", or T2's "counts PB6 pulses (not built: holds)". */
  readonly mode: string;
  /** Will the next timeout set the flag? */
  readonly armed: boolean;
  /** Is its IFR bit set? */
  readonly flag: boolean;
  /** Its IFR bit: 6 or 5. */
  readonly flagBit: number;
  /** How full the counter is, 0..1, for the panel's bar: T1 against its latch, T2 against &FFFF. */
  readonly fraction: number;
  /** T1 with ACR bit 7: "PB7 = 1 (square wave)". Otherwise "". */
  readonly pb7: string;
}

/** One IFR/IER bit. */
export interface ViaInterruptRow {
  readonly bit: number;
  /** "T1", "CA1", … */
  readonly name: 'T1' | 'T2' | 'CB1' | 'CB2' | 'SR' | 'CA1' | 'CA2';
  /** What sets the flag: "Timer 1 ran out", "an edge on CA1". */
  readonly source: string;
  /** On this Model B VIA: "vertical sync (6845 CRTC)", or "" if nothing is. */
  readonly wiredTo: string;
  readonly flag: Bit;
  readonly enabled: Bit;
  /** Flag and enable both set: this source is pulling /IRQ low. */
  readonly firing: boolean;
  /** The shift register isn't built, so its bit never sets. */
  readonly isBuilt: boolean;
}

export interface ViaControlLineView {
  readonly line: ControlLine;
  /** "CA1". */
  readonly name: string;
  /** From the PCR, e.g. "input: flags a falling edge", "output: handshake". */
  readonly mode: string;
  readonly isInput: boolean;
  /** The level on the line now. */
  readonly level: Bit;
  /** On this Model B VIA: "keyboard", "printer strobe", "user port". */
  readonly wiredTo: string;
}

export interface ViaView {
  readonly name: string;
  /** e.g. "&FE60-&FE6F". */
  readonly range: string;
  readonly registers: readonly ViaRegisterRow[];
  /** Port A, then port B. */
  readonly ports: readonly [ViaPortView, ViaPortView];
  /** T1, then T2. */
  readonly timers: readonly [ViaTimerRow, ViaTimerRow];
  /** IFR as a CPU read sees it, e.g. "&40". */
  readonly ifr: string;
  /** IER as a CPU read sees it: bit 7 always 1, e.g. "&C2". */
  readonly ier: string;
  /** IFR bits 6 down to 0. */
  readonly interrupts: readonly ViaInterruptRow[];
  /** CA1, CA2, CB1, CB2. */
  readonly controlLines: readonly ViaControlLineView[];
  /** Is this VIA pulling /IRQ low? */
  readonly irq: boolean;
}

/** What the Model B connects to each control line (Advanced User Guide; BeebWiki, System VIA / User VIA). */
const SYSTEM_VIA_WIRING: Readonly<Record<ControlLine, string>> = {
  ca1: 'vertical sync (6845 CRTC)',
  ca2: 'keyboard',
  cb1: 'ADC end of conversion',
  cb2: 'light pen strobe',
};
const USER_VIA_WIRING: Readonly<Record<ControlLine, string>> = {
  ca1: 'printer acknowledge',
  ca2: 'printer strobe',
  cb1: 'user port',
  cb2: 'user port',
};

function wiringFor(base: number): Readonly<Record<ControlLine, string>> {
  return base === SYSTEM_VIA_BASE ? SYSTEM_VIA_WIRING : USER_VIA_WIRING;
}

/** IFR bits 6-0, in the order the panel lists them. */
const INTERRUPT_SOURCES = [
  { bit: 6, name: 'T1', source: 'Timer 1 ran out', line: undefined },
  { bit: 5, name: 'T2', source: 'Timer 2 ran out', line: undefined },
  { bit: 4, name: 'CB1', source: 'an edge on CB1', line: 'cb1' },
  { bit: 3, name: 'CB2', source: 'an edge on CB2', line: 'cb2' },
  { bit: 2, name: 'SR', source: '8 bits shifted (not built)', line: undefined },
  { bit: 1, name: 'CA1', source: 'an edge on CA1', line: 'ca1' },
  { bit: 0, name: 'CA2', source: 'an edge on CA2', line: 'ca2' },
] as const;

/** The CA2/CB2 modes in words (6522 datasheet, PCR). */
function c2ModeText(mode: number): string {
  switch (mode) {
    case C2_MODE.inputNegative:
      return 'input: flags a falling edge';
    case C2_MODE.independentNegative:
      return 'input: flags a falling edge (independent)';
    case C2_MODE.inputPositive:
      return 'input: flags a rising edge';
    case C2_MODE.independentPositive:
      return 'input: flags a rising edge (independent)';
    case C2_MODE.handshake:
      return 'output: handshake';
    case C2_MODE.pulse:
      return 'output: pulse';
    case C2_MODE.low:
      return 'output: held low';
    default:
      return 'output: held high';
  }
}

function controlLineViews(via: ViaSource, wiring: Readonly<Record<ControlLine, string>>): ViaControlLineView[] {
  const pcr = via.peek(VIA_PCR);
  const c1 = (positive: boolean): string => `input: flags a ${positive ? 'rising' : 'falling'} edge`;
  const ca2 = (pcr >> 1) & 0b111;
  const cb2 = (pcr >> 5) & 0b111;
  const view = (line: ControlLine, mode: string, isInput: boolean): ViaControlLineView => ({
    line,
    name: line.toUpperCase(),
    mode,
    isInput,
    level: via.controlLine(line),
    wiredTo: wiring[line],
  });
  return [
    view('ca1', c1((pcr & PCR_CA1_POSITIVE) !== 0), true),
    view('ca2', c2ModeText(ca2), ca2 < C2_MODE.handshake),
    view('cb1', c1((pcr & PCR_CB1_POSITIVE) !== 0), true),
    view('cb2', c2ModeText(cb2), cb2 < C2_MODE.handshake),
  ];
}

function interruptRows(via: ViaSource, wiring: Readonly<Record<ControlLine, string>>): ViaInterruptRow[] {
  const ifr = via.peek(VIA_IFR);
  const ier = via.peek(VIA_IER);
  return INTERRUPT_SOURCES.map((s): ViaInterruptRow => {
    const flag = bitOf(ifr, s.bit);
    const enabled = bitOf(ier, s.bit);
    return {
      bit: s.bit,
      name: s.name,
      source: s.source,
      wiredTo: s.line === undefined ? '' : wiring[s.line],
      flag,
      enabled,
      firing: flag === 1 && enabled === 1,
      isBuilt: s.name !== 'SR',
    };
  });
}

/** Where each register stands in this build. */
function registerStatus(n: number): string {
  if (n === VIA_SR) return 'stub (shift register not planned)';
  if (n === VIA_ACR) return 'built, except the shift register modes (bits 4-2)';
  return 'built';
}

/** The registers that are only storage. */
function isStubRegister(n: number): boolean {
  return n === VIA_SR;
}

/** "1111 0101". */
export function binaryNibbles(value: number): string {
  const bits = (value & 0xff).toString(2).padStart(8, '0');
  return `${bits.slice(0, 4)} ${bits.slice(4)}`;
}

function bitOf(value: number, n: number): Bit {
  return (value >> n) & 1 ? 1 : 0;
}

function portView(via: ViaSource, port: ViaPort): ViaPortView {
  const letter = port.toUpperCase();
  const t1 = via.timers().t1;
  // Timer 1 on PB7 (ACR bit 7): an output, carrying T1's level instead of ORB bit 7.
  const timerOnPb7 = port === 'b' && t1.drivesPb7;
  const ddr = via.dataDirection(port) | (timerOnPb7 ? 0x80 : 0);
  const or = timerOnPb7 ? (via.outputRegister(port) & 0x7f) | (t1.pb7 << 7) : via.outputRegister(port);
  const outside = via.outside(port);
  const pins = via.pins(port);
  const read = via.peek(port === 'a' ? VIA_ORA : VIA_ORB);
  const lines: ViaLine[] = [];
  for (let n = 7; n >= 0; n--) {
    const isOutput = bitOf(ddr, n) === 1;
    lines.push({
      name: `P${letter}${String(n)}`,
      isOutput,
      or: bitOf(or, n),
      outside: bitOf(outside, n),
      pin: bitOf(pins, n),
      read: bitOf(read, n),
      readFrom: port === 'b' && isOutput ? 'register' : 'pin',
      bit: n,
      timer1: timerOnPb7 && n === 7,
    });
  }
  return {
    port,
    label: `Port ${letter}`,
    orName: `OR${letter}`,
    ddrName: `DDR${letter}`,
    readName: `IR${letter}`,
    lines,
    hex: { ddr: `&${hex8(via.dataDirection(port))}`, or: `&${hex8(via.outputRegister(port))}`, outside: `&${hex8(outside)}`, pins: `&${hex8(pins)}`, read: `&${hex8(read)}` },
  };
}

function timerRows(via: ViaSource): [ViaTimerRow, ViaTimerRow] {
  const { t1, t2, ifr } = via.timers();
  const t1Pb7 = t1.drivesPb7 ? `PB7 = ${String(t1.pb7)} (${t1.freeRun ? 'square wave' : 'low until it runs out'})` : '';
  return [
    {
      name: 'T1',
      counter: `&${hex16(t1.counter)}`,
      decimal: t1.counter.toLocaleString('en-GB'),
      latch: `&${hex16(t1.latch)}`,
      mode: t1.freeRun ? 'free-running' : 'one-shot',
      armed: t1.armed,
      flag: (ifr & IFR_T1) !== 0,
      flagBit: 6,
      fraction: t1.latch === 0 ? 0 : Math.min(1, t1.counter / t1.latch),
      pb7: t1Pb7,
    },
    {
      name: 'T2',
      counter: `&${hex16(t2.counter)}`,
      decimal: t2.counter.toLocaleString('en-GB'),
      latch: `&xx${hex8(t2.latchLow)}`,
      mode: t2.pulseCounting ? 'counts PB6 pulses (not built: holds)' : 'one-shot',
      armed: t2.armed,
      flag: (ifr & IFR_T2) !== 0,
      flagBit: 5,
      fraction: t2.counter / 0xffff,
      pb7: '',
    },
  ];
}

export function buildViaView(choice: ViaChoice): ViaView {
  const registers = VIA_REGISTERS.map((name, n): ViaRegisterRow => {
    const value = choice.via.peek(n);
    const status = registerStatus(n);
    return {
      number: n,
      address: `&${hex16(choice.base + n)}`,
      name,
      value: `&${hex8(value)}`,
      binary: binaryNibbles(value),
      status,
      isStub: isStubRegister(n),
    };
  });
  return {
    name: choice.name,
    range: `&${hex16(choice.base)}-&${hex16(choice.base + 0x0f)}`,
    registers,
    ports: [portView(choice.via, 'a'), portView(choice.via, 'b')],
    timers: timerRows(choice.via),
    ifr: `&${hex8(choice.via.peek(VIA_IFR))}`,
    ier: `&${hex8(choice.via.peek(VIA_IER))}`,
    interrupts: interruptRows(choice.via, wiringFor(choice.base)),
    controlLines: controlLineViews(choice.via, wiringFor(choice.base)),
    irq: (choice.via.peek(VIA_IFR) & 0x80) !== 0,
  };
}

/** The panel's control-line button: pulls the line low, or lets it go back high. Pulling it low is a falling edge. */
export function toggleControlLine(via: ViaControlLines, line: ControlLine): void {
  via.setControlLine(line, via.controlLine(line) === 0 ? 1 : 0);
}

/** The panel's pull-low button: flips whether the outside pulls line `bit` low. */
export function toggleOutsideBit(via: ViaOutside, port: ViaPort, bit: number): void {
  via.setOutside(port, via.outside(port) ^ (1 << (bit & 7)));
}
