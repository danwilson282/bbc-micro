import { TestBus } from '../../memory/test-bus';
import { playgroundTarget, type CpuTarget } from './debug-target';
import { CYCLES_PER_FRAME, RUN_START, advanceRun, describeRunState, runFor, stopRun, type RunState } from './run-model';

const NOP = 0xea;
const BRK = 0x00;

/** A playground whose reset vector points at &0400, reset already done. */
function playground(program: readonly number[]): { target: CpuTarget; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffc, [0x00, 0x04]);
  bus.load(0x0400, program);
  const target = playgroundTarget(bus);
  target.reset();
  return { target, bus };
}

// &0400 A2 05   LDX #5
// &0402 CA      DEX          ← loop
// &0403 D0 FD   BNE &0402
// &0405 00      BRK
const COUNTDOWN = [0xa2, 0x05, 0xca, 0xd0, 0xfd, BRK];

describe('runFor', () => {
  it('runs a loop until the next opcode is BRK, and stops with PC on the BRK, before running it', () => {
    const { target } = playground(COUNTDOWN);
    const slice = runFor(target, 1000);
    // LDX, then 5 × DEX, 5 × BNE: 4 taken (3 cycles) and 1 not (2)
    expect(slice).toEqual({ steps: 11, cycles: 2 + 5 * 2 + 4 * 3 + 2, stop: 'brk', error: undefined });
    expect(target.registers.pc).toBe(0x0405);
  });

  it('stops straight away, having run nothing, if PC is already on a BRK', () => {
    const { target } = playground([BRK]);
    expect(runFor(target, 1000)).toEqual({ steps: 0, cycles: 0, stop: 'brk', error: undefined });
  });

  it('stops once it has used up its cycle budget, finishing the instruction it was on', () => {
    const { target } = playground(new Array<number>(100).fill(NOP));
    // NOPs are 2 cycles: 5 of them reach the budget of 9 (the 5th overshoots by 1).
    expect(runFor(target, 9)).toEqual({ steps: 5, cycles: 10, stop: 'budget', error: undefined });
    expect(target.registers.pc).toBe(0x0405);
  });

  it('stops at an unimplemented opcode with its message, PC left on it', () => {
    const { target } = playground([NOP, 0x4c, 0x00, 0x04]); // NOP, JMP &0400 (Stage 15)
    expect(runFor(target, 1000)).toEqual({ steps: 1, cycles: 2, stop: 'error', error: 'unimplemented opcode &4C at &0401' });
    expect(target.registers.pc).toBe(0x0401);
  });
});

describe('advanceRun: one browser frame of a Run', () => {
  it('a frame is 40,000 cycles: one 50 Hz video frame at 2 MHz', () => {
    expect(CYCLES_PER_FRAME).toBe(2_000_000 / 50);
  });

  it('adds each frame to the running totals, and is not over until something stops it', () => {
    // An endless loop: &0400 D0 FE  BNE &0400 (Z=0 after reset)
    const { target } = playground([0xd0, 0xfe]);
    const one = advanceRun(target, RUN_START, 1_000_000, 300);
    expect(one).toEqual({ steps: 100, cycles: 300, end: undefined, error: undefined });
    const two = advanceRun(target, one, 1_000_000, 300);
    expect(two).toEqual({ steps: 200, cycles: 600, end: undefined, error: undefined });
  });

  it('ends at the cycle limit, taking only what is left of it in the last frame', () => {
    const { target } = playground([0xd0, 0xfe]);
    let state: RunState = RUN_START;
    let frames = 0;
    while (state.end === undefined) {
      state = advanceRun(target, state, 900, 300);
      frames++;
    }
    expect({ frames, end: state.end, cycles: state.cycles }).toEqual({ frames: 3, end: 'limit', cycles: 900 });
  });

  it('ends at BRK', () => {
    const { target } = playground(COUNTDOWN);
    expect(advanceRun(target, RUN_START)).toMatchObject({ steps: 11, end: 'brk' });
  });

  it('ends at an unimplemented opcode, keeping its message', () => {
    const { target } = playground([0x4c]);
    expect(advanceRun(target, RUN_START)).toEqual({ steps: 0, cycles: 0, end: 'error', error: 'unimplemented opcode &4C at &0400' });
  });

  it('clears the write log each frame, so the Memory panel shows the latest frame\'s writes', () => {
    // &0400 E6 80  INC &80, then BNE back: 2 writes per pass
    const { target } = playground([0xe6, 0x80, 0xd0, 0xfc]);
    advanceRun(target, RUN_START, 1_000_000, 8); // INC (5) + BNE (3): one pass
    expect(target.writes.count).toBe(2);
    advanceRun(target, RUN_START, 1_000_000, 8);
    expect(target.writes.count).toBe(2);
  });
});

describe('stopRun', () => {
  it('marks a run as stopped by you, keeping its totals', () => {
    expect(stopRun({ steps: 3, cycles: 9, end: undefined, error: undefined })).toEqual({ steps: 3, cycles: 9, end: 'stopped', error: undefined });
  });

  it('leaves a run that has already ended as it was', () => {
    const ended: RunState = { steps: 3, cycles: 9, end: 'brk', error: undefined };
    expect(stopRun(ended)).toBe(ended);
  });
});

describe('describeRunState', () => {
  const totals = { steps: 1234, cycles: 340_000, error: undefined };

  it('while running: instructions and cycles so far', () => {
    expect(describeRunState({ ...totals, end: undefined }, 0x0410)).toBe('Running… 1,234 instructions, 340,000 cycles = 170 ms at 2 MHz');
  });

  it('at BRK: where it stopped, and why it stopped there', () => {
    expect(describeRunState({ ...totals, end: 'brk' }, 0x0431)).toBe(
      'Stopped at BRK (&0431) after 1,234 instructions, 340,000 cycles = 170 ms at 2 MHz',
    );
  });

  it('at the limit, when stopped by you, and at an unimplemented opcode', () => {
    expect(describeRunState({ ...totals, end: 'limit' }, 0x0410)).toBe(
      'Stopped at the cycle limit after 1,234 instructions, 340,000 cycles = 170 ms at 2 MHz',
    );
    expect(describeRunState({ ...totals, end: 'stopped' }, 0x0410)).toBe(
      'Stopped by you at &0410 after 1,234 instructions, 340,000 cycles = 170 ms at 2 MHz',
    );
    expect(describeRunState({ ...totals, end: 'error', error: 'unimplemented opcode &4C at &0410' }, 0x0410)).toBe(
      'Stopped: unimplemented opcode &4C at &0410, after 1,234 instructions, 340,000 cycles = 170 ms at 2 MHz',
    );
  });

  it('says "1 instruction", not "1 instructions"', () => {
    expect(describeRunState({ steps: 1, cycles: 2, end: 'brk', error: undefined }, 0x0401)).toBe(
      'Stopped at BRK (&0401) after 1 instruction, 2 cycles = 1 µs at 2 MHz',
    );
  });
});
