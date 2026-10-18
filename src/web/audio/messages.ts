// What the main thread and the audio worklet say to each other (Stage 46).
// They share no variables: only messages through a MessagePort. Whatever
// arrives is `unknown` (an I/O boundary), so each side checks the shape
// with these guards before trusting it.

/** The name the worklet registers its processor under, and the node asks for. */
export const PROCESSOR_NAME = 'bbc-sound';

/** Main thread → worklet. */
export type ToWorklet =
  /** One BBC frame's samples, at the context's rate. The buffer is transferred. */
  | { readonly type: 'samples'; readonly samples: Float32Array }
  /** Forget everything buffered: sound has just been switched on. */
  | { readonly type: 'reset' };

/** Worklet → main thread, a few times a second. */
export interface WorkletStats {
  readonly type: 'stats';
  readonly sampleRate: number;
  /** Samples waiting in the ring. */
  readonly buffered: number;
  /** Times it has run dry since sound was switched on. */
  readonly underruns: number;
  /** Samples thrown away (too far ahead) since sound was switched on. */
  readonly dropped: number;
  /** Loudest sample played in the last window, 0 to 1. */
  readonly peak: number;
  /** Rising zero crossings a second in the last window: a single tone's pitch in Hz. */
  readonly pitch: number;
  readonly playing: boolean;
}

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

export function isToWorklet(data: unknown): data is ToWorklet {
  if (!isObject(data)) return false;
  if (data.type === 'reset') return true;
  return data.type === 'samples' && data.samples instanceof Float32Array;
}

export function isWorkletStats(data: unknown): data is WorkletStats {
  if (!isObject(data) || data.type !== 'stats') return false;
  const numbers = [data.sampleRate, data.buffered, data.underruns, data.dropped, data.peak, data.pitch];
  return numbers.every((n) => typeof n === 'number') && typeof data.playing === 'boolean';
}
