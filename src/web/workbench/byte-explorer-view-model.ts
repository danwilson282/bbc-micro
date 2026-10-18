// The Byte explorer's view-model (Stage 41): one screen byte, decoded the way
// MODE 0, 1 and 2 would draw it, plus the way the machine's ULA would draw it
// right now.
//
//   &A5 = %1010 0101 = 165
//   MODE 1  bits [p0 p1 p2 p3 p0 p1 p2 p3]   pixels [2 yellow][1 red][2 yellow][1 red]
//
// Each MODE row says which pixel owns each bit (that's the interleave) and
// draws the pixels with the MOS's default palette for that MODE, by running
// the hardware's shift register. No DOM here: byte-explorer-panel.ts builds
// elements, Jest tests this.

import { PHYSICAL_COLOUR_NAMES, ULA_PALETTE_FLASH, decodeUlaControl, paletteColour } from '../../devices/video-ula';
import { MOS_DEFAULT_PALETTE, mosModesFor } from '../../mos/mos-video-ula';
import { hex8 } from '../../util/bits';
import { encodePixels, logicalColour, logicalFromIndex, pixelBitPositions, pixelsPerByteFor, shiftPixels, type BitsPerPixel } from '../../video/pixel-decode';

/** The three MODEs the explorer shows: one per depth. */
export const EXPLORER_MODES = [0, 1, 2] as const;
export type ExplorerMode = (typeof EXPLORER_MODES)[number];

const DEPTH_OF: Readonly<Record<ExplorerMode, BitsPerPixel>> = { 0: 1, 1: 2, 2: 4 };

/** The eight physical colours: each RGB wire fully on or off (as the Video ULA panel). */
const CSS_COLOURS = ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'] as const;

export interface ExplorerInput {
  readonly byte: number;
  /** The machine's ULA now: its control byte and 16 stored palette nibbles. */
  readonly ula?: { readonly control: number; readonly entries: readonly number[] };
}

export interface ExplorerPixel {
  /** "2" (the logical colour) in a MODE row, "&C" (the palette index) in the live row. */
  readonly label: string;
  /** The physical colour, 0-7, in the first flash phase. */
  readonly colour: number;
  readonly css: string;
  readonly flashing: boolean;
  /** Relative width: every row is one byte, so a MODE 2 pixel is 4 MODE 0 pixels wide. */
  readonly width: number;
  readonly title: string;
}

export interface ExplorerModeRow {
  readonly mode: ExplorerMode;
  readonly bitsPerPixel: BitsPerPixel;
  readonly heading: string;
  /** For byte bits 7 down to 0: the pixel that owns it. */
  readonly bitOwners: readonly number[];
  readonly pixels: readonly ExplorerPixel[];
}

export interface ExplorerLiveRow {
  readonly heading: string;
  readonly pixels: readonly ExplorerPixel[];
}

export interface ByteExplorerView {
  /** "&A5 = %1010 0101 = 165". */
  readonly summary: string;
  /** Byte bits 7 down to 0, each 0 or 1. */
  readonly bits: readonly number[];
  readonly modes: readonly ExplorerModeRow[];
  readonly live: ExplorerLiveRow | undefined;
}

function colourName(colour: number): string {
  return PHYSICAL_COLOUR_NAMES[colour & 7] ?? '?';
}

function binary(value: number, width: number): string {
  return value.toString(2).padStart(width, '0');
}

/** "b7 b3". */
function bitNames(positions: readonly number[]): string {
  return positions.map((b) => `b${String(b)}`).join(' ');
}

/** Reads "&A5", "A5", "$A5", "0xA5" (hex) or "%10100101" (binary). Undefined unless it's a whole byte, 0-255. */
export function parseByte(text: string): number | undefined {
  const t = text.trim();
  const bin = /^%([01]{1,8})$/.exec(t);
  if (bin?.[1] !== undefined) return parseInt(bin[1], 2);
  const hex = /^(?:&|\$|0x)?([0-9a-f]{1,2})$/i.exec(t);
  if (hex?.[1] !== undefined) return parseInt(hex[1], 16);
  return undefined;
}

/** The byte with bit n (0-7) inverted. */
export function toggleBit(byte: number, n: number): number {
  return (byte ^ (1 << (n & 7))) & 0xff;
}

