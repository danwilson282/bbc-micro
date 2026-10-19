// The Intel 8271 floppy disc controller, at &FE80-&FE9F (Stages 49-50).
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
//   4-7     data                data
//
// The 8271 sees A0 and A1. The board wires A2 to its DACK pin, so 4-7 are
// the data register. The memory map passes offset & 7 (the SHEILA table).
//
// Stage 49: the registers and the commands that need no drive, which run the
// moment their last parameter arrives.
//
// Stage 50: drives, and time. Seek and the reads step the head, wait for the
// sector to come round, then hand over a byte every 128 cycles. Non-DMA mode:
// each byte sets status bit 2 and raises INT, which on the BBC is /NMI. The
// CPU reads &FE84, which drops INT, ready for the next byte's edge. A byte
// not taken before the next one arrives ends the command: &0A, late DMA.
//
//   idle → seeking → settling → searching → data ×n → (searching → data)... → crc → idle
//
// Stage 51: writing. Write Data is a read run backwards: the 8271 asks for
// each byte (data request + INT) and the CPU writes it to &FE84. 128 cycles
// later the byte goes on the disc and the next is asked for. A byte not
// there in time is &0A again. A disc with its write protect tab on gets &12.
//
// Sources: the Intel 8271 data sheet (my reading of it: register, command
// and result tables, timings), the Stardot "8271 de-cap" thread (special
// register map), and DFS 0.98's own code, which proves several bits (see the
// Stage 49 and 50 docs).
//
// write(), read() and tick() are on the hot path: no objects are made in them.

import { SECTOR_SIZE, SECTORS_PER_TRACK } from '../disc/disc-image';
import type { IoDevice } from '../memory/io-device';
import type { Clocked } from './clocked';
import type { DiscDrive } from './disc-drive';
import { CYCLES_PER_BYTE, CYCLES_PER_REVOLUTION, CYCLES_PER_SECTOR, DATA_FIELD_START, cyclesUntil } from './disc-drive';
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
/** Bit 3: the INT pin. On the BBC it drives /NMI (Stage 50). Taking the result or the data byte clears it. */
export const FDC_STATUS_INTERRUPT = 0x08;
/** Bit 2: a data byte is ready (or wanted) at &FE84, in non-DMA mode (Stage 50). */
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

// ── Timing (Stage 50) ─────────────────────────────────────────────────────

/**
 * Step rate and head settling count in 2 ms units on a mini-floppy (the data
 * sheet's 1 ms, doubled for 5¼" drives; unconfirmed for the BBC): 4,000 cycles.
 */
export const FDC_TIME_UNIT_CYCLES = 4_000;

/** Revolutions searched for an ID before giving up with &18. Our reading, unconfirmed. */
export const FDC_SEARCH_REVOLUTIONS = 2;

/** An ID field: track, head, sector, size code. */
const ID_BYTES = 4;
/** The CRC after an ID or data field. */
const CRC_BYTES = 2;
/** Acorn DFS sectors are 256 bytes: size code 1 (128 × 2¹). */
const DFS_SIZE_CODE = 1;

/**
 * What a command needing a drive is doing (Stage 50).
 * seeking: one event per step. settling: the head settle time.
 * searching: waiting for the ID wanted. data / id: a field passing the
 * head, one event per byte. crc: the CRC after the last field.
 */
export type FdcPhase = 'idle' | 'seeking' | 'settling' | 'searching' | 'data' | 'id' | 'crc';

/** seek: Seek. read: Read Data. verify: read with no data requests. readId: Read ID. write: Write Data (Stage 51). */
type DriveOp = 'seek' | 'read' | 'verify' | 'readId' | 'write';

export class Fdc8271 implements IoDevice, Clocked {
  private statusByte = 0;
  private resultByte = 0;
  private commandByte = 0;
  /** Parameters still to come for the command in progress. */
  private paramsWanted = 0;
  private paramsHeld = 0;
  private readonly params = new Uint8Array(FDC_MAX_PARAMS);
  private readonly specials = new Uint8Array(0x100);
  private held = false;

