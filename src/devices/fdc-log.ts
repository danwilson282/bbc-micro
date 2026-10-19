// The 8271's command log (Stage 49): every command the chip ran, with its
// parameters and result, so the FDC panel can show what the DFS asked for.
//
// Like the hardware log (Stage 28), it's typed arrays in a ring, written
// from inside the CPU's step with no objects made. One difference: the DFS
// polls. Waiting for a drive, it sends Read Drive Status thousands of times
// a second, so an entry that matches the last one (same command, parameters
// and result) just adds 1 to that entry's repeat count.
//
// describeFdcEntry() turns an entry into words, only when someone looks.

import { hex8 } from '../util/bits';
import type { CycleClock } from './hardware-log';
import {
  FDC_COMMAND_CODE_MASK,
  FDC_COMMAND_SELECT_0,
  FDC_COMMAND_SELECT_1,
  FDC_CMD_READ_DRIVE_STATUS,
  FDC_CMD_READ_SPECIAL_REGISTER,
  FDC_CMD_SEEK,
  FDC_CMD_SPECIFY,
  FDC_CMD_WRITE_SPECIAL_REGISTER,
  FDC_INPUT_COUNT,
  FDC_INPUT_INDEX,
  FDC_INPUT_READY_0,
  FDC_INPUT_READY_1,
  FDC_INPUT_TRACK_0,
  FDC_INPUT_WRITE_FAULT,
  FDC_INPUT_WRITE_PROTECT,
  FDC_MAX_PARAMS,
  FDC_MODE_NON_DMA,
  FDC_OUTPUT_DIRECTION,
  FDC_OUTPUT_LOAD_HEAD,
  FDC_OUTPUT_LOW_HEAD_CURRENT,
  FDC_OUTPUT_SEEK_STEP,
  FDC_OUTPUT_SELECT_0,
  FDC_OUTPUT_SELECT_1,
  FDC_OUTPUT_SIDE,
  FDC_OUTPUT_WRITE_ENABLE,
  FDC_RESULT_DELETED_DATA,
  FDC_SPECIAL_INPUT_PORT,
  FDC_SPECIAL_MODE,
  FDC_SPECIAL_OUTPUT_PORT,
  FDC_SPECIAL_STEP_RATE,
  FDC_SPECIAL_SURFACE0_BAD_TRACK_1,
  FDC_SPECIAL_SURFACE1_BAD_TRACK_1,
  fdcCommandInfo,
} from './fdc8271';

export type FdcLogKind = 'command' | 'reset';

export interface FdcLogEntry {
  /** 1 for the first entry since clear(), counting up. */
  readonly index: number;
  /** CPU cycles when it first ran. */
  readonly cycles: number;
  /** CPU cycles when it last ran (the same as cycles unless it repeated). */
  readonly lastCycles: number;
  readonly kind: FdcLogKind;
  /** The command byte, drive bits included. 0 for a reset. */
  readonly command: number;
  readonly params: readonly number[];
  /** The result byte, or undefined for a command with no result. */
  readonly result: number | undefined;
  /** How many times in a row it ran. */
  readonly repeats: number;
}

export const DEFAULT_FDC_LOG_CAPACITY = 256;

const KIND_COMMAND = 0;
const KIND_RESET = 1;

export class FdcLog {
  private readonly mask: number;
  private readonly firstAt: Float64Array;
  private readonly lastAt: Float64Array;
  private readonly repeatCount: Float64Array;
  private readonly kind: Uint8Array;
  private readonly command: Uint8Array;
  private readonly paramCount: Uint8Array;
  private readonly param: Uint8Array;
  private readonly result: Uint8Array;
  private readonly hasResult: Uint8Array;
  private total = 0;

  /** capacity must be a power of two, so a mask can wrap the index. */
  constructor(
    private readonly clock: CycleClock,
    readonly capacity = DEFAULT_FDC_LOG_CAPACITY,
  ) {
    if (capacity < 1 || (capacity & (capacity - 1)) !== 0) {
      throw new RangeError(`FDC log capacity must be a power of two, not ${String(capacity)}`);
    }
    this.mask = capacity - 1;
    this.firstAt = new Float64Array(capacity);
    this.lastAt = new Float64Array(capacity);
    this.repeatCount = new Float64Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.command = new Uint8Array(capacity);
    this.paramCount = new Uint8Array(capacity);
    this.param = new Uint8Array(capacity * FDC_MAX_PARAMS);
    this.result = new Uint8Array(capacity);
    this.hasResult = new Uint8Array(capacity);
  }

