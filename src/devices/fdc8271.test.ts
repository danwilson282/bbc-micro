import { FdcLog } from './fdc-log';
import type { CycleClock } from './hardware-log';
import {
  FDC_COMMAND,
  FDC_DATA,
  FDC_PARAMETER,
  FDC_RESET,
  FDC_RESULT,
  FDC_RESULT_DRIVE_NOT_READY,
  FDC_SPECIAL_MODE,
  FDC_SPECIAL_OUTPUT_PORT,
  FDC_STATUS,
  FDC_STATUS_COMMAND_BUSY,
  FDC_STATUS_INTERRUPT,
  FDC_STATUS_RESULT_FULL,
  Fdc8271,
} from './fdc8271';

const clock: CycleClock = { cycles: 0 };

function fdc(): { chip: Fdc8271; log: FdcLog } {
  const log = new FdcLog(clock, 64);
  return { chip: new Fdc8271(log), log };
}

/** What the DFS does: the command at &FE80, then each parameter at &FE81. */
function send(chip: Fdc8271, command: number, ...params: number[]): void {
  chip.write(FDC_COMMAND, command);
  for (const p of params) chip.write(FDC_PARAMETER, p);
}

describe('8271: the status register (&FE80, read)', () => {
  it('after reset it reads &00: not busy, no result, no interrupt', () => {
    expect(fdc().chip.read(FDC_STATUS)).toBe(0x00);
  });

  it('writing a command sets bit 7 (command busy) until its last parameter arrives', () => {
    const { chip } = fdc();
    chip.write(FDC_COMMAND, 0x7a); // Write Special Register: 2 parameters
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_COMMAND_BUSY);
    chip.write(FDC_PARAMETER, 0x17);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_COMMAND_BUSY);
    chip.write(FDC_PARAMETER, 0xc1);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
  });

  it('reading the status has no side effects: a waiting result stays waiting', () => {
    const { chip } = fdc();
    send(chip, 0x6c);
    chip.read(FDC_STATUS);
    chip.read(FDC_STATUS);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL);
  });
});

describe('8271: commands that set special registers', () => {
  it('Write Special Register &7A &17 &C1 puts &C1 in the mode register, with no result', () => {
    const { chip } = fdc();
    send(chip, 0x7a, FDC_SPECIAL_MODE, 0xc1);
    expect(chip.special(FDC_SPECIAL_MODE)).toBe(0xc1);
    expect(chip.read(FDC_STATUS) & FDC_STATUS_RESULT_FULL).toBe(0);
  });

  it('Specify &75 &0D &02 &08 &C0 loads three special registers in a row: &0D, &0E, &0F', () => {
    const { chip } = fdc();
    send(chip, 0x75, 0x0d, 0x02, 0x08, 0xc0);
    expect([chip.special(0x0d), chip.special(0x0e), chip.special(0x0f)]).toEqual([0x02, 0x08, 0xc0]);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
  });

  it('Specify &75 &10 &FF &FF &00 sets surface 0 bad tracks (none) and its current track, &10-&12', () => {
    const { chip } = fdc();
    send(chip, 0x75, 0x10, 0xff, 0xff, 0x00);
    expect([chip.special(0x10), chip.special(0x11), chip.special(0x12)]).toEqual([0xff, 0xff, 0x00]);
  });

  it('Read Special Register &7D &17 returns the mode register in the result register (bit 4), with no interrupt', () => {
    const { chip } = fdc();
    send(chip, 0x7a, FDC_SPECIAL_MODE, 0xc1);
    send(chip, 0x7d, FDC_SPECIAL_MODE);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL);
    expect(chip.read(FDC_RESULT)).toBe(0xc1);
  });

  it('the drive control output port (&23) keeps what the DFS writes: &48 is SELECT 0 + LOAD HEAD', () => {
    const { chip } = fdc();
    send(chip, 0x7a, FDC_SPECIAL_OUTPUT_PORT, 0x48);
    expect(chip.special(FDC_SPECIAL_OUTPUT_PORT)).toBe(0x48);
  });
});

describe('8271: the result register (&FE81, read)', () => {
  it('reading it clears result full (bit 4) and the interrupt request (bit 3)', () => {
    const { chip } = fdc();
    send(chip, 0x69, 0x00); // Seek: a result and an interrupt
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.interruptRequest).toBe(true);
    chip.read(FDC_RESULT);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
    expect(chip.interruptRequest).toBe(false);
  });

  it('peek() shows the result without taking it: bit 4 stays set', () => {
    const { chip } = fdc();
    send(chip, 0x6c);
    expect(chip.peek(FDC_RESULT)).toBe(0x00);
    expect(chip.peek(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL);
  });
});

