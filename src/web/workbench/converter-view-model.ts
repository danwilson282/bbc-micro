// The number converter's view-model: one value, shown four ways.
//
//   Hex      &41
//   Decimal  65
//   Binary   %0100 0001
//   ASCII    A
//
// Type into any field and the other three follow. Values are a byte
// (&00-&FF) or a word (&0100-&FFFF), the two widths the 6502 deals in.
// Negative decimals are stored as two's complement, so -1 becomes &FF and
// -200 becomes &FF38. No DOM here: converter-panel.ts draws it.

import { hex16, hex8, hi, lo, toSigned8 } from '../../util/bits';

export type NumberField = 'hex' | 'decimal' | 'binary' | 'ascii';

export interface Conversion {
  readonly value: number;
  /** 8 for &00-&FF, 16 for &0100-&FFFF. */
  readonly width: 8 | 16;
  /** "&41" or "&1234". */
  readonly hex: string;
  /** Unsigned, e.g. "65". */
  readonly decimal: string;
  /** "%0100 0001", grouped in nibbles so each group is one hex digit. */
  readonly binary: string;
  /** The character for a printable byte (&20-&7E), otherwise ''. */
  readonly ascii: string;
  /** Shown in an empty ASCII field: "CR", "not ASCII", "2 bytes". */
  readonly asciiHint: string;
  /** Extra readings: the ASCII meaning, the signed value, the byte order in memory. */
  readonly notes: readonly string[];
}

export type ConvertResult = { readonly ok: true; readonly conversion: Conversion } | { readonly ok: false; readonly error: string };

/**
 * The ASCII control codes &00-&1F, by their standard abbreviations and names
 * (ANSI X3.4-1968). The BBC's VDU drivers give many of them their own meanings
 * (VDU 12 clears the screen, for example); those come with the VDU stages.
 */
const CONTROL_CODES: readonly (readonly [string, string])[] = [
  ['NUL', 'null'],
  ['SOH', 'start of heading'],
  ['STX', 'start of text'],
  ['ETX', 'end of text'],
  ['EOT', 'end of transmission'],
  ['ENQ', 'enquiry'],
  ['ACK', 'acknowledge'],
  ['BEL', 'bell'],
  ['BS', 'backspace'],
  ['HT', 'horizontal tab'],
  ['LF', 'line feed'],
  ['VT', 'vertical tab'],
  ['FF', 'form feed'],
  ['CR', 'carriage return'],
  ['SO', 'shift out'],
  ['SI', 'shift in'],
  ['DLE', 'data link escape'],
  ['DC1', 'device control 1'],
  ['DC2', 'device control 2'],
  ['DC3', 'device control 3'],
  ['DC4', 'device control 4'],
  ['NAK', 'negative acknowledge'],
  ['SYN', 'synchronous idle'],
  ['ETB', 'end of transmission block'],
  ['CAN', 'cancel'],
  ['EM', 'end of medium'],
  ['SUB', 'substitute'],
  ['ESC', 'escape'],
  ['FS', 'file separator'],
  ['GS', 'group separator'],
  ['RS', 'record separator'],
  ['US', 'unit separator'],
];

/** "%0100 0001" for a byte, "%0001 0010 0011 0100" for a word. */
export function formatBinaryGroups(value: number, width: 8 | 16): string {
  const bits = value.toString(2).padStart(width, '0');
  const groups: string[] = [];
  for (let i = 0; i < width; i += 4) groups.push(bits.slice(i, i + 4));
  return `%${groups.join(' ')}`;
}