  /** Entries since clear(), including any that have been overwritten. */
  get count(): number {
    return this.total;
  }

  /** The chip ran a command. Numbers only: it's inside the CPU's step. */
  recordCommand(command: number, params: Uint8Array, count: number, result: number, hasResult: boolean): void {
    const n = Math.min(count, FDC_MAX_PARAMS);
    if (this.total > 0) {
      const last = (this.total - 1) & this.mask;
      if (this.sameAsLast(last, command, params, n, result, hasResult)) {
        this.repeat(last);
        return;
      }
    }
    const slot = this.open(KIND_COMMAND);
    this.command[slot] = command & 0xff;
    this.paramCount[slot] = n;
    for (let i = 0; i < n; i++) this.param[slot * FDC_MAX_PARAMS + i] = params[i] ?? 0;
    this.result[slot] = result & 0xff;
    this.hasResult[slot] = hasResult ? 1 : 0;
  }

  /** The CPU put the chip into reset through &FE82. */
  recordReset(): void {
    if (this.total > 0) {
      const last = (this.total - 1) & this.mask;
      if (this.kind[last] === KIND_RESET) {
        this.repeat(last);
        return;
      }
    }
    const slot = this.open(KIND_RESET);
    this.command[slot] = 0;
    this.paramCount[slot] = 0;
    this.hasResult[slot] = 0;
  }

  /** The last `count` entries still held (at most capacity), oldest first. For display. */
  recent(count = this.capacity): FdcLogEntry[] {
    const held = Math.min(count, this.capacity, this.total);
    const entries: FdcLogEntry[] = [];
    for (let n = this.total - held; n < this.total; n++) {
      const slot = n & this.mask;
      const params: number[] = [];
      for (let i = 0; i < (this.paramCount[slot] ?? 0); i++) params.push(this.param[slot * FDC_MAX_PARAMS + i] ?? 0);
      entries.push({
        index: n + 1,
        cycles: this.firstAt[slot] ?? 0,
        lastCycles: this.lastAt[slot] ?? 0,
        kind: this.kind[slot] === KIND_RESET ? 'reset' : 'command',
        command: this.command[slot] ?? 0,
        params,
        result: this.hasResult[slot] === 1 ? (this.result[slot] ?? 0) : undefined,
        repeats: this.repeatCount[slot] ?? 1,
      });
    }
    return entries;
  }

  clear(): void {
    this.total = 0;
  }

  private open(kind: number): number {
    const slot = this.total & this.mask;
    this.kind[slot] = kind;
    this.firstAt[slot] = this.clock.cycles;
    this.lastAt[slot] = this.clock.cycles;
    this.repeatCount[slot] = 1;
    this.total++;
    return slot;
  }

  private repeat(slot: number): void {
    this.repeatCount[slot] = (this.repeatCount[slot] ?? 0) + 1;
    this.lastAt[slot] = this.clock.cycles;
  }

  private sameAsLast(slot: number, command: number, params: Uint8Array, n: number, result: number, hasResult: boolean): boolean {
    if (this.kind[slot] !== KIND_COMMAND || this.command[slot] !== (command & 0xff) || this.paramCount[slot] !== n) return false;
    if ((this.hasResult[slot] === 1) !== hasResult || (hasResult && this.result[slot] !== (result & 0xff))) return false;
    for (let i = 0; i < n; i++) if (this.param[slot * FDC_MAX_PARAMS + i] !== params[i]) return false;
    return true;
  }
}

// ── In words ───────────────────────────────────────────────────────────────

export interface FdcEntryText {
  /** "75 0D 02 08 C0": the command byte and its parameters. */
  readonly bytes: string;
  /** "0", "1", "both" or "none": bits 7-6 of the command byte. */
  readonly drive: string;
  /** "Specify &0D: step rate &02, ...". */
  readonly text: string;
}