describe('8271: with no drive connected (Stage 49)', () => {
  it('Read Drive Status &6C has no parameters, runs at once, and returns &00: RDY0 (bit 2) and RDY1 (bit 6) low', () => {
    const { chip } = fdc();
    chip.write(FDC_COMMAND, 0x6c);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL);
    expect(chip.read(FDC_RESULT)).toBe(0x00);
  });

  it('Seek &69 &05 ends at once with result &10 (drive not ready) and raises the interrupt request', () => {
    const { chip } = fdc();
    send(chip, 0x69, 0x05);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL | FDC_STATUS_INTERRUPT);
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_DRIVE_NOT_READY);
  });

  it('Read Data multi-record &53 waits for all 3 parameters, then ends with &10', () => {
    const { chip } = fdc();
    send(chip, 0x53, 0x00, 0x00);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_COMMAND_BUSY);
    chip.write(FDC_PARAMETER, 0x22); // 256-byte sectors, 2 of them
    expect(chip.read(FDC_RESULT)).toBe(FDC_RESULT_DRIVE_NOT_READY);
  });

  it('a Seek does not move the current track special register while the drive is not ready', () => {
    const { chip } = fdc();
    send(chip, 0x75, 0x10, 0xff, 0xff, 0x00);
    send(chip, 0x69, 0x05);
    expect(chip.special(0x12)).toBe(0x00);
  });

  it('the data register (&FE84) reads &00 and ignores writes until Stage 50', () => {
    const { chip } = fdc();
    chip.write(FDC_DATA, 0x55);
    expect(chip.read(FDC_DATA)).toBe(0x00);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
  });
});

describe('8271: the handshake going wrong', () => {
  it('a command written while busy is ignored (the DFS waits for bit 7 to clear so this never happens)', () => {
    const { chip } = fdc();
    chip.write(FDC_COMMAND, 0x7a);
    chip.write(FDC_COMMAND, 0x6c); // ignored
    chip.write(FDC_PARAMETER, FDC_SPECIAL_MODE);
    chip.write(FDC_PARAMETER, 0xc1);
    expect(chip.special(FDC_SPECIAL_MODE)).toBe(0xc1);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
  });

  it('a parameter written with no command waiting is ignored', () => {
    const { chip, log } = fdc();
    chip.write(FDC_PARAMETER, 0x17);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
    expect(log.count).toBe(0);
  });

  it('a new command throws away a result nobody read', () => {
    const { chip } = fdc();
    send(chip, 0x69, 0x00);
    send(chip, 0x7a, FDC_SPECIAL_MODE, 0xc1);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
  });

  it('a command code with no meaning (&41) takes no parameters and finishes with no result (our choice)', () => {
    const { chip, log } = fdc();
    chip.write(FDC_COMMAND, 0x41);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
    expect(log.recent()[0]?.command).toBe(0x41);
  });
});

describe('8271: the reset register (&FE82, write)', () => {
  it('&01 abandons a half-sent command; commands are ignored until &00 lets the chip go', () => {
    const { chip } = fdc();
    chip.write(FDC_COMMAND, 0x7a);
    chip.write(FDC_PARAMETER, FDC_SPECIAL_MODE);
    chip.write(FDC_RESET, 0x01);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
    expect(chip.inReset).toBe(true);
    chip.write(FDC_COMMAND, 0x6c); // ignored: held in reset
    expect(chip.read(FDC_STATUS)).toBe(0x00);
    chip.write(FDC_RESET, 0x00);
    expect(chip.inReset).toBe(false);
    chip.write(FDC_COMMAND, 0x6c);
    expect(chip.read(FDC_STATUS)).toBe(FDC_STATUS_RESULT_FULL);
  });

  it('clears a waiting result and interrupt, but keeps the special registers (our choice: unconfirmed)', () => {
    const { chip } = fdc();
    send(chip, 0x7a, FDC_SPECIAL_MODE, 0xc1);
    send(chip, 0x69, 0x00);
    chip.write(FDC_RESET, 0x01);
    chip.write(FDC_RESET, 0x00);
    expect(chip.read(FDC_STATUS)).toBe(0x00);
    expect(chip.interruptRequest).toBe(false);
    expect(chip.special(FDC_SPECIAL_MODE)).toBe(0xc1);
  });

  it('only bit 0 matters: &FE is "let go", &FF is "hold"', () => {
    const { chip } = fdc();
    chip.write(FDC_RESET, 0xff);
    expect(chip.inReset).toBe(true);
    chip.write(FDC_RESET, 0xfe);
    expect(chip.inReset).toBe(false);
  });
});

describe('8271: what it tells the log', () => {
  it('each command, its parameters and its result, when it runs', () => {
    const { chip, log } = fdc();
    send(chip, 0x75, 0x0d, 0x02, 0x08, 0xc0);
    send(chip, 0x69, 0x00);
    const [specify, seek] = log.recent();
    expect(specify).toMatchObject({ kind: 'command', command: 0x75, params: [0x0d, 0x02, 0x08, 0xc0], result: undefined, repeats: 1 });
    expect(seek).toMatchObject({ kind: 'command', command: 0x69, params: [0x00], result: FDC_RESULT_DRIVE_NOT_READY });
  });

  it('a reset through &FE82 is logged once, when bit 0 goes from 0 to 1', () => {
    const { chip, log } = fdc();
    chip.write(FDC_RESET, 0x01);
    chip.write(FDC_RESET, 0x01);
    chip.write(FDC_RESET, 0x00);
    expect(log.recent().map((e) => e.kind)).toEqual(['reset']);
  });
});
