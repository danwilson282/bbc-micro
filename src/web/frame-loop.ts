// The frame loop: runs the machine in real time, driven by the browser's
// requestAnimationFrame.
//
// The display calls us back at its own rate (60 Hz, 120 Hz, 144 Hz …), but a
// BBC frame is 20 ms (50 Hz). So each callback adds the time since the last
// one to a running debt, runs as many whole 20 ms frames as the debt covers,
// and keeps the remainder for next time:
//
//   60 Hz: owed 16.7 → 0 frames, 33.3 → 1 (13.3 left), 30.0 → 1 (10.0 left) …
//          five frames in every six callbacks: exactly 50 a second.
//
// Two guards against the "spiral of death": no callback may add more than
// 100 ms (a hidden tab's 10 s is forgotten, not fast-forwarded), and no
// callback runs more than 5 frames (a computer that can't keep up gets slow
// motion, not a frozen page).
//
// Two layers: framesDue() is pure maths on a small mutable clock; and
// createFrameLoop() drives it from an AnimationHost, which is
// window.requestAnimationFrame in the browser and a fake in Jest. It knows
// nothing about the BBC: it calls runFrame() and draw().

/** One BBC frame: 40,000 cycles at 2 MHz (Stage 27's CYCLES_PER_FRAME) is 20 ms. */
export const FRAME_MS = 20;
/** The most time one callback may add to the debt: 5 frames. More is forgotten. */
export const MAX_ELAPSED_MS = 100;
/** The most frames one callback runs. */
export const MAX_FRAMES_PER_TICK = 5;
/** 50 Hz: what 100% speed means. */
const FRAMES_PER_SECOND = 1000 / FRAME_MS;

/** The accumulator's state. Mutated in place, so a callback allocates nothing. */
export interface FrameClock {
  /** The last callback's timestamp, or undefined before the first (or after a pause). */
  last: number | undefined;
  /** Milliseconds of BBC time owed, less than one frame after each call. */
  owed: number;
}

export function createFrameClock(): FrameClock {
  return { last: undefined, owed: 0 };
}

/** Forget the time, so the next callback only notes it. Used on resume. */
export function resetClock(clock: FrameClock): void {
  clock.last = undefined;
  clock.owed = 0;
}

/**
 * How many whole frames are due at `now` (a requestAnimationFrame timestamp,
 * in ms). Adds the time since the last call, clamped, to the debt, and takes
 * off the frames it returns.
 */
export function framesDue(clock: FrameClock, now: number): number {
  const last = clock.last;
  clock.last = now;
  if (last === undefined) return 0;
  // Clamped both ways: a clock that goes backwards adds nothing, a hidden tab at most 100 ms.
  const elapsed = Math.min(Math.max(now - last, 0), MAX_ELAPSED_MS);
  clock.owed += elapsed;
  const frames = Math.floor(clock.owed / FRAME_MS);
  clock.owed -= frames * FRAME_MS;
  // Anything past the cap is written off, not carried: a debt that's never repaid only grows.
  return Math.min(frames, MAX_FRAMES_PER_TICK);
}

/**
 * Frames run and callbacks seen, over windows of at least a second. The
 * numbers are those of the last complete window: undefined until there's one.
 */
export class SpeedMeter {
  /** Emulated frames per wall-clock second: 50 is real time. */
  framesPerSecond: number | undefined;
  /** framesPerSecond as a percentage of 50. */
  percent: number | undefined;
  /** requestAnimationFrame callbacks per second: roughly the display's refresh rate. */
  callbacksPerSecond: number | undefined;

  private windowStart: number | undefined;
  private frames = 0;
  private callbacks = 0;

  /** Called once per callback, with the frames it ran. */
  record(now: number, frames: number): void {
    if (this.windowStart === undefined) {
      // The first callback marks the start of the window. It ran nothing (framesDue said 0).
      this.windowStart = now;
      return;
    }
    this.frames += frames;
    this.callbacks++;
    const span = now - this.windowStart;
    if (span < 1000) return;
    this.framesPerSecond = Math.round((this.frames * 1000) / span);
    this.percent = Math.round((this.frames * 1000 * 100) / (span * FRAMES_PER_SECOND));
    this.callbacksPerSecond = Math.round((this.callbacks * 1000) / span);
    this.windowStart = now;
    this.frames = 0;
    this.callbacks = 0;
  }

  /** Start measuring again: after a pause, the paused time isn't a slow second. */
  reset(): void {
    this.framesPerSecond = undefined;
    this.percent = undefined;
    this.callbacksPerSecond = undefined;
    this.windowStart = undefined;
    this.frames = 0;
    this.callbacks = 0;
  }
}

/** The browser's animation-frame pair, or a fake. */
export interface AnimationHost {
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
}

export interface FrameLoopCallbacks {
  /** One BBC frame: the machine's runFrame(). */
  runFrame(): void;
  /** Show the result. Called only when at least one frame ran, with how many. */
  draw(frames: number): void;
  /** runFrame threw. The loop has paused itself. */
  onError(error: unknown): void;
}

export interface FrameLoop {
  readonly running: boolean;
  readonly speed: SpeedMeter;
  /** Start running in real time. Does nothing if already running. */
  start(): void;
  /** Stop between callbacks. The machine is always between frames then. */
  pause(): void;
  /** Pause if running, then run exactly one frame and draw it. */
  stepFrame(): void;
}

export function createFrameLoop(host: AnimationHost, callbacks: FrameLoopCallbacks): FrameLoop {
  const clock = createFrameClock();
  const speed = new SpeedMeter();
  /** The pending callback's id, or undefined when paused. */
  let pending: number | undefined;

  /** Runs frames until done or one throws; false if one threw (and the loop has paused). */
  function run(frames: number): boolean {
    try {
      for (let i = 0; i < frames; i++) callbacks.runFrame();
    } catch (error) {
      pause();
      callbacks.onError(error);
      return false;
    }
    return true;
  }

  // Made once, not per callback: nothing allocated while running.
  function tick(now: number): void {
    pending = undefined;
    const frames = framesDue(clock, now);
    speed.record(now, frames);
    if (frames > 0) {
      if (!run(frames)) return;
      callbacks.draw(frames);
    }
    pending = host.requestFrame(tick);
  }

  function pause(): void {
    if (pending !== undefined) host.cancelFrame(pending);
    pending = undefined;
  }

  return {
    get running() {
      return pending !== undefined;
    },
    speed,
    start() {
      if (pending !== undefined) return;
      // A resume owes nothing for the time spent paused.
      resetClock(clock);
      speed.reset();
      pending = host.requestFrame(tick);
    },
    pause,
    stepFrame() {
      pause();
      if (run(1)) callbacks.draw(1);
    },
  };
}
