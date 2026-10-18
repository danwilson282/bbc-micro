// The CRTC panel's view-model (Stage 37): the 6845's eighteen registers,
// what each value means, and the geometry worked through step by step.
//
//   R0   horizontal total   3F  W   64 characters a line: 64 µs
//   ...
//   Scanline   64 characters ÷ 1 MHz = 64 µs (15,625 Hz)
//   Field      31 rows × 10 lines + 2 = 312 lines, + ½ for interlace = 312.5
//
// Plus a to-scale drawing of one field, in percent: where the displayed
// area, HSYNC and VSYNC fall. No DOM here: crtc-panel.ts builds elements,
// Jest tests this.
//
// Stage 38 adds the counters: where the beam is now, the three outputs, and
// the field rate measured from the VSYNCs (not worked out from the registers):
//
//   Beam       line 280 of the field, character 12
//   Measured   VSYNC every 40,000 cycles = 20.000 ms: 50.00 Hz

import { CRTC_REGISTER_ACCESS, CRTC_REGISTER_COUNT, type CrtcAccess } from '../../devices/crtc6845';
import { characterClockHz, crtcGeometry, describeCrtcGeometry, type CrtcGeometry } from '../../devices/crtc-geometry';
import { CRTC_REGISTER_NAMES } from '../../devices/hardware-log';
import { hex16, hex8 } from '../../util/bits';

export interface CrtcViewInput {
  /** R0-R17, as Crtc6845.registers() gives them. */
  readonly registers: readonly number[];
  readonly addressRegister: number;
  /** The Video ULA's control byte (&FE20): its bit 4 is the 6845's clock. */
  readonly ulaControl: number;
  /** R0-R17 last time, to mark what changed. */
  readonly previous?: readonly number[];
  /** The chip's counters now (Stage 38): a Crtc6845 will do. */
  readonly counters?: CrtcCounters;
}

/** What the 6845's counters and outputs say now. Crtc6845 has all of these. */
export interface CrtcCounters {
  readonly character: number;
  readonly scanline: number;
  readonly row: number;
  readonly fieldLine: number;
  readonly inAdjust: boolean;
  readonly oddField: boolean;
  readonly hsync: boolean;
  readonly vsync: boolean;
  readonly displayEnable: boolean;
  readonly vsyncCount: number;
  readonly vsyncPeriodCycles: number;
}

export interface CrtcRegisterRow {
  /** "R0". */
  readonly label: string;
  readonly name: string;
  /** "3F". */
  readonly hex: string;
  /** "W", "R/W" or "R": what the CPU can do to it. */
  readonly access: string;
  /** The value in the register's own units, e.g. "128 characters a line: 64 µs". Empty for the low half of a pair. */
  readonly meaning: string;
  /** The register &FE01 reaches now. */
  readonly selected: boolean;
  readonly changed: boolean;
}

export interface GeometryLine {
  readonly label: string;
  readonly value: string;
}

/** A rectangle in percent of one field: characters across, scanlines down. */
export interface FrameBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CrtcView {
  readonly summary: string;
  readonly rows: readonly CrtcRegisterRow[];
  readonly geometry: readonly GeometryLine[];
  readonly frame: { readonly displayed: FrameBox; readonly hsync: FrameBox; readonly vsync: FrameBox };
  /** The counters in words (Stage 38): empty without counters. */
  readonly counters: readonly GeometryLine[];
  /** Where the beam is in the frame drawing (width and height 0), if the counters were given. */
  readonly beam?: FrameBox;
}

/** The 6502's clock: the measured period is in its cycles. */
const CPU_HZ = 2_000_000;

/** "50.00 Hz" from the cycles between two VSYNCs, or undefined before there have been two. */
export function vsyncRateText(periodCycles: number): string | undefined {
  if (periodCycles <= 0) return undefined;
  return `${(CPU_HZ / periodCycles).toFixed(2)} Hz`;
}

const ACCESS_TEXT: Readonly<Record<CrtcAccess, string>> = { write: 'W', 'read-write': 'R/W', read: 'R' };

/** Up to 3 decimals, with no trailing zeros: 64, 49, 0.5. */
function num(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** 15625 → "15,625". Done by hand so the output doesn't depend on the locale. */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function mhz(hz: number): string {
  return `${num(hz / 1_000_000)} MHz`;
}

