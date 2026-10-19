// Stage 50: the 8271 with drives. Seek, Read Data, Verify and Read ID, with
// time passing, data requests and the INT pin.

import { DiscImage, SECTOR_SIZE, TRACK_SIZE } from '../disc/disc-image';
import { CYCLES_PER_BYTE, CYCLES_PER_REVOLUTION, CYCLES_PER_SECTOR, DATA_FIELD_START, DiscDrive } from './disc-drive';
import { FdcLog } from './fdc-log';
import type { CycleClock } from './hardware-log';
import {
  FDC_COMMAND,
  FDC_DATA,
  FDC_INPUT_READY_0,
  FDC_INPUT_READY_1,
  FDC_INPUT_TRACK_0,
  FDC_INPUT_WRITE_PROTECT,
  FDC_PARAMETER,
  FDC_RESET,
  FDC_RESULT,
  FDC_RESULT_DRIVE_NOT_READY,
  FDC_RESULT_LATE_DMA,
  FDC_RESULT_OK,
  FDC_RESULT_SECTOR_NOT_FOUND,
  FDC_RESULT_WRITE_PROTECT,
  FDC_SPECIAL_OUTPUT_PORT,
  FDC_SPECIAL_SURFACE0_CURRENT_TRACK,
  FDC_SPECIAL_SURFACE1_CURRENT_TRACK,
  FDC_STATUS_COMMAND_BUSY,
  FDC_STATUS_DATA_REQUEST,
  FDC_STATUS_INTERRUPT,
  FDC_STATUS_RESULT_FULL,
  Fdc8271,
} from './fdc8271';

const clock: CycleClock = { cycles: 0 };

/** Every byte says where it came from: side × &80 + track in the high part, sector, and the byte's index. */
function image(format: 'ssd' | 'dsd' = 'ssd', tracks = 40): DiscImage {
  const sides = format === 'ssd' ? 1 : 2;
  const bytes = new Uint8Array(sides * tracks * TRACK_SIZE);
  for (let track = 0; track < tracks; track++) {
    for (let side = 0; side < sides; side++) {
      for (let sector = 0; sector < 10; sector++) {
        const at = ((track * sides + side) * 10 + sector) * SECTOR_SIZE;
        bytes[at] = side * 0x80 + track;
        bytes[at + 1] = sector;
        for (let i = 2; i < SECTOR_SIZE; i++) bytes[at + i] = i;
      }
    }
  }
  return DiscImage.fromBytes(bytes, format, `t.${format}`);
}

interface Rig {
  readonly chip: Fdc8271;
  readonly drives: readonly [DiscDrive, DiscDrive];
  readonly log: FdcLog;
}

/** An 8271 with two drives, a disc in drive 0, DFS 0.98's timings (&0C, &0A) and non-DMA mode. */
function rig(disc: DiscImage | 'empty' = image()): Rig {
  const drives = [new DiscDrive(), new DiscDrive()] as const;
  if (disc !== 'empty') drives[0].insert(disc);
  const log = new FdcLog(clock, 64);
  const chip = new Fdc8271(log, drives);
  send(chip, 0x35, 0x0d, 0x0c, 0x0a, 0xc8);
  send(chip, 0x3a, 0x17, 0xc1);
  return { chip, drives, log };
}

function send(chip: Fdc8271, command: number, ...params: number[]): void {
  chip.write(FDC_COMMAND, command);
  for (const p of params) chip.write(FDC_PARAMETER, p);
}

/** Ticks a few cycles at a time, like instructions, until the test holds. Returns the cycles it took. */
function tickUntil(chip: Fdc8271, done: () => boolean, limit = 3 * CYCLES_PER_REVOLUTION): number {
  let cycles = 0;
  while (!done()) {
    if (cycles >= limit) throw new Error(`still waiting after ${String(cycles)} cycles (status &${chip.status.toString(16)})`);
    chip.tick(4);
    cycles += 4;
  }
  return cycles;
}

/** What an NMI handler does: takes every byte the moment it's asked for, until the command ends. */
function readAll(chip: Fdc8271): number[] {
  const bytes: number[] = [];
  tickUntil(chip, () => {
    if ((chip.status & FDC_STATUS_DATA_REQUEST) !== 0) bytes.push(chip.read(FDC_DATA));
    return (chip.status & FDC_STATUS_COMMAND_BUSY) === 0;
  }, 10 * CYCLES_PER_REVOLUTION);
  return bytes;
}

