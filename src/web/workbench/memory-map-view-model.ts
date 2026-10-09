// What the Memory map panel shows, worked out without the DOM so Jest can
// test it:
//   - the regions of the 64K map, with their share of it, and where PC is;
//   - the SHEILA slots, with each one's device and how often the CPU used it;
//   - the I/O log's latest accesses, in words.

import type { IoDevice } from '../../memory/io-device';
import type { IoAccess } from '../../memory/io-log';
import { MEMORY_REGIONS, type RegionId } from '../../memory/memory-regions';
import { PlaceholderDevice } from '../../memory/placeholder-device';
import { SHEILA_SLOTS, describeIoAddress, type SheilaSlotId } from '../../memory/sheila';
import { hex16, hex8 } from '../../util/bits';

/** The parts of a BbcMemoryMap the panel reads. */
export interface MemoryMapSource {
  readonly ioLog: { readonly count: number; recent(count: number): IoAccess[] };
  readonly devices: Readonly<Record<SheilaSlotId, IoDevice>>;
  slotReads(index: number): number;
  slotWrites(index: number): number;
}

export interface RegionRow {
  readonly id: RegionId;
  readonly start: number;
  /** e.g. "&0000-&7FFF". */
  readonly range: string;
  /** e.g. "32K" or "256 bytes". */
  readonly size: string;
  readonly name: string;
  readonly detail: string;
  /** Fraction of the 64K, 0..1. */
  readonly share: number;
  /** Is the CPU's PC in this region? */
  readonly hasPc: boolean;
}

export interface SlotRow {
  readonly id: SheilaSlotId;
  readonly start: number;
  /** e.g. "&FE40-&FE5F". */
  readonly range: string;
  readonly name: string;
  readonly chip: string;
  /** e.g. "16, ×2": registers, and how many times they repeat in the slot. */
  readonly registers: string;
  /** "placeholder (Stage 24)", or "emulated". */
  readonly device: string;
  readonly isPlaceholder: boolean;
  readonly reads: number;
  readonly writes: number;
}

export interface LogRow {
  readonly index: number;
  readonly direction: 'R' | 'W';
  readonly address: string;
  readonly value: string;
  /** e.g. "System VIA reg 4 (T1C-L)". */
  readonly text: string;
}

export interface MemoryMapView {
  readonly regions: readonly RegionRow[];
  readonly slots: readonly SlotRow[];
  readonly log: readonly LogRow[];
  /** A line about the log: how much of it is shown, or why it's empty. */
  readonly logNote: string;
}

/** How many log lines the panel shows by default. */
export const LOG_LINES = 16;

/** "32K" for whole kilobytes, otherwise "256 bytes". */
export function formatSize(bytes: number): string {
  return bytes % 1024 === 0 ? `${String(bytes / 1024)}K` : `${String(bytes)} bytes`;
}

export function buildMemoryMapView(source: MemoryMapSource, options: { readonly pc?: number; readonly logLines?: number } = {}): MemoryMapView {
  const pc = options.pc;
  const regions = MEMORY_REGIONS.map((r): RegionRow => {
    const bytes = r.end - r.start + 1;
    return {
      id: r.id,
      start: r.start,
      range: `&${hex16(r.start)}-&${hex16(r.end)}`,
      size: formatSize(bytes),
      name: r.name,
      detail: r.detail,
      share: bytes / 0x10000,
      hasPc: pc !== undefined && pc >= r.start && pc <= r.end,
    };
  });

  const slots = SHEILA_SLOTS.map((slot, index): SlotRow => {
    const start = 0xfe00 + slot.start;
    const isPlaceholder = source.devices[slot.id] instanceof PlaceholderDevice;
    return {
      id: slot.id,
      start,
      range: `&${hex16(start)}-&${hex16(start + slot.size - 1)}`,
      name: slot.name,
      chip: slot.chip,
      registers: `${String(slot.registers.length)}, ×${String(slot.size / slot.registers.length)}`,
      device: isPlaceholder ? `placeholder (${slot.builtIn})` : 'emulated',
      isPlaceholder,
      reads: source.slotReads(index),
      writes: source.slotWrites(index),
    };
  });

  const wanted = options.logLines ?? LOG_LINES;
  const entries = source.ioLog.recent(wanted);
  const log = entries.map(
    (e): LogRow => ({
      index: e.index,
      direction: e.write ? 'W' : 'R',
      address: `&${hex16(e.address)}`,
      value: `&${hex8(e.value)}`,
      text: describeIoAddress(e.address).text,
    }),
  );
  const total = source.ioLog.count;
  const logNote =
    total === 0
      ? 'No I/O yet: Run or Step a program that touches &FC00-&FEFF.'
      : entries.length < total
        ? `The last ${String(entries.length)} of ${String(total)} accesses, oldest first.`
        : `${String(total)} ${total === 1 ? 'access' : 'accesses'}, oldest first.`;

  return { regions, slots, log, logNote };
}