  // ── A command in progress (Stage 50) ──
  private phase: FdcPhase = 'idle';
  private op: DriveOp = 'seek';
  /** Cycles until the next event. ≤ 0 means it's due; clock + countdown is when. */
  private countdown = 0;
  /** Cycles since this chip was made: the disc's angle is this mod a revolution. */
  private clock = 0;
  private driveNumber = 0;
  private side = 0;
  /** The track the command asked for, and the sector it's on now. */
  private track = 0;
  private sector = 0;
  /** Seek: steps still to take (-1: step out until TRK0), and which way. */
  private stepsLeft = 0;
  private stepDirection: 1 | -1 = 1;
  /** Sectors (or IDs, for Read ID) still to come, and the bytes in each. */
  private sectorsLeft = 0;
  private sectorLength = 0;
  private byteIndex = 0;
  /** Where the sector being read starts in the image; -1 while searching for one that isn't there. */
  private sectorAt = -1;
  /** Read ID: the sector whose ID is passing. */
  private idSector = 0;
  private dataByte = 0;
  private transferred = 0;
  private late = 0;

  /**
   * drives: what's on the cable, drive 0 then drive 1. None (Stage 49's
   * chip on its own): every command needing a drive gets &10.
   */
  constructor(
    private readonly log?: FdcLog,
    private readonly drives: readonly DiscDrive[] = [],
  ) {}

  // ── The bus ────────────────────────────────────────────────────────────

  read(offset: number): number {
    switch (offset & 0x07) {
      case FDC_STATUS:
        return this.statusByte;
      case FDC_RESULT:
        // Taking the result clears result full and the interrupt request.
        this.statusByte &= ~(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT) & 0xff;
        return this.resultByte;
      case 2:
      case 3:
        // The reset register is write-only, and 3 is illegal.
        return 0x00;
      default:
        // The data register: taking the byte drops the data request and INT, ready for the next edge.
        this.statusByte &= ~(FDC_STATUS_DATA_REQUEST | FDC_STATUS_INTERRUPT) & 0xff;
        return this.dataByte;
    }
  }

  peek(offset: number): number {
    switch (offset & 0x07) {
      case FDC_STATUS:
        return this.statusByte;
      case FDC_RESULT:
        return this.resultByte;
      case 2:
      case 3:
        return 0x00;
      default:
        return this.dataByte;
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
      case 3:
        // Illegal.
        return;
      default:
        // The data register: a byte for Write Data. Giving it drops the data request and INT (Stage 51).
        this.dataByte = v;
        this.statusByte &= ~(FDC_STATUS_DATA_REQUEST | FDC_STATUS_INTERRUPT) & 0xff;
        return;
    }
  }

  // ── Time ───────────────────────────────────────────────────────────────

  /** The disc turns; anything due happens, in order. Idle costs one addition. Hot path: makes nothing. */
  tick(cycles: number): void {
    this.clock += cycles;
    if (this.idle()) return;
    this.countdown -= cycles;
    // An event can end the command, so ask again each time (a method, so TypeScript doesn't narrow phase).
    while (!this.idle() && this.countdown <= 0) this.event();
  }

