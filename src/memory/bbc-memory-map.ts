// The Model B's address decoding: which part of the machine answers each
// address the CPU puts on the bus.
//
//   &0000-&7FFF  RAM (32K)
//   &8000-&BFFF  sideways ROM: one of 16 slots, picked by ROMSEL (&FE30).
//                An empty slot floats.
//   &C000-&FBFF  MOS ROM ┐ one 16K image; the CPU's writes are lost
//   &FF00-&FFFF  MOS ROM ┘
//   &FC00-&FCFF  FRED    1 MHz bus, nothing connected
//   &FD00-&FDFF  JIM     1 MHz bus, nothing connected
//   &FE00-&FEFF  SHEILA  dispatched to the chip in each slot (sheila.ts)
//
// Every CPU access to &FC00-&FEFF goes into the I/O log.
//
// Two kinds of access:
//   read()/write()  what the CPU does. A read may have side effects on a device.
//   peek()/poke()   what tools do (debugger, program loader). peek has no side
//                   effects; poke writes into the ROM image, like an EPROM
//                   programmer. Neither is logged, or changes the floating bus.
//
// read() and write() run on every bus cycle, so they're a few comparisons
// and array lookups. SHEILA's decoding is done once, in the constructor, into
// three 256-entry tables.

import type { Bus } from './bus';
import type { IoDevice } from './io-device';
import { IoLog } from './io-log';
import { FRED_START, MOS_START, MOS_TOP_PAGE, RAM_SIZE, ROM_SIZE, SHEILA_START, SIDEWAYS_START } from './memory-regions';
import { PlaceholderDevice, type DataBus } from './placeholder-device';
import { Ram } from './ram';
import { RomSelect } from './rom-select';
import { SHEILA_SLOTS, sheilaRegister, type SheilaSlotId } from './sheila';

/** What an erased EPROM reads, and so what a blank ROM image holds. */
const BLANK_ROM_BYTE = 0xff;

/** How many sideways ROM slots ROMSEL can pick from: its 4 bits. */
export const SIDEWAYS_SLOTS = 16;

/** SHEILA slots that can be given a device. ROMSEL is always the map's own latch: the two work as a pair. */
export type PluggableSlotId = Exclude<SheilaSlotId, 'romsel'>;

export interface BbcMemoryMapOptions {
  /** Real devices for some SHEILA slots. The rest get a PlaceholderDevice. */
  readonly devices?: Partial<Readonly<Record<PluggableSlotId, IoDevice>>>;
}

export class BbcMemoryMap implements Bus, DataBus {
  readonly ioLog = new IoLog();
  /** The device in each SHEILA slot, by id: a real one, or a placeholder. */
  readonly devices: Readonly<Record<SheilaSlotId, IoDevice>>;
  /** The paged ROM select latch, also devices.romsel. */
  readonly romSelect: RomSelect;

  private readonly ram = new Ram(RAM_SIZE);
  /** The MOS ROM: &C000-&FFFF, with &FC00-&FEFF hidden under the I/O pages. */
  private mos: Uint8Array = new Uint8Array(ROM_SIZE).fill(BLANK_ROM_BYTE);
  /** The 16 sideways slots: a 16K image, or undefined for an empty socket. */
  private readonly sideways: (Uint8Array | undefined)[] = new Array<Uint8Array | undefined>(SIDEWAYS_SLOTS).fill(undefined);
  /**
   * The image in the slot ROMSEL points at, or undefined if that slot is empty.
   * Swapped on a ROMSEL write (rare), so a read of &8000-&BFFF (common) is one lookup.
   */
  private paged: Uint8Array | undefined;
  /** For each SHEILA offset &00-&FF: its device, the register it reaches, and its slot's index. */
  private readonly sheilaDevice: readonly IoDevice[];
  private readonly sheilaRegister = new Uint8Array(0x100);
  private readonly sheilaSlot = new Uint8Array(0x100);
  /** Reads and writes per SHEILA slot. Float64: a Uint32 could wrap in a long run. */
  private readonly reads = new Float64Array(SHEILA_SLOTS.length);
  private readonly writes = new Float64Array(SHEILA_SLOTS.length);
  private lastByte = BLANK_ROM_BYTE;

