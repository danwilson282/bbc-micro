// Puts the renderer's pixels on the #screen canvas (Stage 31).
//
// The renderer (src/video/mode7-renderer.ts) gives one BBC colour number
// (0-7: bit 0 red, bit 1 green, bit 2 blue) per pixel. A canvas wants 4 bytes
// per pixel (R, G, B, A). We keep one ImageData for the whole screen and
// view its bytes as 32-bit words, so each pixel is a single write from an
// 8-word palette. Then putImageData copies it to the canvas.
//
// The canvas is 480 × 500 in MODE 7, its size in half dots × interlaced
// lines. In the bitmap MODEs (Stage 42) it is 640 × 256: 16 MHz dots ×
// scanlines, the machine's own frame buffer (bitmap-renderer.ts). Both are
// the same 40 µs × ~256 lines of TV picture, so CSS stretches either to the
// same 5:4 frame (image-rendering: pixelated keeps dots sharp). The canvas
// is only resized when the kind of picture changes.

import { BITMAP_HEIGHT, BITMAP_WIDTH } from '../video/bitmap-renderer';
import { MODE7_PIXEL_HEIGHT, MODE7_PIXEL_WIDTH, type Mode7Screen, renderMode7 } from '../video/mode7-renderer';

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
  /** Renders MODE 7 as the CRTC addresses it (mode7ScreenFrom) and shows it. flashVisible is the SAA5050's flash phase. */
  draw(peek: (address: number) => number, screen: Mode7Screen, flashVisible: boolean): void;
  /** Shows a bitmap MODE's frame buffer: 640 × 256 physical colours, as the machine's BitmapRenderer drew them. */
  drawBitmap(pixels: Uint8Array): void;
  /** Milliseconds the last draw took (render + blit), for the curious. */
  readonly lastDrawMs: number;
}

/** One kind of picture: its ImageData, viewed as words. */
interface Surface {
  readonly image: ImageData;
  readonly words: Uint32Array;
}

export function createScreenCanvas(canvas: HTMLCanvasElement): ScreenCanvas {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The screen canvas has no 2D context');
  const surface = (width: number, height: number): Surface => {
    const image = context.createImageData(width, height);
    return { image, words: new Uint32Array(image.data.buffer) };
  };
  const teletext = surface(MODE7_PIXEL_WIDTH, MODE7_PIXEL_HEIGHT);
  const bitmap = surface(BITMAP_WIDTH, BITMAP_HEIGHT);
  const colours = new Uint8Array(MODE7_PIXEL_WIDTH * MODE7_PIXEL_HEIGHT);
  const palette = paletteWords();
  let lastDrawMs = 0;

  /** Colour numbers → words → canvas, resizing the canvas first if the picture's kind changed. */
  const show = (target: Surface, from: Uint8Array): void => {
    const { image, words } = target;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    for (let i = 0; i < words.length; i++) words[i] = palette[from[i] ?? 0] ?? 0;
    context.putImageData(image, 0, 0);
  };

  canvas.width = MODE7_PIXEL_WIDTH;
  canvas.height = MODE7_PIXEL_HEIGHT;

  return {
    draw(peek, screen, flashVisible) {
      const begin = performance.now();
      renderMode7(peek, screen, colours, flashVisible);
      show(teletext, colours);
      lastDrawMs = performance.now() - begin;
    },
    drawBitmap(pixels) {
      const begin = performance.now();
      show(bitmap, pixels);
      lastDrawMs = performance.now() - begin;
    },
    get lastDrawMs() {
      return lastDrawMs;
    },
  };
}
