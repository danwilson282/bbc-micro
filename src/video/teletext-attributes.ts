// The SAA5050's control codes: teletext's "serial attributes" (Stage 32).
//
// MODE 7 has no colour memory. Colours and graphics are switched on by
// control codes (&00-&1F once bit 7 is dropped) in the text itself. Each
// takes a cell, and changes how the rest of the row is drawn. So a row is
// read left to right, keeping a little state: this file is that state and
// the rules for changing it.
//
// Each cell is three steps (see decodeCell):
//   1. set-at codes change the state (so their own cell already shows it);
//   2. the cell is decided from the state: a letter, a mosaic, or blank;
//   3. set-after codes change the state (from the next cell on).
// Which codes are which comes from the teletext broadcast specification the
// chip was built for (BBC/IBA/BREMA 1976, later ETS 300 706): the data
// sheet doesn't say.
//
// Every row starts from Table 1's "presumed" codes (marked **): white text
// on black, contiguous, released. The chip's LOSE input resets it before
// every TV line (data sheet, pin 26).
//
// Not built yet (Stage 33): flash, steady, double/normal height, conceal.
// They're recognised (named below) and drawn blank, and change nothing.

import { teletextCharacter } from './saa5050-font';

/** The 32 control codes, by their names in the data sheet's Table 1 (bit 7 dropped: the BBC's &81 is ALPHA_RED). */
export const TELETEXT = {
  NUL: 0x00,
  ALPHA_RED: 0x01,
  ALPHA_GREEN: 0x02,
  ALPHA_YELLOW: 0x03,
  ALPHA_BLUE: 0x04,
  ALPHA_MAGENTA: 0x05,
  ALPHA_CYAN: 0x06,
  ALPHA_WHITE: 0x07,
  FLASH: 0x08,
  STEADY: 0x09,
  END_BOX: 0x0a,
  START_BOX: 0x0b,
  NORMAL_HEIGHT: 0x0c,
  DOUBLE_HEIGHT: 0x0d,
  SO: 0x0e,
  SI: 0x0f,
  DLE: 0x10,
  GRAPHICS_RED: 0x11,
  GRAPHICS_GREEN: 0x12,
  GRAPHICS_YELLOW: 0x13,
  GRAPHICS_BLUE: 0x14,
  GRAPHICS_MAGENTA: 0x15,
  GRAPHICS_CYAN: 0x16,
  GRAPHICS_WHITE: 0x17,
  CONCEAL_DISPLAY: 0x18,
  CONTIGUOUS_GRAPHICS: 0x19,
  SEPARATED_GRAPHICS: 0x1a,
  ESC: 0x1b,
  BLACK_BACKGROUND: 0x1c,
  NEW_BACKGROUND: 0x1d,
  HOLD_GRAPHICS: 0x1e,
  RELEASE_GRAPHICS: 0x1f,
} as const;

/** The SAA5050's 7 data inputs (D1-D7): bit 7 isn't wired. */
const CODE_MASK = 0x7f;
/** Codes below this are control codes (Table 1, columns 0 and 1). */
const FIRST_PRINTABLE = 0x20;
/** In graphics mode, codes with this bit set are mosaics (columns 2a, 3a, 6a, 7a); the rest blast through as letters. */
const MOSAIC_BIT = 0x20;
/** The colour number is the bottom 3 bits of a colour code: bit 0 red, bit 1 green, bit 2 blue. */
const COLOUR_MASK = 0x07;
const WHITE = 7;
const BLACK = 0;
/** What a cleared held-mosaic register holds: a graphics space. */
const SPACE = 0x20;

/** The row's attributes so far. One per renderer, reset by startRow. */
export interface TeletextState {
  /** Colour number 1-7 of lit dots (there's no black foreground on the SAA5050). */
  foreground: number;
  /** Colour number 0-7 of everything else. */
  background: number;
  /** Graphics mode (after &91-&97) or text mode (after &81-&87). */
  graphics: boolean;
  separated: boolean;
  /** Hold graphics: control cells show the held mosaic instead of a space. */
  hold: boolean;
  /** The last mosaic drawn in this row (7-bit), or &20 if none since the row or the mode changed. */
  heldCode: number;
  /** Whether heldCode was drawn separated. */
  heldSeparated: boolean;
}