/** µs from the start of a line to character `chars`. */
function microseconds(g: CrtcGeometry, chars: number): string {
  return `${num((chars * 1_000_000) / g.characterClockHz)} µs`;
}

function skewText(g: CrtcGeometry): string {
  if (g.displaySkew === 0 && g.cursorSkew === 0) return 'no skew';
  const one = (what: string, n: number): string => `${what} skew ${String(n)}${n === 3 ? ' (off)' : ''}`;
  return `${one('display', g.displaySkew)}, ${one('cursor', g.cursorSkew)}`;
}

const INTERLACE_NAME = { off: 'no interlace', sync: 'interlace sync', 'sync-and-video': 'interlace sync and video' } as const;

function cursorStartText(g: CrtcGeometry): string {
  switch (g.cursorBlink) {
    case 'off':
      return `no cursor (blink bits %01), line ${String(g.cursorStartLine)}`;
    case 'steady':
      return `cursor from line ${String(g.cursorStartLine)}, steady`;
    case 'fast':
      return `cursor from line ${String(g.cursorStartLine)}, blinks every 16 fields`;
    case 'slow':
      return `cursor from line ${String(g.cursorStartLine)}, blinks every 32 fields`;
  }
}

/** What each register's value means, R0-R17. */
function meanings(g: CrtcGeometry): string[] {
  const rows = g.interlace === 'sync-and-video'
    ? `${String(g.scanlinesPerRow)} lines a row in each field (${String(g.scanlinesPerRowPerFrame)} across both)`
    : `${String(g.scanlinesPerRow)} lines a row`;
  return [
    `${String(g.charactersPerLine)} characters a line: ${num(g.lineMicroseconds)} µs`,
    `${String(g.displayedCharacters)} shown`,
    `HSYNC at character ${String(g.hsyncStart)}: ${microseconds(g, g.hsyncStart)} in`,
    `HSYNC ${String(g.hsyncWidth)} characters (${microseconds(g, g.hsyncWidth)}), VSYNC ${String(g.vsyncLines)} lines`,
    `${String(g.rowsPerField)} rows a field`,
    `+${String(g.adjustLines)} lines`,
    `${String(g.displayedRows)} rows shown`,
    `VSYNC at row ${String(g.vsyncRow)}: line ${String(g.vsyncLine)}`,
    `${INTERLACE_NAME[g.interlace]}; ${skewText(g)}`,
    rows,
    cursorStartText(g),
    `cursor to line ${String(g.cursorEndLine)}`,
    `start address MA &${hex16(g.startAddress)}`,
    '',
    `cursor at MA &${hex16(g.cursorAddress)}`,
    '',
    'light pen: not connected',
    '',
  ];
}

function geometryLines(g: CrtcGeometry, ulaControl: number): GeometryLine[] {
  const whole = g.rowsPerField * g.scanlinesPerRow + g.adjustLines;
  const interlaced = g.interlace !== 'off';
  const fieldMs = (g.fieldMicroseconds / 1000).toFixed(3);
  const lineRate = `${thousands(g.lineRateHz)} Hz`;
  return [
    { label: 'Character clock', value: `${mhz(g.characterClockHz)} (ULA &FE20 bit 4 = ${(ulaControl >> 4) & 1 ? '1' : '0'})` },
    { label: 'Scanline', value: `${String(g.charactersPerLine)} characters ÷ ${mhz(g.characterClockHz)} = ${num(g.lineMicroseconds)} µs (${lineRate})` },
    {
      label: 'Field',
      value: `${String(g.rowsPerField)} rows × ${String(g.scanlinesPerRow)} lines + ${String(g.adjustLines)} = ${String(whole)} lines${interlaced ? `, + ½ for interlace = ${num(g.linesPerField)}` : ''}`,
    },
    {
      label: 'Field time',
      value: interlaced
        ? `${num(g.linesPerField)} × ${num(g.lineMicroseconds)} µs = ${fieldMs} ms: ${g.fieldRateHz.toFixed(2)} Hz fields, ${g.frameRateHz.toFixed(2)} Hz frames`
        : `${num(g.linesPerField)} × ${num(g.lineMicroseconds)} µs = ${fieldMs} ms: ${g.fieldRateHz.toFixed(2)} Hz, one field a frame`,
    },
    {
      label: 'Displayed',
      value: `${String(g.displayedCharacters)} × ${String(g.displayedRows)} characters: ${String(g.displayedLines)} of the ${num(g.linesPerField)} lines`,
    },
    {
      label: 'Interlace',
      value: {
        off: 'off: every field is the same',
        sync: 'sync only: both fields show the same lines',
        'sync-and-video': `sync and video: alternate fields show alternate lines (${String(g.displayedLines * 2)} a frame)`,
      }[g.interlace],
    },
  ];
}

