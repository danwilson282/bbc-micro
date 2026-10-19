// The Intel 8271 floppy disc controller, at &FE80-&FE9F (Stage 49).
//
// The DFS doesn't drive the disc itself: it gives this chip commands and
// reads back results. The 8271 is a small microcontroller with its own ROM,
// so the two sides take turns through a handshake on the status register:
//
//   wait for bit 7 (busy) = 0  → write the command       (&FE80)
//   wait for bit 5 (param full) = 0 → write each parameter (&FE81)
//   wait for bit 7 = 0 again   → read the result          (&FE81)
//
//   offset  read                write
//   0       status              command
//   1       result              parameter
//   2       -                   reset (bit 0)
//   3       illegal             illegal
//   4-7     data (Stage 50)     data (Stage 50)
//
// The 8271 sees A0 and A1. The board wires A2 to its DACK pin, so 4-7 are
// the data register. The memory map passes offset & 7 (the SHEILA table).
//
// Stage 49 has the controller but no drive: the drive's input lines all
// read 0, so nothing is ever ready. Commands that need a drive end at once
// with result &10 (drive not ready). Stage 50 adds the drive and the data.
//
// Commands run the moment their last parameter arrives. A real 8271 takes
// microseconds (a seek, milliseconds), but nothing we run can tell yet.
//
// Sources: the Intel 8271 data sheet (my reading of it: register, command
// and result tables), the Stardot "8271 de-cap" thread (special register
// map), and DFS 0.98's own code, which proves several bits (see the doc).
//
// write() is on the hot path: no objects are made in it.

import type { IoDevice } from '../memory/io-device';
import type { FdcLog } from './fdc-log';

// ── Registers (offset within the slot) ────────────────────────────────────

/** Read: the status register. */
export const FDC_STATUS = 0;
/** Write: the command register. Same address as the status. */
export const FDC_COMMAND = 0;
/** Read: the result register. */
export const FDC_RESULT = 1;
/** Write: the parameter register. Same address as the result. */
export const FDC_PARAMETER = 1;
/** Write: the reset register. Bit 0 = 1 holds the chip in reset. */
export const FDC_RESET = 2;
/** Read/write: the data register (A2 is DACK, so offsets 4-7). Stage 50. */
export const FDC_DATA = 4;

// ── Status register bits (8271 data sheet, status register) ───────────────

/** Bit 7: a command is in progress. DFS 0.98 waits on it with BIT/BMI (&8C85). */
export const FDC_STATUS_COMMAND_BUSY = 0x80;
/** Bit 6: the chip hasn't picked up the command byte yet. Never seen here: ours takes it at once. */
export const FDC_STATUS_COMMAND_FULL = 0x40;
/** Bit 5: the chip hasn't picked up the last parameter. DFS 0.98 waits on it with AND #&20 (&8C73). */
export const FDC_STATUS_PARAMETER_FULL = 0x20;
/** Bit 4: a result is waiting at &FE81. */
export const FDC_STATUS_RESULT_FULL = 0x10;
/** Bit 3: the INT pin. On the BBC it drives /NMI (Stage 50). */
export const FDC_STATUS_INTERRUPT = 0x08;
/** Bit 2: a data byte is ready or wanted at &FE84 (Stage 50). */
export const FDC_STATUS_DATA_REQUEST = 0x04;

// ── Command byte ──────────────────────────────────────────────────────────

/** Bits 5-0 of a command byte: which command. */
export const FDC_COMMAND_CODE_MASK = 0x3f;
/** Bits 7-6: SELECT 1 and SELECT 0. &40 is drive 0, &80 drive 1. */
export const FDC_COMMAND_SELECT_0 = 0x40;
export const FDC_COMMAND_SELECT_1 = 0x80;

// Command codes (bits 5-0), from the data sheet's command summary.
export const FDC_CMD_SCAN_DATA = 0x00;
export const FDC_CMD_SCAN_DATA_AND_DELETED = 0x04;
export const FDC_CMD_WRITE_DATA_128 = 0x0a;
export const FDC_CMD_WRITE_DATA = 0x0b;
export const FDC_CMD_WRITE_DELETED_DATA_128 = 0x0e;
export const FDC_CMD_WRITE_DELETED_DATA = 0x0f;
export const FDC_CMD_READ_DATA_128 = 0x12;
export const FDC_CMD_READ_DATA = 0x13;
export const FDC_CMD_READ_DATA_AND_DELETED_128 = 0x16;
export const FDC_CMD_READ_DATA_AND_DELETED = 0x17;
export const FDC_CMD_READ_ID = 0x1b;
export const FDC_CMD_VERIFY_DATA_AND_DELETED_128 = 0x1e;
export const FDC_CMD_VERIFY_DATA_AND_DELETED = 0x1f;
export const FDC_CMD_FORMAT_TRACK = 0x23;
export const FDC_CMD_SEEK = 0x29;
export const FDC_CMD_READ_DRIVE_STATUS = 0x2c;
export const FDC_CMD_SPECIFY = 0x35;
export const FDC_CMD_WRITE_SPECIAL_REGISTER = 0x3a;
export const FDC_CMD_READ_SPECIAL_REGISTER = 0x3d;