export type TeletextCellKind = 'blank' | 'letter' | 'mosaic';

/** What one cell draws as. decodeCell fills it in, so one object serves a whole screen. */
export interface TeletextCell {
  kind: TeletextCellKind;
  /** The 7-bit code to draw: a font character for a letter, a sixel pattern for a mosaic. */
  code: number;
  foreground: number;
  background: number;
  /** For a mosaic: draw it with gaps. */
  separated: boolean;
}

export function createTeletextState(): TeletextState {
  const state: TeletextState = { foreground: WHITE, background: BLACK, graphics: false, separated: false, hold: false, heldCode: SPACE, heldSeparated: false };
  startRow(state);
  return state;
}

export function createTeletextCell(): TeletextCell {
  return { kind: 'blank', code: SPACE, foreground: WHITE, background: BLACK, separated: false };
}

/** Table 1's codes "presumed before each row begins": Alpha White, Contiguous, Black Background, Release (and Steady, Normal Height: Stage 33). */
export function startRow(state: TeletextState): void {
  state.foreground = WHITE;
  state.background = BLACK;
  state.graphics = false;
  state.separated = false;
  state.hold = false;
  state.heldCode = SPACE;
  state.heldSeparated = false;
}

/** Switches between text and graphics. A real change clears the held mosaic. */
function setGraphics(state: TeletextState, graphics: boolean): void {
  if (state.graphics !== graphics) {
    state.heldCode = SPACE;
    state.heldSeparated = false;
  }
  state.graphics = graphics;
}

/**
 * Decodes the next cell of the row: applies byte's set-at effect, fills in
 * cell with what it shows, then applies its set-after effect. Call
 * startRow first, then this for each of the row's 40 bytes in order.
 */
export function decodeCell(state: TeletextState, byte: number, cell: TeletextCell): void {
  const code = byte & CODE_MASK;

  // 1. Set-at: these take effect in their own cell.
  switch (code) {
    case TELETEXT.CONTIGUOUS_GRAPHICS:
      state.separated = false;
      break;
    case TELETEXT.SEPARATED_GRAPHICS:
      state.separated = true;
      break;
    case TELETEXT.BLACK_BACKGROUND:
      state.background = BLACK;
      break;
    case TELETEXT.NEW_BACKGROUND:
      state.background = state.foreground;
      break;
    case TELETEXT.HOLD_GRAPHICS:
      state.hold = true;
      break;
  }

  // 2. What this cell shows, from the state as it is now.
  cell.foreground = state.foreground;
  cell.background = state.background;
  if (code < FIRST_PRINTABLE) {
    // A control code is a space, unless holding: then it repeats the held
    // mosaic. A held &20 (nothing held yet) lights nothing, so it's blank too.
    const holding = state.graphics && state.hold && state.heldCode !== SPACE;
    cell.kind = holding ? 'mosaic' : 'blank';
    cell.code = holding ? state.heldCode : SPACE;
    cell.separated = holding && state.heldSeparated;
  } else if (state.graphics && (code & MOSAIC_BIT) !== 0) {
    cell.kind = 'mosaic';
    cell.code = code;
    cell.separated = state.separated;
    state.heldCode = code;
    state.heldSeparated = state.separated;
  } else {
    // Text mode, or a blast-through capital (&40-&5F) in graphics mode.
    cell.kind = 'letter';
    cell.code = code;
    cell.separated = false;
  }

  // 3. Set-after: these take effect from the next cell.
  if (code >= TELETEXT.ALPHA_RED && code <= TELETEXT.ALPHA_WHITE) {
    state.foreground = code & COLOUR_MASK;
    setGraphics(state, false);
  } else if (code >= TELETEXT.GRAPHICS_RED && code <= TELETEXT.GRAPHICS_WHITE) {
    state.foreground = code & COLOUR_MASK;
    setGraphics(state, true);
  } else if (code === TELETEXT.RELEASE_GRAPHICS) {
    state.hold = false;
  }
}

