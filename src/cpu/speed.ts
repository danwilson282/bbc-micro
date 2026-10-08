// How fast the emulated CPU runs, compared with the real Model B.
//
// Pure arithmetic: the caller does the timing (performance.now() in the
// demo), so the core stays deterministic.

/** The Model B's 6502 clock: 2 MHz (BUILD-PLAN §3). */
export const MODEL_B_CPU_HZ = 2_000_000;
/** One PAL frame at 50 Hz: 20 ms. */
export const FRAME_MS = 20;
/** CPU cycles in one frame on the real machine: 2,000,000 × 0.020 = 40,000. */
export const CYCLES_PER_FRAME = (MODEL_B_CPU_HZ * FRAME_MS) / 1000;

/** Emulated cycles per real second, in millions. */
export function effectiveMhz(cycles: number, ms: number): number {
  if (ms <= 0) throw new RangeError(`elapsed time must be positive, not ${String(ms)} ms`);
  return cycles / (ms / 1000) / 1_000_000;
}

/** How many times faster than the real 2 MHz Model B. */
export function realSpeedMultiple(cycles: number, ms: number): number {
  return (effectiveMhz(cycles, ms) * 1_000_000) / MODEL_B_CPU_HZ;
}

/** Of each 20 ms frame, the share the CPU alone would use at this speed: 0.5 = half. */
export function frameShare(cycles: number, ms: number): number {
  return 1 / realSpeedMultiple(cycles, ms);
}

/** "91.6 MHz (45.8× real speed)" */
export function formatSpeed(cycles: number, ms: number): string {
  return `${effectiveMhz(cycles, ms).toFixed(1)} MHz (${realSpeedMultiple(cycles, ms).toFixed(1)}× real speed)`;
}