/**
 * register: works on the chip alone (Stage 49).
 * drive: needs a ready drive (Seek; Stage 50).
 * data: needs a drive and moves sectors (Stage 50).
 */
export type FdcCommandKind = 'register' | 'drive' | 'data';

export interface FdcCommandInfo {
  readonly name: string;
  /** How many parameter bytes follow the command byte. */
  readonly params: number;
  readonly kind: FdcCommandKind;
}

/** The most parameters any command takes (Format, Scan). */
export const FDC_MAX_PARAMS = 5;

/** The commands by code. A code not here isn't a command. */
const COMMANDS: ReadonlyMap<number, FdcCommandInfo> = new Map<number, FdcCommandInfo>([
  [FDC_CMD_SCAN_DATA, { name: 'Scan Data', params: 5, kind: 'data' }],
  [FDC_CMD_SCAN_DATA_AND_DELETED, { name: 'Scan Data and Deleted Data', params: 5, kind: 'data' }],
  [FDC_CMD_WRITE_DATA_128, { name: 'Write Data (one 128-byte record)', params: 2, kind: 'data' }],
  [FDC_CMD_WRITE_DATA, { name: 'Write Data', params: 3, kind: 'data' }],
  [FDC_CMD_WRITE_DELETED_DATA_128, { name: 'Write Deleted Data (one 128-byte record)', params: 2, kind: 'data' }],
  [FDC_CMD_WRITE_DELETED_DATA, { name: 'Write Deleted Data', params: 3, kind: 'data' }],
  [FDC_CMD_READ_DATA_128, { name: 'Read Data (one 128-byte record)', params: 2, kind: 'data' }],
  [FDC_CMD_READ_DATA, { name: 'Read Data', params: 3, kind: 'data' }],
  [FDC_CMD_READ_DATA_AND_DELETED_128, { name: 'Read Data and Deleted Data (one 128-byte record)', params: 2, kind: 'data' }],
  [FDC_CMD_READ_DATA_AND_DELETED, { name: 'Read Data and Deleted Data', params: 3, kind: 'data' }],
  [FDC_CMD_READ_ID, { name: 'Read ID', params: 3, kind: 'data' }],
  [FDC_CMD_VERIFY_DATA_AND_DELETED_128, { name: 'Verify Data and Deleted Data (one 128-byte record)', params: 2, kind: 'data' }],
  [FDC_CMD_VERIFY_DATA_AND_DELETED, { name: 'Verify Data and Deleted Data', params: 3, kind: 'data' }],
  [FDC_CMD_FORMAT_TRACK, { name: 'Format Track', params: 5, kind: 'data' }],
  [FDC_CMD_SEEK, { name: 'Seek', params: 1, kind: 'drive' }],
  [FDC_CMD_READ_DRIVE_STATUS, { name: 'Read Drive Status', params: 0, kind: 'register' }],
  [FDC_CMD_SPECIFY, { name: 'Specify', params: 4, kind: 'register' }],
  [FDC_CMD_WRITE_SPECIAL_REGISTER, { name: 'Write Special Register', params: 2, kind: 'register' }],
  [FDC_CMD_READ_SPECIAL_REGISTER, { name: 'Read Special Register', params: 1, kind: 'register' }],
]);

/** What command code (bits 5-0) means, or undefined if nothing. */
export function fdcCommandInfo(code: number): FdcCommandInfo | undefined {
  return COMMANDS.get(code & FDC_COMMAND_CODE_MASK);
}

// ── Special registers (addresses for Specify / Read / Write Special Register) ──

