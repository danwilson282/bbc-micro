// SHEILA (&FE00-&FEFF): the Model B's own I/O chips, slot by slot.
//
// The board cuts page &FE into slots and switches on one chip per slot
// (Advanced User Guide, the SHEILA address list). A chip only sees its own
// register-select lines, so its registers repeat across the slot: the 6522
// has 16 registers (RS0-RS3 = A0-A3) in a 32-byte slot, so &FE4E and &FE5E
// are both System VIA register 14. The register counts come from each chip's
// datasheet. The mirroring assumes each chip sees only its own select lines
// (unconfirmed against the circuit diagram, except for the VIAs).

import { hex16 } from '../util/bits';
import { FRED_START, JIM_START, SHEILA_START } from './memory-regions';

export type SheilaSlotId =
  | 'crtc'
  | 'acia'
  | 'serialUla'
  | 'econetId'
  | 'videoUla'
  | 'romsel'
  | 'systemVia'
  | 'userVia'
  | 'fdc'
  | 'adlc'
  | 'adc'
  | 'tube';

export interface SheilaSlot {
  readonly id: SheilaSlotId;
  /** First offset in page &FE: the slot starts at &FE00 + start. */
  readonly start: number;
  /** Bytes in the slot. */
  readonly size: number;
  /** Short name for logs, e.g. "System VIA". */
  readonly name: string;
  /** The chip, e.g. "6522 VIA". */
  readonly chip: string;
  /** One name per register. The length is a power of two: offset & (length - 1) picks one. */
  readonly registers: readonly string[];
  /** Where the real device comes from. */
  readonly builtIn: string;
}

/** The 6522's 16 registers, by RS3-RS0 (6522 datasheet, register select table). */
export const VIA_REGISTERS: readonly string[] = [
  'ORB/IRB',
  'ORA/IRA',
  'DDRB',
  'DDRA',
  'T1C-L',
  'T1C-H',
  'T1L-L',
  'T1L-H',
  'T2C-L',
  'T2C-H',
  'SR',
  'ACR',
  'PCR',
  'IFR',
  'IER',
  'ORA/IRA, no handshake',
];

/** Every SHEILA slot, in address order, covering &FE00-&FEFF with no gaps. */
export const SHEILA_SLOTS: readonly SheilaSlot[] = [
  { id: 'crtc', start: 0x00, size: 0x08, name: 'CRTC', chip: '6845 CRTC', registers: ['address register', 'register data'], builtIn: 'Stage 37' },
  { id: 'acia', start: 0x08, size: 0x08, name: 'ACIA', chip: '6850 ACIA (serial, cassette)', registers: ['status / control', 'data'], builtIn: 'out of scope' },
  { id: 'serialUla', start: 0x10, size: 0x08, name: 'Serial ULA', chip: 'Serial ULA', registers: ['control'], builtIn: 'out of scope' },
  { id: 'econetId', start: 0x18, size: 0x08, name: 'Econet ID', chip: 'Econet station ID links', registers: ['station number / INTOFF'], builtIn: 'out of scope' },
  { id: 'videoUla', start: 0x20, size: 0x10, name: 'Video ULA', chip: 'Video ULA', registers: ['video control', 'palette'], builtIn: 'Stage 40' },
  { id: 'romsel', start: 0x30, size: 0x10, name: 'ROMSEL', chip: 'paged ROM select latch', registers: ['paged ROM select'], builtIn: 'Stage 22' },
  { id: 'systemVia', start: 0x40, size: 0x20, name: 'System VIA', chip: '6522 VIA', registers: VIA_REGISTERS, builtIn: 'Stages 24-28' },
  { id: 'userVia', start: 0x60, size: 0x20, name: 'User VIA', chip: '6522 VIA', registers: VIA_REGISTERS, builtIn: 'Stage 24 (as a 6522)' },
  {
    id: 'fdc',
    start: 0x80,
    size: 0x20,
    name: '8271 FDC',
    chip: '8271 floppy disc controller',
    registers: ['status / command', 'result / parameter', 'reset', 'illegal', 'data', 'data', 'data', 'data'],
    builtIn: 'Stages 49-50',
  },
  { id: 'adlc', start: 0xa0, size: 0x20, name: 'ADLC', chip: '68B54 ADLC (Econet)', registers: ['CR1 / SR1', 'CR2 / SR2', 'TX / RX FIFO', 'CR3, CR4 / RX FIFO'], builtIn: 'out of scope' },
  { id: 'adc', start: 0xc0, size: 0x20, name: 'ADC', chip: 'µPD7002 ADC (joysticks)', registers: ['status / start conversion', 'high byte', 'low byte', 'test'], builtIn: 'not planned' },
  { id: 'tube', start: 0xe0, size: 0x20, name: 'Tube', chip: 'Tube ULA (second processor)', registers: ['R1 status', 'R1 data', 'R2 status', 'R2 data', 'R3 status', 'R3 data', 'R4 status', 'R4 data'], builtIn: 'out of scope' },
];

/** Index into SHEILA_SLOTS of the slot holding SHEILA offset (address & 0xff). */
export function sheilaSlotIndex(offset: number): number {
  const o = offset & 0xff;
  return SHEILA_SLOTS.findIndex((slot) => o >= slot.start && o < slot.start + slot.size);
}

/** The register a SHEILA offset reaches inside its slot: the mirrors fold onto 0..registers-1. */
export function sheilaRegister(slot: SheilaSlot, offset: number): number {
  return ((offset & 0xff) - slot.start) & (slot.registers.length - 1);
}

/** What an I/O address is, in words. */
export interface IoDescription {
  readonly page: 'FRED' | 'JIM' | 'SHEILA';
  /** The SHEILA slot, or undefined for FRED and JIM (nothing connected). */
  readonly slot: SheilaSlot | undefined;
  /** Register number inside the device, or undefined for FRED and JIM. */
  readonly register: number | undefined;
  /** The first address in the slot that reaches the same register, e.g. &FE4E for &FE5E. */
  readonly canonical: number;
  /** e.g. "System VIA reg 14 (IER), mirror of &FE4E". */
  readonly text: string;
}

/**
 * Names an address in &FC00-&FEFF, for logs and the workbench. Not on the hot
 * path: the I/O log stores numbers and calls this only when it's drawn.
 * Addresses outside the I/O pages throw RangeError.
 */
export function describeIoAddress(address: number): IoDescription {
  const a = address & 0xffff;
  if (a >= FRED_START && a < SHEILA_START) {
    const page = a < JIM_START ? 'FRED' : 'JIM';
    return { page, slot: undefined, register: undefined, canonical: a, text: `${page} (1 MHz bus: nothing connected)` };
  }
  if (a < SHEILA_START || a > 0xfeff) throw new RangeError(`&${hex16(a)} is not an I/O address (&FC00-&FEFF)`);
  const index = sheilaSlotIndex(a);
  if (index < 0) throw new RangeError(`no SHEILA slot holds &${hex16(a)}`); // can't happen: the table has no gaps
  const slot = SHEILA_SLOTS[index];
  const register = sheilaRegister(slot, a);
  const canonical = SHEILA_START + slot.start + register;
  const name = slot.registers[register] ?? '?';
  const base = slot.registers.length === 1 ? `${slot.name} (${name})` : `${slot.name} reg ${String(register)} (${name})`;
  const text = canonical === a ? base : `${base}, mirror of &${hex16(canonical)}`;
  return { page: 'SHEILA', slot, register, canonical, text };
}