/** Moves the disc on to a whole revolution, so the index hole is under the head. */
function toIndex(chip: Fdc8271): void {
  chip.tick(CYCLES_PER_REVOLUTION - (chip.time % CYCLES_PER_REVOLUTION));
}

describe('8271 with a drive: Read Drive Status reports the selected drive\'s lines', () => {
  it('drive 0 with a disc, head on track 0: READY on bits 2 and 6 (one READY wire), TRK0, WRITE PROTECT → &4E', () => {
    const { chip } = rig();
    send(chip, 0x6c);
    expect(chip.read(FDC_RESULT)).toBe(FDC_INPUT_READY_0 | FDC_INPUT_READY_1 | FDC_INPUT_TRACK_0 | FDC_INPUT_WRITE_PROTECT);
  });

  it('the command\'s drive bits select the drive: &AC asks drive 1, which is empty → &02 (TRK0 only, no READY)', () => {
    const { chip } = rig();
    send(chip, 0xac);
    expect(chip.read(FDC_RESULT)).toBe(FDC_INPUT_TRACK_0);
    expect(chip.special(FDC_SPECIAL_OUTPUT_PORT) & 0xc0).toBe(0x80);
  });

  it('Write Special Register &23 = &48 selects drive 0 too (what DFS 0.98 sends before polling)', () => {
    const { chip } = rig();
    send(chip, 0x3a, 0x23, 0x48);
    send(chip, 0x3d, 0x22); // Read Special Register: the input port
    expect(chip.read(FDC_RESULT)).toBe(0x4e);
  });

  it('commands with drive bits 00 (Specify, Write Special Register) leave the selection alone', () => {
    const { chip } = rig();
    send(chip, 0x6c);
    send(chip, 0x3a, 0x17, 0xc1);
    expect(chip.special(FDC_SPECIAL_OUTPUT_PORT) & 0xc0).toBe(0x40);
  });
});

describe('8271 with a drive: Seek moves the head, taking time', () => {
  it('Seek 5 from track 0: busy for 5 steps × 24 ms + 20 ms settling, then result &00 with an interrupt', () => {
    const { chip, drives } = rig();
    send(chip, 0x69, 5);
    expect(chip.status).toBe(FDC_STATUS_COMMAND_BUSY);
    const cycles = tickUntil(chip, () => chip.status !== FDC_STATUS_COMMAND_BUSY);
    expect(cycles).toBeGreaterThanOrEqual(5 * 48_000 + 40_000);
    expect(cycles).toBeLessThan(5 * 48_000 + 40_000 + 8);
    expect(chip.status).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.interruptRequest).toBe(true);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
    expect(drives[0].headTrack).toBe(5);
    expect(chip.special(FDC_SPECIAL_SURFACE0_CURRENT_TRACK)).toBe(5);
  });

  it('the head steps one track per step-rate time, not all at once', () => {
    const { chip, drives } = rig();
    send(chip, 0x69, 3);
    chip.tick(48_000);
    expect(drives[0].headTrack).toBe(1);
  });

  it('Seek to the track it is on takes no steps and no settling: done at once', () => {
    const { chip } = rig();
    send(chip, 0x69, 0);
    expect(chip.status).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
  });

  it('Seek 0 steps out until the drive says TRK0, even when the current track register is wrong', () => {
    const { chip, drives } = rig();
    for (let i = 0; i < 7; i++) drives[0].step(1); // the head is really on 7; the 8271 thinks 0
    send(chip, 0x69, 0);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0);
    expect(drives[0].headTrack).toBe(0);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
  });

  it('drive 1 keeps its own current track register, &1A', () => {
    const { chip, drives } = rig();
    drives[1].insert(image());
    send(chip, 0xa9, 2);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0);
    expect(chip.special(FDC_SPECIAL_SURFACE1_CURRENT_TRACK)).toBe(2);
    expect(drives[1].headTrack).toBe(2);
    expect(drives[0].headTrack).toBe(0);
  });

  it('with no disc in the drive it still ends at once with &10 drive not ready', () => {
    const { chip } = rig('empty');
    send(chip, 0x69, 5);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_DRIVE_NOT_READY);
  });
});