export const FDC_SPECIAL_SCAN_SECTOR = 0x06;
export const FDC_SPECIAL_STEP_RATE = 0x0d;
export const FDC_SPECIAL_HEAD_SETTLE = 0x0e;
/** High nibble: index count before the head unloads; low nibble: head load time. */
export const FDC_SPECIAL_INDEX_COUNT_HEAD_LOAD = 0x0f;
export const FDC_SPECIAL_SURFACE0_BAD_TRACK_1 = 0x10;
export const FDC_SPECIAL_SURFACE0_BAD_TRACK_2 = 0x11;
export const FDC_SPECIAL_SURFACE0_CURRENT_TRACK = 0x12;
export const FDC_SPECIAL_SCAN_COUNT_LOW = 0x13;
export const FDC_SPECIAL_SCAN_COUNT_HIGH = 0x14;
export const FDC_SPECIAL_MODE = 0x17;
export const FDC_SPECIAL_SURFACE1_BAD_TRACK_1 = 0x18;
export const FDC_SPECIAL_SURFACE1_BAD_TRACK_2 = 0x19;
export const FDC_SPECIAL_SURFACE1_CURRENT_TRACK = 0x1a;
/** The lines from the drives (Read Drive Status returns them too). */
export const FDC_SPECIAL_INPUT_PORT = 0x22;
/** The lines to the drives: select, side, load head, step... */
export const FDC_SPECIAL_OUTPUT_PORT = 0x23;

/** Mode register bit 0: data through the CPU, an interrupt per byte (the BBC has no DMA). */
export const FDC_MODE_NON_DMA = 0x01;

// ── Drive control input port bits (data sheet; bit 2 confirmed by DFS 0.98 at &8B89) ──

export const FDC_INPUT_COUNT = 0x01;
export const FDC_INPUT_TRACK_0 = 0x02;
export const FDC_INPUT_READY_0 = 0x04;
export const FDC_INPUT_WRITE_PROTECT = 0x08;
export const FDC_INPUT_INDEX = 0x10;
export const FDC_INPUT_WRITE_FAULT = 0x20;
export const FDC_INPUT_READY_1 = 0x40;

// ── Drive control output port bits (data sheet; bit 5 as side select from DFS 0.98's &8B8C table) ──

export const FDC_OUTPUT_WRITE_ENABLE = 0x01;
export const FDC_OUTPUT_SEEK_STEP = 0x02;
export const FDC_OUTPUT_DIRECTION = 0x04;
export const FDC_OUTPUT_LOAD_HEAD = 0x08;
export const FDC_OUTPUT_LOW_HEAD_CURRENT = 0x10;
/** "Write fault reset" on the data sheet; the BBC uses it to pick the disc's side. */
export const FDC_OUTPUT_SIDE = 0x20;
export const FDC_OUTPUT_SELECT_0 = 0x40;
export const FDC_OUTPUT_SELECT_1 = 0x80;

// ── Result codes (data sheet, completion codes) ───────────────────────────

export const FDC_RESULT_OK = 0x00;
export const FDC_RESULT_SCAN_MET_EQUAL = 0x02;
export const FDC_RESULT_SCAN_MET_NOT_EQUAL = 0x04;
export const FDC_RESULT_CLOCK_ERROR = 0x08;
export const FDC_RESULT_LATE_DMA = 0x0a;
export const FDC_RESULT_ID_CRC_ERROR = 0x0c;
export const FDC_RESULT_DATA_CRC_ERROR = 0x0e;
export const FDC_RESULT_DRIVE_NOT_READY = 0x10;
export const FDC_RESULT_WRITE_PROTECT = 0x12;
export const FDC_RESULT_TRACK_0_NOT_FOUND = 0x14;
export const FDC_RESULT_WRITE_FAULT = 0x16;
export const FDC_RESULT_SECTOR_NOT_FOUND = 0x18;
/** Added to a code when a sector with a deleted-data mark was met. */
export const FDC_RESULT_DELETED_DATA = 0x20;

export class Fdc8271 implements IoDevice {
  private statusByte = 0;
  private resultByte = 0;
  private commandByte = 0;
  /** Parameters still to come for the command in progress. */
  private paramsWanted = 0;
  private paramsHeld = 0;
  private readonly params = new Uint8Array(FDC_MAX_PARAMS);
  private readonly specials = new Uint8Array(0x100);
  /** The lines from the drives. No drive yet (Stage 49): all 0, so nothing is ready. */
  private readonly driveInput = 0;
  private held = false;

  constructor(private readonly log?: FdcLog) {}

  // ── The bus ────────────────────────────────────────────────────────────

  read(offset: number): number {
    switch (offset & 0x07) {
      case FDC_STATUS:
        return this.statusByte;
      case FDC_RESULT:
        // Taking the result clears result full and the interrupt request.
        this.statusByte &= ~(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT) & 0xff;
        return this.resultByte;
      default:
        // The reset register is write-only, 3 is illegal, and the data register is Stage 50's.
        return 0x00;
    }
  }

  peek(offset: number): number {
    switch (offset & 0x07) {
      case FDC_STATUS:
        return this.statusByte;
      case FDC_RESULT:
        return this.resultByte;
      default:
        return 0x00;
    }
  }

