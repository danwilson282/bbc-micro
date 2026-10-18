// The Video ULA panel's view-model (Stage 40): the control byte decoded bit
// by bit, and the 16 palette entries as swatches.
//
//   &D8: MODE 1. 4 pixels a byte, 2 bits each: 4 colours, 320 pixels across
//   7-5  Cursor       %110  segments 1 and 2: 2 bytes wide
//   4    Clock        1     6845 at 2 MHz: a byte every 0.5 µs
//   ...
//   [■ &0 0000 &7 black] [■ &1 0001 &7 black] [■ &2 0010 &6 red] ...
//
// Each swatch is the colour the entry gives *now*, so flashing entries change
// colour as the MOS flips control bit 0. No DOM here: video-ula-panel.ts
// builds elements, Jest tests this.

import { PHYSICAL_COLOUR_NAMES, ULA_PALETTE_FLASH, decodeUlaControl, paletteColour, type UlaControl } from '../../devices/video-ula';
import { mosModesFor } from '../../mos/mos-video-ula';
import { hex8 } from '../../util/bits';

export interface VideoUlaViewInput {
  /** The last byte written to &FE20. */
  readonly control: number;
  /** The 16 nibbles as stored (VideoUla.paletteEntry). */
  readonly entries: readonly number[];
}

export interface UlaControlField {
  readonly bits: string;
  readonly name: string;
  /** The field's bits: "%110", or "1" for one bit. */
  readonly value: string;
  readonly meaning: string;
}

export interface PaletteSwatch {
  /** "&A". */
  readonly entry: string;
  /** "1010": the four index bits. */
  readonly binary: string;
  /** "&0": the nibble as stored. */
  readonly stored: string;
  /** The physical colour now, 0-7. */
  readonly colour: number;
  /** "white", or "red/cyan" for a flashing entry. */
  readonly name: string;
  /** The colour now, for CSS. */
  readonly css: string;
  readonly flashing: boolean;
  readonly title: string;
}

export interface VideoUlaView {
  readonly summary: string;
  readonly fields: readonly UlaControlField[];
  readonly swatches: readonly PaletteSwatch[];
  readonly note: string;
}

/** The eight physical colours: each RGB wire fully on or off. */
const CSS_COLOURS = ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'] as const;

/** The displayed part of a line: 40 µs, in every MODE. */
const DISPLAYED_LINE_SECONDS = 40e-6;

function colourName(colour: number): string {
  return PHYSICAL_COLOUR_NAMES[colour & 7] ?? '?';
}

function binary(value: number, width: number): string {
  return value.toString(2).padStart(width, '0');
}

/** "segment 2: 1 byte wide, starting 1 byte late". */
function cursorMeaning(c: UlaControl): string {
  const on = c.cursorSegments.flatMap((enabled, i) => (enabled ? [i + 1] : []));
  const first = on.at(0);
  if (first === undefined) return 'none: no cursor';
  const list = on.length === 1 ? `segment ${String(first)}` : `segments ${on.slice(0, -1).join(', ')} and ${String(on.at(-1))}`;
  const bytes = `${String(on.length)} byte${on.length === 1 ? '' : 's'} wide`;
  const late = first === 1 ? '' : `, starting ${String(first - 1)} byte${first === 2 ? '' : 's'} late`;
  return `${list}: ${bytes}${late}`;
}

function mhz(hz: number): string {
  return `${String(hz / 1_000_000)} MHz`;
}

