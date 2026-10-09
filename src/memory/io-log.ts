// The I/O access log: every CPU read and write in &FC00-&FEFF, in order.
//
// It's how we'll see what the MOS does to the hardware (Stage 23 uses it to
// work out why the MOS stalls). Like Stage 18's tracer, record() only copies
// numbers into preallocated typed arrays arranged as a ring buffer: once
// full, the newest access overwrites the oldest. No words are stored. The
// description ("System VIA reg 4 (T1C-L)") is worked out when someone looks.
//
// Only I/O accesses reach record(), so RAM and ROM accesses pay nothing.

export interface IoAccess {
  /** 1 for the first access since clear(), counting up. */
  readonly index: number;
  readonly address: number;
  readonly value: number;
  readonly write: boolean;
}

export const DEFAULT_IO_LOG_CAPACITY = 256;

export class IoLog {
  private readonly mask: number;
  private readonly address: Uint16Array;
  private readonly value: Uint8Array;
  private readonly isWrite: Uint8Array;
  private total = 0;

  /** capacity must be a power of two, so a mask can wrap the index. */
  constructor(readonly capacity = DEFAULT_IO_LOG_CAPACITY) {
    if (capacity < 1 || (capacity & (capacity - 1)) !== 0) {
      throw new RangeError(`I/O log capacity must be a power of two, not ${String(capacity)}`);
    }
    this.mask = capacity - 1;
    this.address = new Uint16Array(capacity);
    this.value = new Uint8Array(capacity);
    this.isWrite = new Uint8Array(capacity);
  }

  /** Accesses since clear(), including any that have been overwritten. */
  get count(): number {
    return this.total;
  }

  /** Hot path: called by the memory map for each CPU access to an I/O page. */
  record(address: number, value: number, write: boolean): void {
    const slot = this.total & this.mask;
    this.address[slot] = address & 0xffff;
    this.value[slot] = value & 0xff;
    this.isWrite[slot] = write ? 1 : 0;
    this.total++;
  }

  /** The last `count` accesses still held (at most capacity), oldest first. For display. */
  recent(count = this.capacity): IoAccess[] {
    const held = Math.min(count, this.capacity, this.total);
    const entries: IoAccess[] = [];
    for (let n = this.total - held; n < this.total; n++) {
      const slot = n & this.mask;
      entries.push({ index: n + 1, address: this.address[slot] ?? 0, value: this.value[slot] ?? 0, write: this.isWrite[slot] === 1 });
    }
    return entries;
  }

  clear(): void {
    this.total = 0;
  }
}