/** Decodes a whole row of bytes into new cells. For tests and the CLI: the renderer reuses one cell instead. */
export function decodeRow(bytes: readonly number[]): TeletextCell[] {
  const state = createTeletextState();
  return bytes.map((byte) => {
    const cell = createTeletextCell();
    decodeCell(state, byte, cell);
    return cell;
  });
}

// Fig. 9's layout: which of the 6 blocks each code bit lights. Bit 5 is
// always 1 in a mosaic, so the bottom-right block is bit 6.
const TOP_LEFT = 0x01;
const TOP_RIGHT = 0x02;
const MIDDLE_LEFT = 0x04;
const MIDDLE_RIGHT = 0x08;
const BOTTOM_LEFT = 0x10;
const BOTTOM_RIGHT = 0x40;

/** Dots 0-2 and 3-5 as a 6-dot mask, bit 5 = dot 0 (the leftmost). */
const LEFT_BLOCK = 0b111000;
const RIGHT_BLOCK = 0b000111;
/** Separated (Fig. 10): each block loses its leftmost dot. */
const LEFT_BLOCK_SEPARATED = 0b011000;
const RIGHT_BLOCK_SEPARATED = 0b000011;

/**
 * The 6 dots (bit 5 = dot 0, the leftmost) that a mosaic lights on one of
 * the cell's 10 lines. The blocks are 3 dots wide and 3, 4 and 3 lines
 * high, and fill the whole cell (Fig. 9). Separated, each block also loses
 * its bottom line (lines 2, 6 and 9).
 */
export function mosaicLine(code: number, separated: boolean, line: number): number {
  let left: number;
  let right: number;
  if (line < 3) {
    if (separated && line === 2) return 0;
    left = TOP_LEFT;
    right = TOP_RIGHT;
  } else if (line < 7) {
    if (separated && line === 6) return 0;
    left = MIDDLE_LEFT;
    right = MIDDLE_RIGHT;
  } else {
    if (separated && line === 9) return 0;
    left = BOTTOM_LEFT;
    right = BOTTOM_RIGHT;
  }
  return ((code & left) !== 0 ? (separated ? LEFT_BLOCK_SEPARATED : LEFT_BLOCK) : 0) | ((code & right) !== 0 ? (separated ? RIGHT_BLOCK_SEPARATED : RIGHT_BLOCK) : 0);
}

// Unicode 13's block sextants (U+1FB00-U+1FB3B) number their 6 blocks
// 1-6 in Fig. 9's order, so a mosaic's blocks are a 6-bit pattern. They
// skip the 4 patterns Unicode already had: none, all, the left column (21)
// and the right column (42).
const SEXTANT_BASE = 0x1fb00;
const LEFT_COLUMN = 0b010101;
const RIGHT_COLUMN = 0b101010;
const ALL_BLOCKS = 0b111111;

function sextant(code: number): string {
  // Bits 0-4 are blocks 1-5; bit 6 is block 6.
  const blocks = (code & 0x1f) | ((code & BOTTOM_RIGHT) >> 1);
  if (blocks === 0) return ' ';
  if (blocks === ALL_BLOCKS) return '█';
  if (blocks === LEFT_COLUMN) return '▌';
  if (blocks === RIGHT_COLUMN) return '▐';
  const index = blocks - 1 - (blocks > LEFT_COLUMN ? 1 : 0) - (blocks > RIGHT_COLUMN ? 1 : 0);
  return String.fromCodePoint(SEXTANT_BASE + index);
}

/** The cell as text, for the text layer and the CLI: a letter's character, a mosaic's block sextant, or a space. */
export function teletextCellText(cell: TeletextCell): string {
  if (cell.kind === 'letter') return teletextCharacter(cell.code);
  if (cell.kind === 'mosaic') return sextant(cell.code);
  return ' ';
}
