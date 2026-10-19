// Stage 51: the 8271 writes. Write Data asks the CPU for each byte with a
// data request and INT (an NMI on the BBC), 128 cycles apart, and puts it on
// the disc. A write-protected disc refuses at once with &12.

import { DiscImage, SECTOR_SIZE, TRACK_SIZE } from '../disc/disc-image';
import { CYCLES_PER_BYTE, CYCLES_PER_REVOLUTION, CYCLES_PER_SECTOR, DATA_FIELD_START, DiscDrive } from './disc-drive';
import { describeFdcEntry } from './fdc-log';
import { FdcLog } from './fdc-log';
import type { CycleClock } from './hardware-log';
import {
  FDC_COMMAND,
  FDC_DATA,
  FDC_INPUT_WRITE_PROTECT,
  FDC_PARAMETER,
  FDC_RESULT,
  FDC_RESULT_LATE_DMA,
  FDC_RESULT_OK,
  FDC_RESULT_SECTOR_NOT_FOUND,
  FDC_RESULT_WRITE_PROTECT,
  FDC_STATUS_COMMAND_BUSY,
  FDC_STATUS_DATA_REQUEST,
  FDC_STATUS_INTERRUPT,
  FDC_STATUS_RESULT_FULL,
  Fdc8271,
} from './fdc8271';

const clock: CycleClock = { cycles: 0 };

interface Rig {
  readonly chip: Fdc8271;
  readonly disc: DiscImage;
  readonly drive: DiscDrive;
  readonly log: FdcLog;
}

/** A blank 40-track disc in drive 0, DFS 0.98's timings and non-DMA mode, the disc at its index hole. */
function rig(writeProtected = false): Rig {
  const drive = new DiscDrive();
  const disc = DiscImage.fromBytes(new Uint8Array(40 * TRACK_SIZE), 'ssd', 'blank.ssd');
  drive.insert(disc, writeProtected);
  const log = new FdcLog(clock, 64);
  const chip = new Fdc8271(log, [drive, new DiscDrive()]);
  send(chip, 0x35, 0x0d, 0x0c, 0x0a, 0xc8);
  send(chip, 0x3a, 0x17, 0xc1);
  return { chip, disc, drive, log };
}

function send(chip: Fdc8271, command: number, ...params: number[]): void {
  chip.write(FDC_COMMAND, command);
  for (const p of params) chip.write(FDC_PARAMETER, p);
}

const busy = (chip: Fdc8271): boolean => (chip.status & FDC_STATUS_COMMAND_BUSY) !== 0;
const wantsByte = (chip: Fdc8271): boolean => (chip.status & FDC_STATUS_DATA_REQUEST) !== 0;

/**
 * What a write NMI handler does: gives the next byte the moment one is
 * asked for, until the command ends. Returns when each request came.
 */
function supplyAll(chip: Fdc8271, next: (i: number) => number): number[] {
  const times: number[] = [];
  let cycles = 0;
  while (busy(chip)) {
    if (cycles > 20 * CYCLES_PER_REVOLUTION) throw new Error('still busy');
    if (wantsByte(chip)) {
      times.push(chip.time);
      chip.write(FDC_DATA, next(times.length - 1));
    }
    chip.tick(4);
    cycles += 4;
  }
  return times;
}

const sector = (disc: DiscImage, track: number, s: number): number[] => Array.from(disc.readSector(0, track, s));

describe('the write protect tab', () => {
  it('shows in Read Drive Status: bit 3 set with the tab on, clear without (&46 vs &4E)', () => {
    const open = rig(false).chip;
    send(open, 0x6c);
    expect(open.read(FDC_RESULT)).toBe(0x46);
    const tabbed = rig(true).chip;
    send(tabbed, 0x6c);
    expect(tabbed.read(FDC_RESULT) & FDC_INPUT_WRITE_PROTECT).toBe(FDC_INPUT_WRITE_PROTECT);
  });

  it('Write Data on a protected disc ends at once with &12 and INT, and the disc is untouched', () => {
    const { chip, disc } = rig(true);
    send(chip, 0x4b, 0, 2, 0x21);
    expect(chip.status).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_WRITE_PROTECT);
    expect(disc.changes).toBe(0);
  });
});

