// What the VIA panel shows, worked out without the DOM so Jest can test it:
//   - all 16 registers, with what a CPU read would return now (peek: no side
//     effects) and whether each one is built yet;
//   - a bit grid for each port: per line, its direction, the output register
//     bit, what the outside does, the pin level, and what the CPU reads.

import type { ViaPort } from '../../devices/via6522';
import { VIA_ACR, VIA_DDRA, VIA_ORA, VIA_ORA_NO_HANDSHAKE, VIA_ORB, VIA_PCR, VIA_SR } from '../../devices/via6522';
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

export interface ViaView {
  readonly name: string;
  /** e.g. "&FE60-&FE6F". */
  readonly range: string;
  readonly registers: readonly ViaRegisterRow[];
  /** Port A, then port B. */
  readonly ports: readonly [ViaPortView, ViaPortView];
}

/** Where each register stands in this build. */
function registerStatus(n: number): string {
  if (n <= VIA_DDRA || n === VIA_ORA_NO_HANDSHAKE) return 'built';
  if (n === VIA_SR) return 'stub (shift register not planned)';
  if (n < VIA_SR || n === VIA_ACR) return 'stub until Stage 25';
  if (n >= VIA_PCR) return 'stub until Stage 26';
  return 'stub';
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
  const ddr = via.dataDirection(port);
  const or = via.outputRegister(port);
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
    });
  }
  return {
    port,
    label: `Port ${letter}`,
    orName: `OR${letter}`,
    ddrName: `DDR${letter}`,
    readName: `IR${letter}`,
    lines,
    hex: { ddr: `&${hex8(ddr)}`, or: `&${hex8(or)}`, outside: `&${hex8(outside)}`, pins: `&${hex8(pins)}`, read: `&${hex8(read)}` },
  };
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
      isStub: status !== 'built',
    };
  });
  return {
    name: choice.name,
    range: `&${hex16(choice.base)}-&${hex16(choice.base + 0x0f)}`,
    registers,
    ports: [portView(choice.via, 'a'), portView(choice.via, 'b')],
  };
}

/** The panel's pull-low button: flips whether the outside pulls line `bit` low. */
export function toggleOutsideBit(via: ViaOutside, port: ViaPort, bit: number): void {
  via.setOutside(port, via.outside(port) ^ (1 << (bit & 7)));
}
