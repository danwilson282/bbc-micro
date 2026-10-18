// The audio worklet (Stage 46): runs on the browser's audio thread, not the
// page's. The browser calls process() for every render quantum (128
// samples, every 2.67 ms at 48 kHz) and it must return in time, so all it
// does is copy from the PlaybackBuffer, which allocates nothing.
//
// Batches of samples arrive from the main thread by message, one per BBC
// frame (about every 20 ms, or 7.5 quanta). Four times a second it sends back what it's
// doing, for the status line under the screen.
//
// Loaded by audio-output.ts through Vite's `?worker&url`, which compiles
// this file (and its imports) into a module for audioWorklet.addModule().

import { PROCESSOR_NAME, isToWorklet, type WorkletStats } from './messages';
import { PlaybackBuffer, levelsFor } from './playback-buffer';

// The worklet's own global scope (AudioWorkletGlobalScope) has these, but
// TypeScript's DOM library describes the page's scope instead. Declared here,
// in this module only, so they don't leak into the page's types.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** Stats four times a second: often enough to watch, rare enough to cost nothing. */
const REPORTS_PER_SECOND = 4;

class BbcSoundProcessor extends AudioWorkletProcessor {
  private readonly buffer = new PlaybackBuffer(levelsFor(sampleRate));
  private readonly reportEvery = Math.round(sampleRate / REPORTS_PER_SECOND);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isToWorklet(message)) return;
      if (message.type === 'samples') this.buffer.receive(message.samples);
      else {
        this.buffer.reset();
        this.buffer.underruns = 0;
        this.buffer.dropped = 0;
      }
    };
  }

  /**
   * One render quantum. Mono: one output with one channel. Returns true: keep
   * me alive. The arrays are typed as possibly missing, because nothing
   * checks the node was made with an output.
   */
  process(_inputs: unknown, outputs: readonly (readonly (Float32Array | undefined)[] | undefined)[]): boolean {
    const channel = outputs[0]?.[0];
    if (channel === undefined) return true;
    this.buffer.render(channel);
    if (this.buffer.rendered >= this.reportEvery) this.report();
    return true;
  }

  private report(): void {
    const b = this.buffer;
    const stats: WorkletStats = {
      type: 'stats',
      sampleRate,
      buffered: b.buffered,
      underruns: b.underruns,
      dropped: b.dropped,
      peak: b.peak,
      pitch: b.pitch(sampleRate),
      playing: b.playing,
    };
    this.port.postMessage(stats);
    b.startWindow();
  }
}

registerProcessor(PROCESSOR_NAME, BbcSoundProcessor);