/** Percent of `total`, clamped to 0-100 and rounded so floating-point noise doesn't show. */
function percent(part: number, total: number): number {
  const p = total <= 0 ? 0 : (part / total) * 100;
  return Math.round(Math.min(100, Math.max(0, p)) * 1e4) / 1e4;
}

/** A box that starts at `start` and lasts `size`, cut off at the edge of the field. */
function span(start: number, size: number, total: number): { at: number; size: number } {
  const at = percent(start, total);
  return { at, size: Math.min(percent(size, total), 100 - at) };
}

function frameBoxes(g: CrtcGeometry): CrtcView['frame'] {
  const across = g.charactersPerLine;
  const down = g.linesPerField;
  const dx = span(0, g.displayedCharacters, across);
  const dy = span(0, g.displayedLines, down);
  const hx = span(g.hsyncStart, g.hsyncWidth, across);
  const vy = span(g.vsyncLine, g.vsyncLines, down);
  return {
    displayed: { left: dx.at, top: dy.at, width: dx.size, height: dy.size },
    hsync: { left: hx.at, top: 0, width: hx.size, height: 100 },
    vsync: { left: 0, top: vy.at, width: 100, height: vy.size },
  };
}

function onOff(name: string, on: boolean): string {
  return `${name} ${on ? 'high' : 'low'}`;
}

/** The counters in words, as the panel lists them. */
function counterLines(c: CrtcCounters, g: CrtcGeometry): GeometryLine[] {
  const rate = vsyncRateText(c.vsyncPeriodCycles);
  const ms = ((c.vsyncPeriodCycles * 1000) / CPU_HZ).toFixed(3);
  const fields = `${thousands(c.vsyncCount)} VSYNCs since power-on`;
  return [
    { label: 'Beam', value: `line ${String(c.fieldLine)} of the field, character ${String(c.character)}` },
    {
      label: 'Counters',
      value: c.inAdjust ? `vertical adjust, after row ${String(c.row)}` : `row ${String(c.row)}, scanline ${String(c.scanline)}`,
    },
    { label: 'Outputs', value: `${onOff('DISPEN', c.displayEnable)}, ${onOff('HSYNC', c.hsync)}, ${onOff('VSYNC', c.vsync)}` },
    { label: 'Fields', value: g.interlace === 'off' ? fields : `${c.oddField ? 'odd' : 'even'} field; ${fields}` },
    {
      label: 'Measured',
      value: rate === undefined ? 'waiting for two VSYNCs' : `VSYNC every ${thousands(c.vsyncPeriodCycles)} cycles = ${ms} ms: ${rate}`,
    },
  ];
}

export function buildCrtcView(input: CrtcViewInput): CrtcView {
  const { registers, previous } = input;
  const g = crtcGeometry(registers, characterClockHz(input.ulaControl));
  const meaning = meanings(g);
  const rows: CrtcRegisterRow[] = [];
  for (let n = 0; n < CRTC_REGISTER_COUNT; n++) {
    const value = registers[n] ?? 0;
    rows.push({
      label: `R${String(n)}`,
      name: CRTC_REGISTER_NAMES[n] ?? '',
      hex: hex8(value),
      access: ACCESS_TEXT[CRTC_REGISTER_ACCESS[n] ?? 'write'],
      meaning: meaning[n] ?? '',
      selected: n === input.addressRegister,
      changed: previous !== undefined && previous[n] !== value,
    });
  }
  const c = input.counters;
  return {
    summary: describeCrtcGeometry(g),
    rows,
    geometry: geometryLines(g, input.ulaControl),
    frame: frameBoxes(g),
    counters: c === undefined ? [] : counterLines(c, g),
    beam: c === undefined ? undefined : { left: percent(c.character, g.charactersPerLine), top: percent(c.fieldLine, g.linesPerField), width: 0, height: 0 },
  };
}