  write(offset: number, value: number): void {
    const v = value & 0xff;
    switch (offset & 0x07) {
      case FDC_COMMAND:
        this.writeCommand(v);
        return;
      case FDC_PARAMETER:
        this.writeParameter(v);
        return;
      case FDC_RESET:
        this.writeReset(v);
        return;
      default:
        // 3 is illegal; the data register is Stage 50's.
        return;
    }
  }

  // ── For tests, panels and the machine ─────────────────────────────────

  /** The status register, as a read of &FE80 would see it. */
  get status(): number {
    return this.statusByte;
  }

  /** The result register, without taking it. */
  get result(): number {
    return this.resultByte;
  }

  /** The command byte last accepted. */
  get command(): number {
    return this.commandByte;
  }

  /** A special register, by its address (&00-&FF). */
  special(address: number): number {
    return this.specials[address & 0xff] ?? 0;
  }

  /** The lines from the drives now (special register &22, and Read Drive Status). */
  get driveLines(): number {
    return this.driveInput;
  }

  /** The INT pin. Not wired to /NMI until Stage 50. */
  get interruptRequest(): boolean {
    return (this.statusByte & FDC_STATUS_INTERRUPT) !== 0;
  }

  /** Is the chip held in reset (&FE82 bit 0 = 1)? */
  get inReset(): boolean {
    return this.held;
  }

  /** The chip's RESET pin, pulsed at power-on: any command is dropped. The special registers are kept. */
  reset(): void {
    this.statusByte = 0;
    this.resultByte = 0;
    this.paramsWanted = 0;
    this.paramsHeld = 0;
    this.held = false;
  }

  /** Power-on: the RESET pin, and the special registers start at 0 (our choice). */
  powerOn(): void {
    this.reset();
    this.specials.fill(0);
    this.commandByte = 0;
  }

  // ── The handshake ──────────────────────────────────────────────────────

  private writeCommand(v: number): void {
    // The DFS waits for "not busy" first; a command written anyway is lost.
    if (this.held || (this.statusByte & FDC_STATUS_COMMAND_BUSY) !== 0) return;
    this.commandByte = v;
    this.paramsHeld = 0;
    // A new command throws away a result nobody read.
    this.statusByte = FDC_STATUS_COMMAND_BUSY;
    const info = COMMANDS.get(v & FDC_COMMAND_CODE_MASK);
    // A code with no command takes no parameters and finishes (our choice: the data sheet doesn't say).
    this.paramsWanted = info?.params ?? 0;
    if (this.paramsWanted === 0) this.run();
  }

  private writeParameter(v: number): void {
    if (this.held || this.paramsWanted === 0) return;
    this.params[this.paramsHeld] = v;
    this.paramsHeld++;
    this.paramsWanted--;
    if (this.paramsWanted === 0) this.run();
  }

  private writeReset(v: number): void {
    const hold = (v & 0x01) !== 0;
    if (hold && !this.held) {
      this.reset();
      this.log?.recordReset();
    }
    this.held = hold;
  }

  /** All the parameters are here: do it, and finish. */
  private run(): void {
    const code = this.commandByte & FDC_COMMAND_CODE_MASK;
    const p = this.params;
    let hasResult = false;
    let interrupt = false;
    let result = FDC_RESULT_OK;
    switch (code) {
      case FDC_CMD_SPECIFY: {
        // Three special registers in a row, from the address in the first parameter.
        const base = p[0];
        for (let i = 0; i < 3; i++) this.specials[(base + i) & 0xff] = p[i + 1] ?? 0;
        break;
      }
      case FDC_CMD_WRITE_SPECIAL_REGISTER:
        this.specials[p[0]] = p[1];
        break;
      case FDC_CMD_READ_SPECIAL_REGISTER: {
        const address = p[0];
        result = address === FDC_SPECIAL_INPUT_PORT ? this.driveInput : this.specials[address];
        hasResult = true;
        break;
      }
      case FDC_CMD_READ_DRIVE_STATUS:
        result = this.driveInput;
        hasResult = true;
        break;
      default: {
        const info = COMMANDS.get(code);
        if (info !== undefined && info.kind !== 'register') {
          // Seek and the data commands need a drive, and none is ready (Stage 49).
          result = FDC_RESULT_DRIVE_NOT_READY;
          hasResult = true;
          interrupt = true;
        }
      }
    }
    this.resultByte = result;
    this.statusByte = (hasResult ? FDC_STATUS_RESULT_FULL : 0) | (interrupt ? FDC_STATUS_INTERRUPT : 0);
    this.log?.recordCommand(this.commandByte, p, this.paramsHeld, result, hasResult);
  }
}