  private idle(): boolean {
    return this.phase === 'idle';
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

  /**
   * The lines from the drives now (special register &22, and Read Drive
   * Status): the selected drive's. The cable has one READY wire, so it shows
   * on RDY0 and RDY1 both (DFS 0.98 tests bit 2 for either drive, &8B89).
   */
  get driveLines(): number {
    const drive = this.selectedDrive();
    if (drive === undefined) return 0x00;
    let lines = 0;
    if (drive.ready) lines |= FDC_INPUT_READY_0 | FDC_INPUT_READY_1;
    if (drive.track0) lines |= FDC_INPUT_TRACK_0;
    if (drive.writeProtected) lines |= FDC_INPUT_WRITE_PROTECT;
    return lines;
  }

  /** The INT pin. On the BBC it drives /NMI (Stage 50). */
  get interruptRequest(): boolean {
    return (this.statusByte & FDC_STATUS_INTERRUPT) !== 0;
  }

  /** Is the chip held in reset (&FE82 bit 0 = 1)? */
  get inReset(): boolean {
    return this.held;
  }

  /** What a command needing a drive is doing now. */
  get currentPhase(): FdcPhase {
    return this.phase;
  }

  /** Cycles since the chip was made. The disc's angle is this mod CYCLES_PER_REVOLUTION. */
  get time(): number {
    return this.clock;
  }

  /** The last byte put in the data register. */
  get data(): number {
    return this.dataByte;
  }

  /** Data requests answered since power-on, reading or writing: one NMI each on the BBC. */
  get bytesTransferred(): number {
    return this.transferred;
  }

  /** Bytes the CPU didn't take in time (each ended a command with &0A). */
  get lateBytes(): number {
    return this.late;
  }

  /** The drive the output port's SELECT bits pick, if exactly one. */
  selectedDrive(): DiscDrive | undefined {
    switch (this.specials[FDC_SPECIAL_OUTPUT_PORT] & (FDC_OUTPUT_SELECT_0 | FDC_OUTPUT_SELECT_1)) {
      case FDC_OUTPUT_SELECT_0:
        return this.drives[0];
      case FDC_OUTPUT_SELECT_1:
        return this.drives[1];
      default:
        return undefined;
    }
  }

  /** The chip's RESET pin, pulsed at power-on: any command is dropped. The special registers are kept. */
  reset(): void {
    this.statusByte = 0;
    this.resultByte = 0;
    this.paramsWanted = 0;
    this.paramsHeld = 0;
    this.held = false;
    this.phase = 'idle';
    this.countdown = 0;
  }

  /** Power-on: the RESET pin, and the special registers start at 0 (our choice). The disc keeps turning. */
  powerOn(): void {
    this.reset();
    this.specials.fill(0);
    this.commandByte = 0;
    this.dataByte = 0;
    this.transferred = 0;
    this.late = 0;
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

  /**
   * A command's drive bits (7-6), if any, go out on the SELECT lines: the
   * output port's bits 7-6. Specify and Write Special Register have 00 and
   * leave them alone (our reading).
   */
  private selectFromCommand(): void {
    const select = this.commandByte & (FDC_COMMAND_SELECT_0 | FDC_COMMAND_SELECT_1);
    if (select === 0) return;
    const port = this.specials[FDC_SPECIAL_OUTPUT_PORT];
    this.specials[FDC_SPECIAL_OUTPUT_PORT] = (port & ~(FDC_OUTPUT_SELECT_0 | FDC_OUTPUT_SELECT_1) & 0xff) | select;
  }

  /** All the parameters are here: do it. Register commands finish now; drive commands may start a phase. */
  private run(): void {
    const code = this.commandByte & FDC_COMMAND_CODE_MASK;
    const p = this.params;
    switch (code) {
      case FDC_CMD_SPECIFY: {
        // Three special registers in a row, from the address in the first parameter.
        const base = p[0];
        for (let i = 0; i < 3; i++) this.specials[(base + i) & 0xff] = p[i + 1] ?? 0;
        this.finishWithoutResult();
        return;
      }
      case FDC_CMD_WRITE_SPECIAL_REGISTER:
        this.specials[p[0]] = p[1];
        this.finishWithoutResult();
        return;
      case FDC_CMD_READ_SPECIAL_REGISTER: {
        const address = p[0];
        this.finishQuietly(address === FDC_SPECIAL_INPUT_PORT ? this.driveLines : this.specials[address]);
        return;
      }
      case FDC_CMD_READ_DRIVE_STATUS:
        this.selectFromCommand();
        this.finishQuietly(this.driveLines);
        return;
      default:
        this.runDriveCommand(code);
    }
  }

  /** Seek and the data commands: they need a ready drive. */
  private runDriveCommand(code: number): void {
    const info = COMMANDS.get(code);
    if (info === undefined) {
      this.finishWithoutResult();
      return;
    }
    this.selectFromCommand();
    const drive = this.selectedDrive();
    if (drive === undefined || !drive.ready) {
      this.finish(FDC_RESULT_DRIVE_NOT_READY);
      return;
    }
    const p = this.params;
    const sizeAndCount = p[2];
    switch (code) {
      case FDC_CMD_SEEK:
        this.start('seek', p[0], 0, 0, 0);
        return;
      case FDC_CMD_READ_DATA:
      case FDC_CMD_READ_DATA_AND_DELETED:
        this.start('read', p[0], p[1], sizeAndCount & 0x1f, 128 << (sizeAndCount >> 5));
        return;
      case FDC_CMD_READ_DATA_128:
      case FDC_CMD_READ_DATA_AND_DELETED_128:
        this.start('read', p[0], p[1], 1, 128);
        return;
      case FDC_CMD_VERIFY_DATA_AND_DELETED:
        this.start('verify', p[0], p[1], sizeAndCount & 0x1f, 128 << (sizeAndCount >> 5));
        return;
      case FDC_CMD_VERIFY_DATA_AND_DELETED_128:
        this.start('verify', p[0], p[1], 1, 128);
        return;
      case FDC_CMD_READ_ID:
        // Parameters: track, 0, how many IDs.
        this.start('readId', p[0], 0, sizeAndCount, ID_BYTES);
        return;
      case FDC_CMD_WRITE_DATA:
      case FDC_CMD_WRITE_DELETED_DATA:
        // Deleted Data's mark can't be kept in an image file: it's written as data.
        if (drive.writeProtected) this.finish(FDC_RESULT_WRITE_PROTECT);
        else this.start('write', p[0], p[1], sizeAndCount & 0x1f, 128 << (sizeAndCount >> 5));
        return;
      case FDC_CMD_WRITE_DATA_128:
      case FDC_CMD_WRITE_DELETED_DATA_128:
        if (drive.writeProtected) this.finish(FDC_RESULT_WRITE_PROTECT);
        else this.start('write', p[0], p[1], 1, 128);
        return;
      case FDC_CMD_FORMAT_TRACK:
        // Not built: DFS's ROM never formats (*FORMAT is a utility on disc).
        this.finish(drive.writeProtected ? FDC_RESULT_WRITE_PROTECT : FDC_RESULT_DRIVE_NOT_READY);
        return;
      default:
        // Scan isn't built.
        this.finish(FDC_RESULT_DRIVE_NOT_READY);
    }
  }

  // ── Commands that take time (Stage 50) ────────────────────────────────

  /** Busy from now: an implied seek to `track`, then whatever op needs. */
  private start(op: DriveOp, track: number, sector: number, count: number, length: number): void {
    const port = this.specials[FDC_SPECIAL_OUTPUT_PORT];
    this.op = op;
    this.driveNumber = (port & FDC_OUTPUT_SELECT_1) !== 0 ? 1 : 0;
    this.side = (port & FDC_OUTPUT_SIDE) !== 0 ? 1 : 0;
    this.track = track;
    this.sector = sector;
    this.sectorsLeft = count;
    this.sectorLength = length;
    this.countdown = 0;
    this.statusByte = FDC_STATUS_COMMAND_BUSY;
    if (op !== 'seek' && count === 0) {
      // Nothing to read (our choice: the data sheet doesn't say what a count of 0 means).
      this.finish(FDC_RESULT_OK);
      return;
    }
    const drive = this.drive();
    const current = this.specials[this.currentTrackRegister()] ?? 0;
    if (track === 0) {
      // To track 0: step out until the drive says TRK0, whatever the register thinks.
      this.stepsLeft = drive?.track0 === true ? 0 : -1;
      this.stepDirection = -1;
    } else {
      this.stepsLeft = Math.abs(track - current);
      this.stepDirection = track > current ? 1 : -1;
    }
    if (this.stepsLeft === 0) {
      this.specials[this.currentTrackRegister()] = track;
      this.afterSeek();
      return;
    }
    this.phase = 'seeking';
    this.countdown += this.stepTime();
  }

  /** One thing happens: a step, the settle time ending, a sector arriving, a byte. */
  private event(): void {
    switch (this.phase) {
      case 'seeking':
        this.stepEvent();
        return;
      case 'settling':
        this.afterSeek();
        return;
      case 'searching':
        if (this.sectorAt < 0) {
          this.finish(FDC_RESULT_SECTOR_NOT_FOUND);
          return;
        }
        this.byteIndex = 0;
        this.phase = this.op === 'readId' ? 'id' : 'data';
        // A write asks for its first byte as the data field starts: it goes on the disc a byte time later.
        if (this.op === 'write') this.offerByte();
        this.countdown += CYCLES_PER_BYTE;
        return;
      case 'data':
        this.dataEvent();
        return;
      case 'id':
        this.idEvent();
        return;
      case 'crc':
        if ((this.statusByte & FDC_STATUS_DATA_REQUEST) !== 0) {
          this.lateByte();
          return;
        }
        this.finish(FDC_RESULT_OK);
        return;
      case 'idle':
        return;
    }
  }

  private stepEvent(): void {
    const drive = this.drive();
    drive?.step(this.stepDirection);
    const done = this.stepsLeft < 0 ? drive === undefined || drive.track0 : --this.stepsLeft === 0;
    if (!done) {
      this.countdown += this.stepTime();
      return;
    }
    this.specials[this.currentTrackRegister()] = this.track;
    this.phase = 'settling';
    this.countdown += this.specials[FDC_SPECIAL_HEAD_SETTLE] * FDC_TIME_UNIT_CYCLES;
  }

  /** The head is on the track. Seek is done; the others look for their sector. */
  private afterSeek(): void {
    if (this.op === 'seek') {
      this.finish(FDC_RESULT_OK);
      return;
    }
    this.search();
  }

  /**
   * Waits for the next field wanted to come round: sector `sector`'s data
   * field, or (Read ID) the next ID field. If the track hasn't got it, waits
   * FDC_SEARCH_REVOLUTIONS revolutions and gives up.
   */
  private search(): void {
    const drive = this.drive();
    const now = this.clock + this.countdown;
    this.phase = 'searching';
    if (this.op === 'readId') {
      // Any ID will do: the next slot boundary. Is there a formatted track here at all?
      this.sectorAt = drive === undefined ? -1 : drive.sectorOffset(this.side, 0);
      const wait = cyclesUntil(now, 0) % CYCLES_PER_SECTOR;
      this.idSector = (Math.floor(((now + wait) % CYCLES_PER_REVOLUTION) / CYCLES_PER_SECTOR) | 0) % SECTORS_PER_TRACK;
      this.countdown += this.sectorAt < 0 ? FDC_SEARCH_REVOLUTIONS * CYCLES_PER_REVOLUTION : wait;
      return;
    }
    // The IDs on the track say which track they're on: the head's, wherever the 8271 thinks it is.
    const here = drive !== undefined && drive.headTrack === this.track;
    this.sectorAt = here ? drive.sectorOffset(this.side, this.sector) : -1;
    if (this.sectorAt < 0) {
      this.countdown += FDC_SEARCH_REVOLUTIONS * CYCLES_PER_REVOLUTION;
      return;
    }
    this.countdown += cyclesUntil(now, this.sector * CYCLES_PER_SECTOR) + DATA_FIELD_START;
  }

  /** A byte of a data field has come off the disc, or (writing) is due to go on. */
  private dataEvent(): void {
    if (this.op === 'read') {
      if ((this.statusByte & FDC_STATUS_DATA_REQUEST) !== 0) {
        this.lateByte();
        return;
      }
      // A sector longer than DFS's 256 bytes would run into the gap: we read &00 there.
      this.dataByte = this.byteIndex < SECTOR_SIZE ? (this.drive()?.byteAt(this.sectorAt + this.byteIndex) ?? 0) : 0;
      this.offerByte();
    } else if (this.op === 'write') {
      // The byte asked for a byte time ago must be here now.
      if ((this.statusByte & FDC_STATUS_DATA_REQUEST) !== 0) {
        this.lateByte();
        return;
      }
      if (this.byteIndex < SECTOR_SIZE) this.drive()?.writeByte(this.sectorAt + this.byteIndex, this.dataByte);
    }
    this.byteIndex++;
    if (this.byteIndex < this.sectorLength) {
      if (this.op === 'write') this.offerByte();
      this.countdown += CYCLES_PER_BYTE;
      return;
    }
    this.sectorsLeft--;
    if (this.sectorsLeft > 0) {
      this.sector++;
      this.search();
      return;
    }
    this.phase = 'crc';
    this.countdown += CRC_BYTES * CYCLES_PER_BYTE;
  }

  /** A byte of an ID field (Read ID): track, head, sector, size code. */
  private idEvent(): void {
    if ((this.statusByte & FDC_STATUS_DATA_REQUEST) !== 0) {
      this.lateByte();
      return;
    }
    switch (this.byteIndex) {
      case 0:
        this.dataByte = this.drive()?.headTrack ?? 0;
        break;
      case 1:
        // The head number in the ID. We write 0 for both sides (unconfirmed for Acorn's double-sided format).
        this.dataByte = 0;
        break;
      case 2:
        this.dataByte = this.idSector;
        break;
      default:
        this.dataByte = DFS_SIZE_CODE;
    }
    this.offerByte();
    this.byteIndex++;
    if (this.byteIndex < ID_BYTES) {
      this.countdown += CYCLES_PER_BYTE;
      return;
    }
    this.sectorsLeft--;
    if (this.sectorsLeft > 0) {
      // Past the ID's CRC, then the next ID.
      this.countdown += CRC_BYTES * CYCLES_PER_BYTE;
      this.search();
      return;
    }
    this.phase = 'crc';
    this.countdown += CRC_BYTES * CYCLES_PER_BYTE;
  }

  /** Data request and INT (the NMI's edge): a byte is in the data register, or (writing) one is wanted there. */
  private offerByte(): void {
    this.statusByte |= FDC_STATUS_DATA_REQUEST | FDC_STATUS_INTERRUPT;
    this.transferred++;
  }

  /** The CPU didn't take (or give) the last byte in time. */
  private lateByte(): void {
    this.late++;
    this.transferred--;
    this.finish(FDC_RESULT_LATE_DMA);
  }

  // ── Endings ────────────────────────────────────────────────────────────

  /** Done, with a result and an interrupt: not busy, result full, INT. */
  private finish(result: number): void {
    this.phase = 'idle';
    this.resultByte = result;
    this.statusByte = FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT;
    this.log?.recordCommand(this.commandByte, this.params, this.paramsHeld, result, true);
  }

  /** Done, with a result but no interrupt (Read Special Register, Read Drive Status). */
  private finishQuietly(result: number): void {
    this.resultByte = result;
    this.statusByte = FDC_STATUS_RESULT_FULL;
    this.log?.recordCommand(this.commandByte, this.params, this.paramsHeld, result, true);
  }

  /** Done, with nothing to say (Specify, Write Special Register, a code that isn't a command). */
  private finishWithoutResult(): void {
    this.resultByte = FDC_RESULT_OK;
    this.statusByte = 0;
    this.log?.recordCommand(this.commandByte, this.params, this.paramsHeld, FDC_RESULT_OK, false);
  }

  private drive(): DiscDrive | undefined {
    return this.drives[this.driveNumber];
  }

  /** Surface 0's current track for drive 0, surface 1's for drive 1. */
  private currentTrackRegister(): number {
    return this.driveNumber === 0 ? FDC_SPECIAL_SURFACE0_CURRENT_TRACK : FDC_SPECIAL_SURFACE1_CURRENT_TRACK;
  }

  private stepTime(): number {
    return this.specials[FDC_SPECIAL_STEP_RATE] * FDC_TIME_UNIT_CYCLES;
  }
}