const RESULT_TEXT: ReadonlyMap<number, string> = new Map([
  [0x00, 'OK'],
  [0x02, 'scan met, equal'],
  [0x04, 'scan met, not equal'],
  [0x08, 'clock error'],
  [0x0a, 'late DMA'],
  [0x0c, 'ID CRC error'],
  [0x0e, 'data CRC error'],
  [0x10, 'drive not ready'],
  [0x12, 'write protect'],
  [0x14, 'track 0 not found'],
  [0x16, 'write fault'],
  [0x18, 'sector not found'],
]);

/** "&10 drive not ready", "&38 sector not found, deleted data". */
export function describeResult(result: number): string {
  const deleted = (result & FDC_RESULT_DELETED_DATA) !== 0;
  const meaning = RESULT_TEXT.get(result & ~FDC_RESULT_DELETED_DATA & 0xff) ?? 'unknown code';
  return `&${hex8(result)} ${meaning}${deleted ? ', deleted data' : ''}`;
}

const SPECIAL_NAMES: ReadonlyMap<number, string> = new Map([
  [0x06, 'scan sector'],
  [0x0d, 'step rate'],
  [0x0e, 'head settle'],
  [0x0f, 'index count / head load'],
  [0x10, 'surface 0 bad track 1'],
  [0x11, 'surface 0 bad track 2'],
  [0x12, 'surface 0 current track'],
  [0x13, 'scan count low'],
  [0x14, 'scan count high'],
  [0x17, 'mode'],
  [0x18, 'surface 1 bad track 1'],
  [0x19, 'surface 1 bad track 2'],
  [0x1a, 'surface 1 current track'],
  [0x22, 'drive control input'],
  [0x23, 'drive control output'],
]);

/** "mode", "drive control output", or "unknown". */
export function specialRegisterName(address: number): string {
  return SPECIAL_NAMES.get(address & 0xff) ?? 'unknown';
}

function flags(value: number, bits: readonly (readonly [number, string])[], none: string): string {
  const on = bits.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
  return on.length === 0 ? none : on.join(', ');
}

/** The lines to the drives, in the order a reader thinks of them: who, which side, then what. */
export function describeOutputPort(value: number): string {
  return flags(
    value,
    [
      [FDC_OUTPUT_SELECT_0, 'SELECT 0'],
      [FDC_OUTPUT_SELECT_1, 'SELECT 1'],
      [FDC_OUTPUT_SIDE, 'SIDE 1'],
      [FDC_OUTPUT_LOAD_HEAD, 'LOAD HEAD'],
      [FDC_OUTPUT_SEEK_STEP, 'STEP'],
      [FDC_OUTPUT_DIRECTION, 'DIRECTION'],
      [FDC_OUTPUT_WRITE_ENABLE, 'WRITE ENABLE'],
      [FDC_OUTPUT_LOW_HEAD_CURRENT, 'LOW HEAD CURRENT'],
    ],
    'nothing',
  );
}

/** The lines from the drives (Read Drive Status, special register &22). */
export function describeDriveInput(value: number): string {
  return flags(
    value,
    [
      [FDC_INPUT_TRACK_0, 'TRK0'],
      [FDC_INPUT_READY_0, 'RDY0'],
      [FDC_INPUT_READY_1, 'RDY1'],
      [FDC_INPUT_WRITE_PROTECT, 'WR PROT'],
      [FDC_INPUT_INDEX, 'INDEX'],
      [FDC_INPUT_WRITE_FAULT, 'WR FAULT'],
      [FDC_INPUT_COUNT, 'COUNT'],
    ],
    'not ready',
  );
}

/** "non-DMA", or "DMA". The other bits aren't decoded (see the Stage 49 doc). */
export function describeMode(value: number): string {
  return (value & FDC_MODE_NON_DMA) !== 0 ? 'non-DMA' : 'DMA';
}

function describeSpecialValue(address: number, value: number): string {
  if (address === FDC_SPECIAL_MODE) return `: ${describeMode(value)}`;
  if (address === FDC_SPECIAL_OUTPUT_PORT) return `: ${describeOutputPort(value)}`;
  if (address === FDC_SPECIAL_INPUT_PORT) return `: ${describeDriveInput(value)}`;
  return '';
}