function fieldsOf(control: number, c: UlaControl): UlaControlField[] {
  return [
    { bits: '7-5', name: 'Cursor', value: `%${binary(control >> 5, 3)}`, meaning: cursorMeaning(c) },
    {
      bits: '4',
      name: 'Clock',
      value: c.characterClockHz === 2_000_000 ? '1' : '0',
      meaning: `6845 at ${mhz(c.characterClockHz)}: a byte every ${String(1_000_000 / c.characterClockHz)} µs`,
    },
    {
      bits: '3-2',
      name: 'Pixel clock',
      value: `%${binary((control >> 2) & 3, 2)}`,
      meaning: `${mhz(c.pixelClockHz)} (AUG: ${String(c.charactersPerLine)} characters a line): ${String(c.pixelClockHz / 1_000_000)} ÷ ${String(c.characterClockHz / 1_000_000)} = ${String(c.pixelsPerByte)} pixel${c.pixelsPerByte === 1 ? '' : 's'} a byte`,
    },
    {
      bits: '1',
      name: 'Teletext',
      value: c.teletext ? '1' : '0',
      meaning: c.teletext ? 'on: the SAA5050\'s RGB; the palette is not used' : 'off: the ULA\'s own pixels, through the palette',
    },
    {
      bits: '0',
      name: 'Flash',
      value: c.flash ? '1' : '0',
      meaning: c.flash ? 'second phase: flashing entries show their complement' : 'first phase: flashing entries show their first colour',
    },
  ];
}

function summaryOf(control: number, c: UlaControl): string {
  const modes = mosModesFor(control);
  const which = modes.length === 0 ? 'not a MOS MODE' : `MODE ${modes.join(' or ')}`;
  const head = `&${hex8(control)}: ${which}.`;
  if (c.teletext) return `${head} Teletext: the SAA5050 colours the screen, and the palette is not used`;
  const pixels = `${String(c.pixelsPerByte)} pixel${c.pixelsPerByte === 1 ? '' : 's'} a byte`;
  if (c.bitsPerPixel === undefined) return `${head} ${pixels}: ${c.pixelsPerByte > 8 ? 'more than a byte has' : 'more bits than the 4-bit palette index'}`;
  const across = Math.round(c.pixelClockHz * DISPLAYED_LINE_SECONDS);
  return `${head} ${pixels}, ${String(c.bitsPerPixel)} bit${c.bitsPerPixel === 1 ? '' : 's'} each: ${String(2 ** c.bitsPerPixel)} colours, ${String(across)} pixels across`;
}

function swatchOf(index: number, stored: number, flash: boolean): PaletteSwatch {
  const flashing = (stored & ULA_PALETTE_FLASH) !== 0;
  const first = paletteColour(stored, false);
  const colour = paletteColour(stored, flash);
  const entry = `&${index.toString(16).toUpperCase()}`;
  const nibble = `&${stored.toString(16).toUpperCase()}`;
  const label = `Entry ${entry} (${binary(index, 4)}): stored ${nibble}`;
  const eor = `${String(stored & 7)} EOR 7 = ${String(first)} ${colourName(first)}`;
  return {
    entry,
    binary: binary(index, 4),
    stored: nibble,
    colour,
    name: flashing ? `${colourName(first)}/${colourName(first ^ 7)}` : colourName(first),
    css: CSS_COLOURS[colour] ?? CSS_COLOURS[0],
    flashing,
    title: flashing ? `${label}, flashing: ${eor}, then ${colourName(first ^ 7)}. Now ${colourName(colour)}` : `${label}, ${eor}`,
  };
}

function noteOf(c: UlaControl): string {
  if (c.teletext) return 'Teletext: the palette is not used. The MOS doesn\'t write it for MODE 7, so these entries are left from before.';
  switch (c.bitsPerPixel) {
    case 1:
      return '2 colours: only index bit 3 comes from the pixel, so the MOS sets entries 0-7 to one colour and 8-F to the other. Stage 41 shows why.';
    case 2:
      return '4 colours: index bits 3 and 1 come from the pixel, so the MOS writes each colour to four entries. Stage 41 shows why.';
    case 4:
      return '16 colours: all four index bits are the pixel, so entry n is logical colour n. 8-F flash.';
    case undefined:
      return 'No MOS MODE uses this pixel rate with this clock.';
  }
}

export function buildVideoUlaView(input: VideoUlaViewInput): VideoUlaView {
  const control = input.control & 0xff;
  const c = decodeUlaControl(control);
  return {
    summary: summaryOf(control, c),
    fields: fieldsOf(control, c),
    swatches: Array.from({ length: 16 }, (_, i) => swatchOf(i, (input.entries[i] ?? 0) & 0x0f, c.flash)),
    note: noteOf(c),
  };
}
