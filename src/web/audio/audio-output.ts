// The main thread's half of sound (Stage 46): an AudioContext with our
// worklet in it, and the plumbing from the emulated chip to it.
//
//   Sn76489 ──250 kHz──▶ BoxResampler ──48 kHz──▶ FrameBatcher ──flush()──▶ worklet
//
// Browsers won't start audio without a user gesture (autoplay rules), so
// nothing is made until switchOn() is called from a click. The context is
// created and resumed *synchronously* inside that click, before any await,
// so the browser counts it as the user's doing.
//
// While off, the chip has no output connected: it still runs (the Sound
// panel still updates), but nothing is resampled or sent.

import type { ChipOutput } from '../../devices/sn76489';
import { BoxResampler } from '../../sound/resampler';
import workletUrl from './bbc-sound.worklet.ts?worker&url';
import { FrameBatcher } from './frame-batcher';
import { PROCESSOR_NAME, isWorkletStats, type ToWorklet, type WorkletStats } from './messages';

/** The batch holds 250 ms: plenty for one frame (20 ms), with room for steps between frames. */
const BATCH_SECONDS = 0.25;

/** Anything the chip's output can be connected to: the Sn76489, in practice. */
export interface SoundSource {
  connectOutput(output: ChipOutput | undefined): void;
}

export interface AudioOutput {
  readonly on: boolean;
  /** The worklet's latest report, while on. */
  readonly stats: WorkletStats | undefined;
  /** Starts sound. Call it from a click (autoplay rules); the first call builds the audio graph. */
  switchOn(): Promise<void>;
  switchOff(): Promise<void>;
  /** After each BBC frame: send the frame's samples to the audio thread. */
  flush(): void;
}

export function createAudioOutput(source: SoundSource, onStats: (stats: WorkletStats) => void): AudioOutput {
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let batcher: FrameBatcher | undefined;
  let on = false;
  /** Counts switches, so a slow switchOn can tell it was switched off (or on again) while it awaited. */
  let generation = 0;
  let stats: WorkletStats | undefined;

  function send(message: ToWorklet, transfer: Transferable[] = []): void {
    node?.port.postMessage(message, transfer);
  }

  async function build(ctx: AudioContext): Promise<AudioWorkletNode> {
    await ctx.audioWorklet.addModule(workletUrl);
    // No inputs; one mono output. The destination copies mono to both speakers.
    const n = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    n.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!isWorkletStats(event.data) || !on) return;
      stats = event.data;
      onStats(stats);
    };
    n.connect(ctx.destination);
    return n;
  }

  return {
    get on() {
      return on;
    },
    get stats() {
      return stats;
    },
    async switchOn() {
      if (on) return;
      on = true;
      const mine = ++generation;
      stats = undefined;
      // Both before the first await: still inside the click, as far as the browser is concerned.
      // The browser picks the rate (usually the hardware's), so it doesn't resample again.
      const ctx = context ?? new AudioContext({ latencyHint: 'interactive' });
      context = ctx;
      const resumed = ctx.resume();
      try {
        node ??= await build(ctx);
        await resumed;
      } catch (error) {
        if (mine === generation) on = false;
        throw error;
      }
      if (mine !== generation) return; // switched off while starting
      const rate = Math.round(ctx.sampleRate);
      batcher = new FrameBatcher(Math.round(rate * BATCH_SECONDS));
      send({ type: 'reset' });
      source.connectOutput(new BoxResampler(batcher, rate));
    },
    async switchOff() {
      if (!on) return;
      on = false;
      generation++;
      stats = undefined;
      source.connectOutput(undefined);
      batcher = undefined;
      await context?.suspend();
    },
    flush() {
      const samples = batcher?.take();
      // Transferred, not copied: the buffer moves to the audio thread.
      if (samples !== undefined) send({ type: 'samples', samples }, [samples.buffer]);
    },
  };
}
