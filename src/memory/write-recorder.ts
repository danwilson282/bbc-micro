// A bus that notes every write on its way through.
//
//   Cpu6502 ──read/write──▶ WriteRecorder ──read/write──▶ TestBus (or, from
//                            notes writes                  Stage 21, the BBC
//                                                          memory map)
//
// The CPU only sees a Bus, so it can't tell the recorder is there. The
// workbench uses it to highlight the bytes the CPU wrote during the last run.
// It records writes, not changes: STA &7C04 with A=&4F over a byte that
// already holds &4F changes nothing, but it is still a write, and on a device
// register a write is an action.
//
// write() is on the hot path (every store goes through it), so the notes go
// into fixed, pre-allocated typed arrays. Only recorded(), which the debug
// views call, allocates.

import type { Bus } from './bus';

/** How many writes are kept between clear()s. Beyond this they are counted, not kept. */
export const WRITE_RECORDER_CAPACITY = 64;

export interface WriteRecord {
  readonly address: number;
  readonly value: number;
}

/** The recorder as the debug views see it: they can read and clear the notes, not write. */
export interface WriteLog {
  /** Writes since the last clear(), including any beyond capacity. */
  readonly count: number;
  /** The kept writes, oldest first. Allocates: for debug views only, never step(). */
  recorded(): readonly WriteRecord[];
  clear(): void;
}

export class WriteRecorder implements Bus, WriteLog {
  private readonly addresses = new Uint16Array(WRITE_RECORDER_CAPACITY);
  private readonly values = new Uint8Array(WRITE_RECORDER_CAPACITY);
  private writes = 0;

  constructor(private readonly inner: Bus) {}

  get count(): number {
    return this.writes;
  }

  read(address: number): number {
    return this.inner.read(address);
  }

  write(address: number, value: number): void {
    const n = this.writes;
    if (n < WRITE_RECORDER_CAPACITY) {
      this.addresses[n] = address & 0xffff;
      this.values[n] = value & 0xff;
    }
    this.writes = n + 1;
    this.inner.write(address, value);
  }

  clear(): void {
    this.writes = 0;
  }

  recorded(): readonly WriteRecord[] {
    const kept = Math.min(this.writes, WRITE_RECORDER_CAPACITY);
    const records: WriteRecord[] = [];
    for (let i = 0; i < kept; i++) {
      records.push({ address: this.addresses[i] ?? 0, value: this.values[i] ?? 0 });
    }
    return records;
  }
}