/** What one byte means as ASCII: the character (if printable), a short hint and a sentence. */
function asciiOf(byte: number): { readonly char: string; readonly hint: string; readonly note: string } {
  const code = `&${hex8(byte)}`;
  if (byte === 0x20) return { char: ' ', hint: 'space', note: `ASCII ${code} is a space.` };
  if (byte > 0x20 && byte < 0x7f) {
    const char = String.fromCharCode(byte);
    return { char, hint: char, note: `ASCII ${code} is "${char}".` };
  }
  if (byte === 0x7f) return { char: '', hint: 'DEL', note: `ASCII ${code} is DEL (delete), a control code.` };
  const control = byte < 0x20 ? CONTROL_CODES.at(byte) : undefined;
  if (control !== undefined) {
    const [abbr, name] = control;
    return { char: '', hint: abbr, note: `ASCII ${code} is ${abbr} (${name}), a control code: it has no printable character.` };
  }
  return { char: '', hint: 'not ASCII', note: `${code} has bit 7 set, so it isn't ASCII (ASCII is 7-bit: &00-&7F).` };
}

/** Every reading of value, which must already be in range (0-&FFFF). */
export function describeNumber(value: number): Conversion {
  const v = value & 0xffff;
  const width = v > 0xff ? 16 : 8;
  const notes: string[] = [];
  let ascii = '';
  let asciiHint: string;

  if (width === 8) {
    const a = asciiOf(v);
    ascii = a.char;
    asciiHint = a.hint;
    notes.push(a.note);
    if (v >= 0x80) {
      notes.push(`As a signed byte: ${String(toSigned8(v))} (bit 7 is worth -128, so &${hex8(v)} - &100).`);
    }
  } else {
    asciiHint = '2 bytes';
    const high = asciiOf(hi(v));
    const low = asciiOf(lo(v));
    notes.push(`ASCII is one byte per character: high byte &${hex8(hi(v))} is ${high.hint}, low byte &${hex8(lo(v))} is ${low.hint}.`);
    if (v >= 0x8000) {
      notes.push(`As a signed word: ${String(v - 0x10000)} (bit 15 is worth -32768, so &${hex16(v)} - &10000).`);
    }
    notes.push(`In memory, low byte first (6502 order): ${hex8(lo(v))} ${hex8(hi(v))}.`);
  }

  return {
    value: v,
    width,
    hex: width === 8 ? `&${hex8(v)}` : `&${hex16(v)}`,
    decimal: String(v),
    binary: formatBinaryGroups(v, width),
    ascii,
    asciiHint,
    notes,
  };
}

function fail(error: string): ConvertResult {
  return { ok: false, error };
}

function parseValue(field: NumberField, raw: string): number | string {
  const text = field === 'ascii' ? raw : raw.trim();
  switch (field) {
    case 'hex': {
      // Bare, BBC (&), assembler ($) or JS (0x), like the other workbench fields.
      const digits = /^(?:&|\$|0x)?([0-9a-f]+)$/i.exec(text)?.[1];
      if (digits === undefined) return 'Hex is digits 0-9 and A-F, e.g. &41';
      const value = parseInt(digits, 16);
      return value <= 0xffff ? value : 'Hex must fit in 16 bits: &0000-&FFFF';
    }
    case 'decimal': {
      if (!/^-?\d+$/.test(text)) return 'Decimal is a whole number, e.g. 65 or -1';
      const value = Number(text);
      if (value < -32768 || value > 65535) return 'Decimal must be -32768 to 65535';
      // Two's complement: a negative byte if it fits in one, otherwise a negative word.
      if (value < 0) return value >= -128 ? value & 0xff : value & 0xffff;
      return value;
    }
    case 'binary': {
      // Spaces and underscores are allowed between groups, as the output uses.
      const digits = /^%?([01][01 _]*)$/.exec(text)?.[1]?.replace(/[ _]/g, '');
      if (digits === undefined) return 'Binary is digits 0 and 1, e.g. %0100 0001';
      return digits.length <= 16 ? parseInt(digits, 2) : 'Binary must fit in 16 bits';
    }
    case 'ascii': {
      if (text.length !== 1) return 'ASCII is one character';
      const code = text.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e ? code : 'ASCII characters are &20-&7E (space to ~); type a control code as hex';
    }
  }
}

/** Parses what was typed into one field and, if it's valid, converts it. */
export function convertFrom(field: NumberField, text: string): ConvertResult {
  const parsed = parseValue(field, text);
  return typeof parsed === 'string' ? fail(parsed) : { ok: true, conversion: describeNumber(parsed) };
}
