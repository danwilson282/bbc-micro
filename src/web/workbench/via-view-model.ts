// What the VIA panel shows, worked out without the DOM so Jest can test it:
//   - all 16 registers, with what a CPU read would return now (peek: no side
//     effects) and whether each one is built yet;
//   - a bit grid for each port: per line, its direction, the output register
//     bit, what the outside does, the pin level, and what the CPU reads;
//   - the two timers (Stage 25): counter, latch, mode, and flag.

import type { ViaPort, ViaTimers } from '../../devices/via6522';
import { IFR_T1, IFR_T2, VIA_ACR, VIA_IFR, VIA_ORA, VIA_ORB, VIA_PCR, VIA_IER, VIA_SR } from '../../devices/via6522';
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
}

/** Where each register stands in this build. */
function registerStatus(n: number): string {
  if (n === VIA_SR) return 'stub (shift register not planned)';
  if (n === VIA_ACR) return 'bits 7-5 built; input latching in Stage 26';
  if (n === VIA_IFR) return 'timer bits 6 and 5 built; the rest in Stage 26';
  if (n === VIA_PCR || n === VIA_IER) return 'stub until Stage 26';
  return 'built';
}

/** The registers that are only storage. */
function isStubRegister(n: number): boolean {
  return n === VIA_SR || n === VIA_PCR || n === VIA_IER;
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
  };
}

/** The panel's pull-low button: flips whether the outside pulls line `bit` low. */
export function toggleOutsideBit(via: ViaOutside, port: ViaPort, bit: number): void {
  via.setOutside(port, via.outside(port) ^ (1 << (bit & 7)));
}
