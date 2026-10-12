import {
  FRAME_MS,
  MAX_ELAPSED_MS,
  MAX_FRAMES_PER_TICK,
  SpeedMeter,
  createFrameClock,
  createFrameLoop,
  framesDue,
  resetClock,
  type AnimationHost,
} from './frame-loop';

/** Feeds framesDue callbacks every `interval` ms from t = 0, and returns the frames each one owed. */
function ticks(interval: number, count: number, start = 0): number[] {
  const clock = createFrameClock();
  const due: number[] = [];
  for (let i = 0; i < count; i++) due.push(framesDue(clock, start + i * interval));
  return due;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('framesDue: wall-clock time to whole 50 Hz BBC frames', () => {
  it('a BBC frame is 20 ms: 40,000 cycles at 2 MHz', () => {
    expect(FRAME_MS).toBe(20);
  });

  it('the first callback only notes the time: nothing is owed yet', () => {
    expect(framesDue(createFrameClock(), 12_345.6)).toBe(0);
  });

  it('on a 50 Hz display, one frame per callback', () => {
    expect(ticks(20, 51).slice(1)).toEqual(Array<number>(50).fill(1));
  });

  it('on a 60 Hz display, five frames in every six callbacks: 50 a second, not 60', () => {
    const due = ticks(1000 / 60, 61);
    expect(due.slice(1, 7)).toEqual([0, 1, 1, 1, 1, 1]);
    expect(sum(due)).toBe(50);
  });

  it('on a 144 Hz display, 50 frames a second, mostly with nothing due', () => {
    const due = ticks(1000 / 144, 145);
    expect(sum(due)).toBe(50);
    expect(Math.max(...due)).toBe(1);
  });

  it('on a 30 Hz display (or a slow page), 1, 2, 2 … still 50 a second', () => {
    const due = ticks(1000 / 30, 31);
    expect(due.slice(1, 7)).toEqual([1, 2, 2, 1, 2, 2]);
    expect(sum(due)).toBe(50);
  });

  it('carries the remainder: 15 ms then 15 ms is one frame with 10 ms left over', () => {
    const clock = createFrameClock();
    framesDue(clock, 0);
    expect(framesDue(clock, 15)).toBe(0);
    expect(framesDue(clock, 30)).toBe(1);
    expect(clock.owed).toBeCloseTo(10);
  });

  it('a hidden tab (10 s with no callbacks) owes at most 100 ms, not 500 frames', () => {
    const clock = createFrameClock();
    framesDue(clock, 0);
    expect(MAX_ELAPSED_MS).toBe(100);
    expect(framesDue(clock, 10_000)).toBe(5);
    expect(framesDue(clock, 10_020)).toBe(1);
  });

  it('never asks for more than 5 frames in one callback, so a slow computer gets slow motion, not a frozen page', () => {
    const clock = createFrameClock();
    clock.last = 0;
    clock.owed = 1000; // as if something had gone wrong: 50 frames owed
    expect(framesDue(clock, 0)).toBe(MAX_FRAMES_PER_TICK);
    // The rest of the debt is written off, not carried: otherwise it would never be repaid.
    expect(clock.owed).toBeLessThan(FRAME_MS);
  });

  it('time going backwards (a clock glitch) counts as no time', () => {
    const clock = createFrameClock();
    framesDue(clock, 100);
    expect(framesDue(clock, 50)).toBe(0);
    expect(clock.owed).toBe(0);
  });

  it('resetClock forgets the last time, so a pause owes nothing for the time it lasted', () => {
    const clock = createFrameClock();
    framesDue(clock, 0);
    framesDue(clock, 15);
    resetClock(clock);
    expect(framesDue(clock, 60_000)).toBe(0);
    expect(framesDue(clock, 60_020)).toBe(1);
  });
});

/** A fake requestAnimationFrame: the test decides when the browser "redraws" and what time it is. */
function fakeHost(): AnimationHost & { pending: number; fire(now: number): void } {
  let next: ((now: number) => void) | undefined;
  let id = 0;
  return {
    requestFrame(callback) {
      next = callback;
      return ++id;
    },
    cancelFrame(cancelled) {
      if (cancelled === id) next = undefined;
    },
    get pending() {
      return next === undefined ? 0 : 1;
    },
    fire(now) {
      const callback = next;
      next = undefined;
      callback?.(now);
    },
  };
}

function loopWith(host: AnimationHost): { loop: ReturnType<typeof createFrameLoop>; ran: { frames: number; draws: number[]; errors: unknown[] } } {
  const draws: number[] = [];
  const errors: unknown[] = [];
  const ran = { frames: 0, draws, errors };
  const loop = createFrameLoop(host, {
    runFrame: () => {
      ran.frames++;
    },
    draw: (frames) => {
      ran.draws.push(frames);
    },
    onError: (error) => {
      ran.errors.push(error);
    },
  });
  return { loop, ran };
}

describe('createFrameLoop: the machine driven by requestAnimationFrame', () => {
  it('start asks for a callback; each callback runs the frames due, draws, and asks again', () => {
    const host = fakeHost();
    const { loop, ran } = loopWith(host);
    loop.start();
    expect(loop.running).toBe(true);
    for (let i = 0; i <= 6; i++) host.fire(i * (1000 / 60));
    expect(ran.frames).toBe(5);
    expect(host.pending).toBe(1);
  });

  it('only draws when a frame ran: a 60 Hz callback with nothing due changes nothing', () => {
    const host = fakeHost();
    const { loop, ran } = loopWith(host);
    loop.start();
    host.fire(0);
    host.fire(16.7);
    expect(ran.draws).toEqual([]);
    host.fire(33.4);
    expect(ran.draws).toEqual([1]);
  });

  it('pause cancels the next callback; resuming owes nothing for the pause', () => {
    const host = fakeHost();
    const { loop, ran } = loopWith(host);
    loop.start();
    host.fire(0);
    host.fire(20);
    loop.pause();
    expect(loop.running).toBe(false);
    expect(host.pending).toBe(0);
    loop.start();
    host.fire(5_000);
    host.fire(5_020);
    expect(ran.frames).toBe(2);
  });

  it('start while running does nothing (no second chain of callbacks)', () => {
    const host = fakeHost();
    let requests = 0;
    const counting: AnimationHost = {
      requestFrame: (cb) => {
        requests++;
        return host.requestFrame(cb);
      },
      cancelFrame: (id) => {
        host.cancelFrame(id);
      },
    };
    const { loop } = loopWith(counting);
    loop.start();
    loop.start();
    expect(requests).toBe(1);
  });

  it('stepFrame runs exactly one frame and draws it, pausing first if running', () => {
    const host = fakeHost();
    const { loop, ran } = loopWith(host);
    loop.start();
    loop.stepFrame();
    expect(loop.running).toBe(false);
    expect(ran.frames).toBe(1);
    expect(ran.draws).toEqual([1]);
    expect(host.pending).toBe(0);
  });

  it('an error from the machine pauses the loop and is reported, not thrown into the browser', () => {
    const host = fakeHost();
    const failure = new Error('unimplemented opcode &02');
    const errors: unknown[] = [];
    const loop = createFrameLoop(host, {
      runFrame: () => {
        throw failure;
      },
      draw: () => undefined,
      onError: (error) => errors.push(error),
    });
    loop.start();
    host.fire(0);
    host.fire(20);
    expect(errors).toEqual([failure]);
    expect(loop.running).toBe(false);
    expect(host.pending).toBe(0);
  });
});

describe('SpeedMeter: how fast it is really going', () => {
  it('at 60 Hz with 50 frames a second, reports 50 frames/s, 100% and a 60 Hz display', () => {
    const meter = new SpeedMeter();
    const clock = createFrameClock();
    for (let i = 0; i <= 120; i++) {
      const now = i * (1000 / 60);
      meter.record(now, framesDue(clock, now));
    }
    expect(meter.framesPerSecond).toBe(50);
    expect(meter.percent).toBe(100);
    expect(meter.callbacksPerSecond).toBe(60);
  });

  it('a page managing only 35 frames a second is at 70%', () => {
    const meter = new SpeedMeter();
    for (let i = 0; i <= 70; i++) meter.record(i * (1000 / 35), 1);
    expect(meter.percent).toBe(70);
  });

  it('says nothing until a whole second has been measured', () => {
    const meter = new SpeedMeter();
    meter.record(0, 1);
    meter.record(500, 1);
    expect(meter.framesPerSecond).toBeUndefined();
  });

  it('reset starts measuring again (after a pause, the paused time is not "0 frames/s")', () => {
    const meter = new SpeedMeter();
    for (let i = 0; i <= 60; i++) meter.record(i * 20, 1);
    meter.reset();
    expect(meter.framesPerSecond).toBeUndefined();
  });
});