  constructor(options: BbcMemoryMapOptions = {}) {
    const given = options.devices ?? {};
    const fit = (id: PluggableSlotId): IoDevice => given[id] ?? new PlaceholderDevice(SHEILA_SLOTS.find((s) => s.id === id)?.chip ?? id, this);
    this.romSelect = new RomSelect(this, (slot) => {
      this.paged = this.sideways[slot];
    });
    // Spelled out, so the type checker knows every slot has a device.
    this.devices = {
      crtc: fit('crtc'),
      acia: fit('acia'),
      serialUla: fit('serialUla'),
      econetId: fit('econetId'),
      videoUla: fit('videoUla'),
      romsel: this.romSelect,
      systemVia: fit('systemVia'),
      userVia: fit('userVia'),
      fdc: fit('fdc'),
      adlc: fit('adlc'),
      adc: fit('adc'),
      tube: fit('tube'),
    };
    const table: IoDevice[] = [];
    SHEILA_SLOTS.forEach((slot, index) => {
      for (let o = slot.start; o < slot.start + slot.size; o++) {
        table[o] = this.devices[slot.id];
        this.sheilaRegister[o] = sheilaRegister(slot, o);
        this.sheilaSlot[o] = index;
      }
    });
    this.sheilaDevice = table;
  }

  /**
   * The last byte that crossed the data bus, on any read or write. A read
   * that no chip answers gets this: the "floating" bus. After LDA &FD00
   * fetches its operand, that's &FD.
   */
  get dataBus(): number {
    return this.lastByte;
  }

  /** CPU read cycle: the byte at address & 0xffff. I/O reads are logged and may have side effects. */
  read(address: number): number {
    const a = address & 0xffff;
    let value: number;
    if (a < SIDEWAYS_START) value = this.ram.read(a);
    else if (a < MOS_START) value = this.paged?.[a - SIDEWAYS_START] ?? this.lastByte; // an empty slot floats
    else if (a < FRED_START || a >= MOS_TOP_PAGE) value = this.mos[a - MOS_START] ?? BLANK_ROM_BYTE;
    else value = this.readIo(a);
    this.lastByte = value;
    return value;
  }

  /** CPU write cycle. RAM stores it, ROM ignores it, I/O passes it to the device (and logs it). */
  write(address: number, value: number): void {
    const a = address & 0xffff;
    const v = value & 0xff;
    this.lastByte = v;
    if (a < SIDEWAYS_START) this.ram.write(a, v);
    else if (a >= FRED_START && a < MOS_TOP_PAGE) this.writeIo(a, v);
    // Anything else is ROM or an empty socket: nothing listens.
  }

  /** What read() would return now, with no side effects, no logging and no change to the floating bus. */
  peek(address: number): number {
    const a = address & 0xffff;
    if (a < SIDEWAYS_START) return this.ram.read(a);
    if (a < MOS_START) return this.paged?.[a - SIDEWAYS_START] ?? this.lastByte;
    if (a < FRED_START || a >= MOS_TOP_PAGE) return this.mos[a - MOS_START] ?? BLANK_ROM_BYTE;
    if (a < SHEILA_START) return this.lastByte;
    const o = a & 0xff;
    return this.sheilaDevice[o].peek(this.sheilaRegister[o] ?? 0) & 0xff;
  }