describe('8271 with a drive: Read Data, one byte at a time', () => {
  it('Read Data &53 track 0, sector 0, &21 (one 256-byte sector) gives exactly that sector\'s bytes, then &00', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 0, 0x21);
    const bytes = readAll(chip);
    expect(bytes).toHaveLength(256);
    expect(bytes.slice(0, 4)).toEqual([0x00, 0x00, 0x02, 0x03]);
    expect(chip.status).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
    expect(chip.bytesTransferred).toBe(256);
  });

  it('each byte raises data request (bit 2) and INT (bit 3) with busy: status &8C. Reading &FE84 drops both: &80', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 0, 0x21);
    tickUntil(chip, () => chip.status !== FDC_STATUS_COMMAND_BUSY);
    expect(chip.status).toBe(FDC_STATUS_COMMAND_BUSY | FDC_STATUS_INTERRUPT | FDC_STATUS_DATA_REQUEST);
    expect(chip.interruptRequest).toBe(true);
    chip.read(FDC_DATA);
    expect(chip.status).toBe(FDC_STATUS_COMMAND_BUSY);
    expect(chip.interruptRequest).toBe(false);
  });

  it('the bytes come 128 cycles (64 µs) apart', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 0, 0x21);
    const hasByte = (): boolean => (chip.status & FDC_STATUS_DATA_REQUEST) !== 0;
    tickUntil(chip, hasByte);
    chip.read(FDC_DATA);
    expect(tickUntil(chip, hasByte)).toBe(CYCLES_PER_BYTE);
  });

  it('it waits for the sector to come round: sector 3 from the index hole starts 3 × 40,000 + 2,048 cycles later', () => {
    const { chip } = rig();
    toIndex(chip);
    send(chip, 0x53, 0, 3, 0x21);
    const wait = tickUntil(chip, () => (chip.status & FDC_STATUS_DATA_REQUEST) !== 0);
    expect(wait).toBe(3 * CYCLES_PER_SECTOR + DATA_FIELD_START + CYCLES_PER_BYTE);
  });

  it('a sector that has just gone by means waiting for nearly a whole revolution', () => {
    const { chip } = rig();
    toIndex(chip);
    chip.tick(CYCLES_PER_SECTOR + 100); // sector 1's ID has gone past
    send(chip, 0x53, 0, 1, 0x21);
    const wait = tickUntil(chip, () => (chip.status & FDC_STATUS_DATA_REQUEST) !== 0);
    expect(wait).toBeGreaterThan(CYCLES_PER_REVOLUTION - 200);
  });

  it('&22 reads two sectors, one after the other: 512 bytes (what *CAT asks for)', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 0, 0x22);
    const bytes = readAll(chip);
    expect(bytes).toHaveLength(512);
    expect(bytes[256 + 1]).toBe(1); // sector 1's second byte is its number
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
  });

  it('an implied seek: Read Data on track 4 moves the head there first', () => {
    const { chip, drives } = rig();
    send(chip, 0x53, 4, 9, 0x21);
    const bytes = readAll(chip);
    expect(drives[0].headTrack).toBe(4);
    expect(bytes.slice(0, 2)).toEqual([4, 9]);
  });

  it('&52 (Read Data, one 128-byte record) takes two parameters and gives 128 bytes', () => {
    const { chip } = rig();
    send(chip, 0x52, 0, 2);
    expect(readAll(chip)).toHaveLength(128);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
  });

  it('&57 (Read Data and Deleted Data) reads like &53: our images have no deleted marks', () => {
    const { chip } = rig();
    send(chip, 0x57, 0, 0, 0x21);
    expect(readAll(chip)).toHaveLength(256);
  });

  it('side 1 of a .dsd when the output port\'s SIDE bit (5) is set: &23 = &68 is DFS drive 2', () => {
    const { chip } = rig(image('dsd'));
    send(chip, 0x3a, 0x23, 0x68);
    send(chip, 0x53, 3, 0, 0x21);
    expect(readAll(chip)[0]).toBe(0x80 + 3);
  });
});