function badTracks(a: number, b: number): string {
  const bad = [a, b].filter((t) => t !== 0xff).map((t) => `&${hex8(t)}`);
  return bad.length === 0 ? 'none' : bad.join(', ');
}

function describeSpecify(p: readonly number[]): string {
  const [base = 0, a = 0, b = 0, c = 0] = p;
  const head = `Specify &${hex8(base)}`;
  if (base === FDC_SPECIAL_STEP_RATE) {
    return `${head}: step rate &${hex8(a)}, head settle &${hex8(b)}, index count &${(c >> 4).toString(16).toUpperCase()}, head load &${(c & 0x0f).toString(16).toUpperCase()}`;
  }
  if (base === FDC_SPECIAL_SURFACE0_BAD_TRACK_1 || base === FDC_SPECIAL_SURFACE1_BAD_TRACK_1) {
    const surface = base === FDC_SPECIAL_SURFACE0_BAD_TRACK_1 ? 0 : 1;
    return `${head}: surface ${String(surface)} bad tracks ${badTracks(a, b)}, current track &${hex8(c)}`;
  }
  return `${head}: registers &${hex8(base)}-&${hex8((base + 2) & 0xff)} = &${hex8(a)} &${hex8(b)} &${hex8(c)}`;
}

/** The third parameter of a multi-record command: bits 7-5 size (128 << n), bits 4-0 count. */
function describeLength(lengthByte: number): string {
  const size = 128 << ((lengthByte >> 5) & 0x07);
  return `${String(lengthByte & 0x1f)} × ${String(size)} bytes`;
}

function describeCommand(command: number, p: readonly number[], result: number | undefined): string {
  const code = command & FDC_COMMAND_CODE_MASK;
  const info = fdcCommandInfo(code);
  const outcome = result === undefined ? '' : ` → ${describeResult(result)}`;
  if (info === undefined) return `&${hex8(code)}: no such command`;
  switch (code) {
    case FDC_CMD_SPECIFY:
      return describeSpecify(p);
    case FDC_CMD_WRITE_SPECIAL_REGISTER: {
      const [address = 0, value = 0] = p;
      return `Write Special Register &${hex8(address)} (${specialRegisterName(address)}) = &${hex8(value)}${describeSpecialValue(address, value)}`;
    }
    case FDC_CMD_READ_SPECIAL_REGISTER: {
      const address = p[0] ?? 0;
      return `Read Special Register &${hex8(address)} (${specialRegisterName(address)}) → &${hex8(result ?? 0)}`;
    }
    case FDC_CMD_READ_DRIVE_STATUS:
      return `Read Drive Status → &${hex8(result ?? 0)}: ${describeDriveInput(result ?? 0)}`;
    case FDC_CMD_SEEK:
      return `Seek to track ${String(p[0] ?? 0)}${outcome}`;
    default: {
      // The data commands: track, sector, and for the multi-record forms a length byte.
      const [track = 0, sector = 0] = p;
      const size = info.params === 3 && p.length >= 3 ? `, ${describeLength(p[2] ?? 0)}` : '';
      return `${info.name}, track ${String(track)} sector ${String(sector)}${size}${outcome}`;
    }
  }
}

function driveOf(command: number): string {
  const s0 = (command & FDC_COMMAND_SELECT_0) !== 0;
  const s1 = (command & FDC_COMMAND_SELECT_1) !== 0;
  if (s0 && s1) return 'both';
  if (s0) return '0';
  if (s1) return '1';
  return 'none';
}

/** An entry in words, for the panel and the demo. */
export function describeFdcEntry(entry: FdcLogEntry): FdcEntryText {
  if (entry.kind === 'reset') return { bytes: '', drive: '', text: 'Reset (&FE82 bit 0 = 1)' };
  return {
    bytes: [entry.command, ...entry.params].map(hex8).join(' '),
    drive: driveOf(entry.command),
    text: describeCommand(entry.command, entry.params, entry.result),
  };
}