  /**
   * A tool's write: RAM as normal, the ROM *images* (the MOS, or the paged
   * sideways ROM, as an EPROM programmer would), and I/O to the device. Not
   * logged. An empty sideways slot has nothing to write into.
   */
  poke(address: number, value: number): void {
    const a = address & 0xffff;
    const v = value & 0xff;
    if (a < SIDEWAYS_START) this.ram.write(a, v);
    else if (a < MOS_START) {
      if (this.paged !== undefined) this.paged[a - SIDEWAYS_START] = v;
    }
    else if (a < FRED_START || a >= MOS_TOP_PAGE) this.mos[a - MOS_START] = v;
    else if (a >= SHEILA_START) {
      const o = a & 0xff;
      this.sheilaDevice[o].write(this.sheilaRegister[o] ?? 0, v);
    }
  }

  /** The slot ROMSEL last latched, 0-15. The CPU can't read this back (&FE30 is write only); tools can. */
  get pagedRom(): number {
    return this.romSelect.slot;
  }

  /** Fits a 16K MOS image at &C000-&FFFF. Keeps the array, so pokes change it. */
  loadMos(image: Uint8Array): void {
    checkImage(image, 'MOS');
    this.mos = image;
  }

  /**
   * Plugs a 16K image into sideways slot 0-15 (use toRomImage for 8K files).
   * Keeps the array, so pokes change it. If ROMSEL already points at the
   * slot, the CPU sees the ROM at once.
   */
  loadSidewaysRom(slot: number, image: Uint8Array): void {
    checkSlot(slot);
    checkImage(image, `sideways ROM ${String(slot)}`);
    this.sideways[slot] = image;
    if (slot === this.romSelect.slot) this.paged = image;
  }

  /** Empties a sideways slot: it floats from now on. */
  removeSidewaysRom(slot: number): void {
    checkSlot(slot);
    this.sideways[slot] = undefined;
    if (slot === this.romSelect.slot) this.paged = undefined;
  }

  /** The image in a sideways slot, or undefined if it's empty. */
  sidewaysRom(slot: number): Uint8Array | undefined {
    checkSlot(slot);
    return this.sideways[slot];
  }

  /** CPU reads of SHEILA slot `index` (into SHEILA_SLOTS) since the last clearIoHistory(). */
  slotReads(index: number): number {
    return this.reads[index] ?? 0;
  }

  /** CPU writes to SHEILA slot `index` since the last clearIoHistory(). */
  slotWrites(index: number): number {
    return this.writes[index] ?? 0;
  }

  /** Empties the I/O log and the per-slot counts. */
  clearIoHistory(): void {
    this.ioLog.clear();
    this.reads.fill(0);
    this.writes.fill(0);
  }

  private readIo(a: number): number {
    let value = this.lastByte; // FRED and JIM: nothing drives the bus
    if (a >= SHEILA_START) {
      const o = a & 0xff;
      // Every offset has a device (a placeholder at least): the table has no gaps.
      value = this.sheilaDevice[o].read(this.sheilaRegister[o] ?? 0) & 0xff;
      const slot = this.sheilaSlot[o] ?? 0;
      this.reads[slot] = (this.reads[slot] ?? 0) + 1;
    }
    this.ioLog.record(a, value, false);
    return value;
  }

  private writeIo(a: number, v: number): void {
    if (a >= SHEILA_START) {
      const o = a & 0xff;
      this.sheilaDevice[o].write(this.sheilaRegister[o] ?? 0, v);
      const slot = this.sheilaSlot[o] ?? 0;
      this.writes[slot] = (this.writes[slot] ?? 0) + 1;
    }
    this.ioLog.record(a, v, true);
  }
}

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SIDEWAYS_SLOTS) {
    throw new RangeError(`sideways slot ${String(slot)}: there are ${String(SIDEWAYS_SLOTS)}, numbered 0-${String(SIDEWAYS_SLOTS - 1)}`);
  }
}

function checkImage(image: Uint8Array, what: string): void {
  if (image.length !== ROM_SIZE) throw new RangeError(`${what} image is ${String(image.length)} bytes, not 16K (fit 8K files with toRomImage)`);
}
