// The status line for sound (Stage 46), from the worklet's latest report.
// Pure, so it's tested in Jest; sound-control.ts puts it on the page.

import type { WorkletStats } from './messages';

/** Below this the output is silence (or the hold fading out). */
const AUDIBLE_PEAK = 0.001;

export function audioStatusText(stats: WorkletStats | undefined): string {
  if (stats === undefined) return 'starting…';
  const parts = [
    `${String(stats.sampleRate / 1000)} kHz`,
    `${String(Math.round((stats.buffered * 1000) / stats.sampleRate))} ms buffered`,
    `${stats.underruns.toLocaleString('en-GB')} underrun${stats.underruns === 1 ? '' : 's'}`,
  ];
  if (stats.dropped > 0) parts.push(`${stats.dropped.toLocaleString('en-GB')} dropped`);
  if (!stats.playing) parts.push('buffering');
  else if (stats.peak < AUDIBLE_PEAK) parts.push('silent');
  else parts.push(`≈${String(Math.round(stats.pitch))} Hz, peak ${stats.peak.toFixed(2)}`);
  return parts.join(' · ');
}
