// A .wav file from samples (Stage 45): the RIFF container with one "fmt "
// chunk (16-bit mono PCM) and one "data" chunk. All numbers little-endian.
//
//   0  "RIFF"  size-8   "WAVE"
//  12  "fmt "  16       format 1 (PCM), 1 channel, rate, bytes/s, block align, 16 bits
//  36  "data"  bytes    then the samples, signed 16-bit
//
// Pure: it returns the bytes, and the caller writes the file.

const WAV_HEADER_BYTES = 44;
/** The "fmt " chunk's body for PCM is 16 bytes. */
const FMT_CHUNK_BYTES = 16;
/** wFormatTag 1: uncompressed PCM. */
const WAVE_FORMAT_PCM = 1;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
/** ±1 maps to ±32,767 (not -32,768, so the wave stays symmetrical). */
const FULL_SCALE = 0x7fff;

/** The samples (-1 to +1, clipped beyond) as a 16-bit mono PCM .wav file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, FMT_CHUNK_BYTES, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE, Math.round(s * FULL_SCALE), true);
  }
  return bytes;
}
