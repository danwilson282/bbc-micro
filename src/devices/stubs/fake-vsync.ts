// STUB, replaced by the CRTC's real VSYNC output in Stage 38.
//
// On the Model B, the 6845's vertical sync is wired to the System VIA's CA1
// (Advanced User Guide, System VIA), so the MOS gets an interrupt every
// frame. All the MOS needs from it is a falling edge every 20 ms, so this
// is a cycle counter that drives CA1:
//
//   position:  0 ........ 255 | 256 ................ 39,999 | 0
//   CA1:       ‾\_____________/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾\___
//               ↑ falling edge: with PCR = &04, IFR bit 1
//
// Which edge of the real VSYNC reaches CA1 as a falling one (is it
// inverted?) is unconfirmed; it doesn't matter for a 50 Hz tick.
//
// tick() is on the hot path: no allocation, and a loop so that one long
// tick can't skip an edge.

import type { Clocked } from '../clocked';
import type { Via6522 } from '../via6522';

/** One 50 Hz PAL frame: 312.5 lines × 64 µs = 20 ms = 40,000 cycles at 2 MHz (BUILD-PLAN §3). */
export const VSYNC_PERIOD_CYCLES = 40_000;
/** VSYNC is 2 lines wide in MODE 7 (CRTC R3 = &24, top nibble): 2 × 64 µs = 256 cycles. */
export const VSYNC_WIDTH_CYCLES = 256;

export class FakeVsync implements Clocked {
  /** Where we are in the frame, 0 to period - 1. CA1 is low while it's below the width. */
  private position = VSYNC_WIDTH_CYCLES;
  private count = 0;
  private on = true;

  constructor(private readonly via: Via6522) {}

  /** Off: CA1 stays high and nothing happens. For showing what vsync is for. */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    if (!on) this.via.setControlLine('ca1', 1);
  }

  /** Falling edges since reset(). */
  get pulses(): number {
    return this.count;
  }

  tick(cpuCycles: number): void {
    if (!this.on) return;
    let left = cpuCycles;
    while (left > 0) {
      const inPulse = this.position < VSYNC_WIDTH_CYCLES;
      const toEdge = (inPulse ? VSYNC_WIDTH_CYCLES : VSYNC_PERIOD_CYCLES) - this.position;
      if (left < toEdge) {
        this.position += left;
        return;
      }
      left -= toEdge;
      if (inPulse) {
        // The end of the pulse.
        this.position = VSYNC_WIDTH_CYCLES;
        this.via.setControlLine('ca1', 1);
      } else {
        // The start of the next frame's pulse.
        this.position = 0;
        this.count++;
        this.via.setControlLine('ca1', 0);
      }
    }
  }

  /** Just after a pulse: CA1 high, the next edge 39,744 cycles away. The count starts again. */
  reset(): void {
    this.position = VSYNC_WIDTH_CYCLES;
    this.count = 0;
    this.via.setControlLine('ca1', 1);
  }
}