/** The byte with pixel p's logical colour moved on by one (wrapping), the other pixels unchanged. */
export function cyclePixel(byte: number, bitsPerPixel: BitsPerPixel, pixel: number): number {
  const colours = Array.from({ length: pixelsPerByteFor(bitsPerPixel) }, (_, p) => logicalColour(byte, p, bitsPerPixel));
  colours[pixel] = ((colours[pixel] ?? 0) + 1) % 2 ** bitsPerPixel;
  return encodePixels(colours, bitsPerPixel);
}

function pixelFromEntry(stored: number, width: number, label: string, title: string): ExplorerPixel {
  const colour = paletteColour(stored, false);
  const flashing = (stored & ULA_PALETTE_FLASH) !== 0;
  return { label, colour, css: CSS_COLOURS[colour] ?? CSS_COLOURS[0], flashing, width, title };
}

function modeRow(byte: number, mode: ExplorerMode): ExplorerModeRow {
  const bpp = DEPTH_OF[mode];
  const count = pixelsPerByteFor(bpp);
  const owners = new Array<number>(8).fill(0);
  const indices = new Uint8Array(count);
  shiftPixels(byte, count, indices);
  const palette = MOS_DEFAULT_PALETTE[mode];
  const pixels = Array.from({ length: count }, (_, p) => {
    const positions = pixelBitPositions(p, bpp);
    for (const b of positions) owners[7 - b] = p;
    const logical = logicalColour(byte, p, bpp);
    const index = indices[p] ?? 0;
    const stored = palette[index] ?? 0;
    const first = paletteColour(stored, false);
    const flashing = (stored & ULA_PALETTE_FLASH) !== 0;
    const name = flashing ? `${colourName(first)}/${colourName(first ^ 7)}` : colourName(first);
    const title =
      `Pixel ${String(p)}: ${bitNames(positions)} = %${binary(logical, bpp)} = logical ${String(logical)}. ` +
      `The ULA reads index &${index.toString(16).toUpperCase()} (%${binary(index, 4)}), ` +
      `which the MOS sets to ${name}. Click to change`;
    return pixelFromEntry(stored, bpp, String(logical), title);
  });
  const colours = 2 ** bpp;
  return {
    mode,
    bitsPerPixel: bpp,
    heading: `MODE ${String(mode)}: ${String(count)} pixels, ${String(bpp)} bit${bpp === 1 ? '' : 's'} each (${String(colours)} colours)`,
    bitOwners: owners,
    pixels,
  };
}

function liveRow(byte: number, control: number, entries: readonly number[]): ExplorerLiveRow {
  const c = decodeUlaControl(control);
  const modes = mosModesFor(control);
  const which = modes.length === 0 ? 'not a MOS MODE' : `MODE ${modes.join(' or ')}`;
  const head = `The ULA now (&${hex8(control)}, ${which}): ${String(c.pixelsPerByte)} pixel${c.pixelsPerByte === 1 ? '' : 's'} a byte`;
  const count = c.pixelsPerByte;
  const indices = new Uint8Array(count);
  shiftPixels(byte, count, indices);
  const width = 8 / count;
  const pixels = Array.from(indices, (index, p) => {
    const stored = (entries[index] ?? 0) & 0x0f;
    const colour = paletteColour(stored, false);
    const logical = c.bitsPerPixel === undefined ? '' : `, logical ${String(logicalFromIndex(index, c.bitsPerPixel))}`;
    const title = `Pixel ${String(p)}: index &${index.toString(16).toUpperCase()} (%${binary(index, 4)})${logical}. Entry stores &${stored.toString(16).toUpperCase()}: ${colourName(colour)}`;
    return pixelFromEntry(stored, width, `&${index.toString(16).toUpperCase()}`, title);
  });
  const tail = c.teletext ? '. Teletext is on, so the screen shows the SAA5050, not these' : '';
  return { heading: `${head}${tail}`, pixels };
}

export function buildByteExplorerView(input: ExplorerInput): ByteExplorerView {
  const byte = input.byte & 0xff;
  return {
    summary: `&${hex8(byte)} = %${binary(byte >> 4, 4)} ${binary(byte & 0x0f, 4)} = ${String(byte)}`,
    bits: Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1),
    modes: EXPLORER_MODES.map((m) => modeRow(byte, m)),
    live: input.ula === undefined ? undefined : liveRow(byte, input.ula.control & 0xff, input.ula.entries),
  };
}