describe('Write Data (&0B, &4B for drive 0): a byte asked for every 128 cycles', () => {
  it('writes the 256 bytes the CPU gives into track 0 sector 2, and ends with &00', () => {
    const { chip, disc } = rig();
    send(chip, 0x4b, 0, 2, 0x21);
    supplyAll(chip, (i) => (i * 3) & 0xff);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
    expect(sector(disc, 0, 2)).toEqual(Array.from({ length: SECTOR_SIZE }, (_, i) => (i * 3) & 0xff));
    expect(sector(disc, 0, 1)).toEqual(new Array<number>(SECTOR_SIZE).fill(0));
    expect(sector(disc, 0, 3)).toEqual(new Array<number>(SECTOR_SIZE).fill(0));
    expect(chip.bytesTransferred).toBe(256);
  });

  it('asks with status bit 2 and INT (&8C); writing &FE84 drops both, so the next request is a new NMI edge', () => {
    const { chip } = rig();
    send(chip, 0x4b, 0, 0, 0x21);
    while (!wantsByte(chip)) chip.tick(4);
    expect(chip.status).toBe(FDC_STATUS_COMMAND_BUSY | FDC_STATUS_DATA_REQUEST | FDC_STATUS_INTERRUPT);
    expect(chip.interruptRequest).toBe(true);
    chip.write(FDC_DATA, 0x55);
    expect(chip.status).toBe(FDC_STATUS_COMMAND_BUSY);
    expect(chip.interruptRequest).toBe(false);
  });

  it('the first request comes as sector 3\'s data field comes round, and the rest 128 cycles apart', () => {
    const { chip } = rig();
    const start = chip.time;
    send(chip, 0x4b, 0, 3, 0x21);
    const times = supplyAll(chip, () => 0);
    expect(times).toHaveLength(256);
    // Each request is seen within 4 cycles of being made (supplyAll ticks 4 at a time).
    expect(times[0]).toBe(start + 3 * CYCLES_PER_SECTOR + DATA_FIELD_START);
    expect(times[1]).toBe(start + 3 * CYCLES_PER_SECTOR + DATA_FIELD_START + CYCLES_PER_BYTE);
    expect(times[255]).toBe(start + 3 * CYCLES_PER_SECTOR + DATA_FIELD_START + 255 * CYCLES_PER_BYTE);
  });

  it('size and count &22 writes two sectors in a row: 512 requests', () => {
    const { chip, disc } = rig();
    send(chip, 0x4b, 0, 4, 0x22);
    const times = supplyAll(chip, (i) => (i >> 8) + 1);
    expect(times).toHaveLength(512);
    expect(sector(disc, 0, 4)).toEqual(new Array<number>(SECTOR_SIZE).fill(1));
    expect(sector(disc, 0, 5)).toEqual(new Array<number>(SECTOR_SIZE).fill(2));
  });

  it('seeks first (implied seek): writing track 5 moves the head and fills track 5\'s sector, not track 0\'s', () => {
    const { chip, disc, drive } = rig();
    send(chip, 0x4b, 5, 0, 0x21);
    supplyAll(chip, () => 0xa5);
    expect(drive.headTrack).toBe(5);
    expect(sector(disc, 5, 0)).toEqual(new Array<number>(SECTOR_SIZE).fill(0xa5));
    expect(sector(disc, 0, 0)).toEqual(new Array<number>(SECTOR_SIZE).fill(0));
  });

  it('&0A writes one 128-byte record, leaving the rest of the sector alone', () => {
    const { chip, disc } = rig();
    send(chip, 0x4a, 0, 1);
    expect(supplyAll(chip, () => 0xff)).toHaveLength(128);
    const s = sector(disc, 0, 1);
    expect(s.slice(0, 128)).toEqual(new Array<number>(128).fill(0xff));
    expect(s.slice(128)).toEqual(new Array<number>(128).fill(0));
  });

  it('Write Deleted Data (&4F) writes the bytes too: an image file can\'t keep the deleted mark', () => {
    const { chip, disc } = rig();
    send(chip, 0x4f, 0, 2, 0x21);
    supplyAll(chip, () => 0x42);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_OK);
    expect(sector(disc, 0, 2)).toEqual(new Array<number>(SECTOR_SIZE).fill(0x42));
  });

  it('what was written reads back with Read Data', () => {
    const { chip } = rig();
    send(chip, 0x4b, 0, 7, 0x21);
    supplyAll(chip, (i) => 255 - i);
    chip.read(FDC_RESULT);
    send(chip, 0x53, 0, 7, 0x21);
    const got: number[] = [];
    while (busy(chip)) {
      if (wantsByte(chip)) got.push(chip.read(FDC_DATA));
      chip.tick(4);
    }
    expect(got).toEqual(Array.from({ length: SECTOR_SIZE }, (_, i) => 255 - i));
  });

  it('is logged when it ends, with its result', () => {
    const { chip, log } = rig();
    send(chip, 0x4b, 0, 2, 0x21);
    supplyAll(chip, () => 0);
    const last = log.recent().at(-1);
    expect(last === undefined ? '' : `${describeFdcEntry(last).bytes} ${describeFdcEntry(last).text}`).toBe(
      '4B 00 02 21 Write Data, track 0 sector 2, 1 × 256 bytes → &00 OK',
    );
  });
});

describe('Write Data going wrong', () => {
  it('a byte not given in time ends the command with &0A late DMA, and nothing is written', () => {
    const { chip, disc } = rig();
    send(chip, 0x4b, 0, 2, 0x21);
    while (!wantsByte(chip)) chip.tick(4);
    chip.tick(CYCLES_PER_BYTE);
    expect(busy(chip)).toBe(false);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_LATE_DMA);
    expect(chip.lateBytes).toBe(1);
    expect(disc.changes).toBe(0);
  });

  it('a late byte part way through keeps the bytes already written', () => {
    const { chip, disc } = rig();
    send(chip, 0x4b, 0, 2, 0x21);
    for (let i = 0; i < 10; i++) {
      while (!wantsByte(chip)) chip.tick(4);
      chip.write(FDC_DATA, 0x99);
    }
    while (busy(chip)) chip.tick(4);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_LATE_DMA);
    expect(sector(disc, 0, 2).slice(0, 11)).toEqual([...new Array<number>(10).fill(0x99), 0]);
  });

  it('sector 10 isn\'t on the track: &18 sector not found after two revolutions, and no requests', () => {
    const { chip } = rig();
    send(chip, 0x4b, 0, 10, 0x21);
    expect(supplyAll(chip, () => 0)).toHaveLength(0);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_SECTOR_NOT_FOUND);
  });
});
