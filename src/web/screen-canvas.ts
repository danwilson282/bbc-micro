// Puts the renderer's pixels on the #screen canvas (Stage 31).
//
// The renderer (src/video/mode7-renderer.ts) gives one BBC colour number
// (0-7: bit 0 red, bit 1 green, bit 2 blue) per pixel. A canvas wants 4 bytes
// per pixel (R, G, B, A). We keep one ImageData for the whole screen and
// view its bytes as 32-bit words, so each pixel is a single write from an
// 8-word palette. Then putImageData copies it to the canvas.
//
// The canvas is 480 × 500, MODE 7's size in half dots × interlaced lines. CSS
// stretches it to the screen frame (image-rendering: pixelated keeps dots sharp).

import { MODE7_PIXEL_HEIGHT, MODE7_PIXEL_WIDTH, renderMode7 } from '../video/mode7-renderer';

/** The 8 colours as 0xAABBGGRR words: ImageData's bytes are R, G, B, A, which a little-endian Uint32Array reads backwards. */
function paletteWords(): Uint32Array {
  const words = new Uint32Array(8);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  for (let colour = 0; colour < 8; colour++) {
    const r = colour & 1 ? 0xff : 0;
    const g = colour & 2 ? 0xff : 0;
    const b = colour & 4 ? 0xff : 0;
    words[colour] = littleEndian ? ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  }
  return words;
}

export interface ScreenCanvas {
  /** Renders MODE 7 from start (a RAM address in &7C00-&7FFF) and shows it. */
  draw(peek: (address: number) => number, start: number): void;
  /** Milliseconds the last draw took (render + blit), for the curious. */
  readonly lastDrawMs: number;
}

export function createScreenCanvas(canvas: HTMLCanvasElement): ScreenCanvas {
  canvas.width = MODE7_PIXEL_WIDTH;
  canvas.height = MODE7_PIXEL_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The screen canvas has no 2D context');
  const image = context.createImageData(MODE7_PIXEL_WIDTH, MODE7_PIXEL_HEIGHT);
  const words = new Uint32Array(image.data.buffer);
  const colours = new Uint8Array(MODE7_PIXEL_WIDTH * MODE7_PIXEL_HEIGHT);
  const palette = paletteWords();
  let lastDrawMs = 0;

  return {
    draw(peek, start) {
      const begin = performance.now();
      renderMode7(peek, start, colours);
      for (let i = 0; i < colours.length; i++) words[i] = palette[colours[i] ?? 0] ?? 0;
      context.putImageData(image, 0, 0);
      lastDrawMs = performance.now() - begin;
    },
    get lastDrawMs() {
      return lastDrawMs;
    },
  };
}