describe('8271 with a drive: when a read goes wrong', () => {
  it('a byte not taken before the next arrives ends the command: &0A late DMA, busy off, INT', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 0, 0x21);
    tickUntil(chip, () => (chip.status & FDC_STATUS_DATA_REQUEST) !== 0);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0, 2 * CYCLES_PER_BYTE);
    expect(chip.status).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_LATE_DMA);
    expect(chip.lateBytes).toBe(1);
  });

  it('sector 10 never comes round: after two revolutions, &18 sector not found', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 10, 0x21);
    const cycles = tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0);
    expect(cycles).toBeGreaterThanOrEqual(2 * CYCLES_PER_REVOLUTION);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_SECTOR_NOT_FOUND);
  });

  it('a track past the end of a 40-track disc has no sectors: &18', () => {
    const { chip } = rig();
    send(chip, 0x53, 45, 0, 0x21);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0, 10 * CYCLES_PER_REVOLUTION);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_SECTOR_NOT_FOUND);
  });

  it('IDs that say a different track (the 8271 is wrong about where the head is) mean &18', () => {
    const { chip, drives } = rig();
    send(chip, 0x69, 2);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0);
    chip.read(FDC_RESULT);
    drives[0].step(1); // the head is on 3; the current track register says 2
    send(chip, 0x53, 2, 0, 0x21);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_SECTOR_NOT_FOUND);
  });

  it('side 1 of a single-sided disc: &18', () => {
    const { chip } = rig();
    send(chip, 0x3a, 0x23, 0x68);
    send(chip, 0x53, 0, 0, 0x21);
    tickUntil(chip, () => (chip.status & FDC_STATUS_COMMAND_BUSY) === 0);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_SECTOR_NOT_FOUND);
  });

  it('writing to &FE82 in the middle of a read abandons it: not busy, nothing more arrives', () => {
    const { chip } = rig();
    send(chip, 0x53, 0, 0, 0x22);
    tickUntil(chip, () => (chip.status & FDC_STATUS_DATA_REQUEST) !== 0);
    chip.write(FDC_RESET, 1);
    chip.write(FDC_RESET, 0);
    chip.tick(CYCLES_PER_REVOLUTION);
    expect(chip.status).toBe(0x00);
    expect(chip.interruptRequest).toBe(false);
  });

  it('Write Data on a ready drive ends at once with &12 write protect: our discs are read-only', () => {
    const { chip } = rig();
    send(chip, 0x4b, 0, 0, 0x21);
    expect(chip.status).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_WRITE_PROTECT);
  });
});

describe('8271 with a drive: Verify and Read ID', () => {
  it('Verify &5F reads the sectors with no data requests, then &00', () => {
    const { chip } = rig();
    toIndex(chip);
    send(chip, 0x5f, 0, 0, 0x22);
    let requests = 0;
    const cycles = tickUntil(chip, () => {
      if ((chip.status & FDC_STATUS_DATA_REQUEST) !== 0) requests++;
      return (chip.status & FDC_STATUS_COMMAND_BUSY) === 0;
    });
    expect(requests).toBe(0);
    expect(cycles).toBeGreaterThan(CYCLES_PER_SECTOR + DATA_FIELD_START + 256 * CYCLES_PER_BYTE);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
  });

  it('Read ID &5B track 2, &00, 3 gives the next three IDs to pass: track, head, sector, size code 1', () => {
    const { chip } = rig();
    toIndex(chip);
    chip.tick(CYCLES_PER_SECTOR * 4 + 10); // sector 4's ID has just started going past
    send(chip, 0x5b, 2, 0, 3);
    const bytes = readAll(chip);
    // The seek to track 2 takes 2 × 24 + 20 ms = 136,000 cycles: the IDs of sectors 8, 9 and then 0 come next.
    expect(bytes).toEqual([2, 0, 8, 1, 2, 0, 9, 1, 2, 0, 0, 1]);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
  });
});

describe('8271 with a drive: the log', () => {
  it('a read is logged when it finishes, with its result', () => {
    const { chip, log } = rig();
    send(chip, 0x53, 0, 0, 0x21);
    expect(log.recent().at(-1)?.command).toBe(0x3a); // the set-up, not the read yet
    readAll(chip);
    expect(log.recent().at(-1)).toMatchObject({ command: 0x53, params: [0, 0, 0x21], result: 0x00 });
  });
});
