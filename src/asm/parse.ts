// Reading assembly text: numbers, expressions, operands and whole lines.
//
// Pure string handling, no addresses. Each function reads one piece and
// either returns a small structure or throws a LineError saying what's wrong
// in words a person can act on. The assembler (assembler.ts) catches it and
// adds the line number.
//
//   loop:  LDA &7C00,X   ; next letter
//   └label └statement     └comment
//          └mnemonic + operand (shape: direct, index X)

import { isMnemonic, type Mnemonic } from './encodings';

/** A mistake on one line of source. The assembler adds the line number. */
export class LineError extends Error {
  override readonly name = 'LineError';
}

// --- Numbers and expressions ------------------------------------------------

/**
 * A number literal: &hex (BBC), $hex (6502.org and the datasheets), %binary or
 * decimal. Undefined if text isn't one. No range check: that depends on where
 * the number is used.
 */
export function parseNumber(text: string): number | undefined {
  const match = /^(?:[&$]([0-9a-f]+)|%([01]+)|([0-9]+))$/i.exec(text);
  if (match === null) return undefined;
  const hex = group(match, 1);
  if (hex !== undefined) return parseInt(hex, 16);
  const binary = group(match, 2);
  if (binary !== undefined) return parseInt(binary, 2);
  return parseInt(group(match, 3) ?? '', 10);
}

/**
 * Capture group n. TypeScript types groups as string, but a group in an
 * alternative that didn't match is undefined at run time.
 */
function group(match: RegExpExecArray, n: number): string | undefined {
  const value: string | undefined = match[n];
  return value;
}

/** A label or constant name. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names that can't be labels, because operands use them for registers. */
function isRegisterName(name: string): boolean {
  return /^[AXY]$/i.test(name);
}

export interface Term {
  readonly sign: 1 | -1;
  /** A literal value, or the name of a label or constant. */
  readonly value: number | string;
}

/** A sum of terms, e.g. "screen + 80" or "ptr+1". */
export interface Expression {
  readonly text: string;
  readonly terms: readonly Term[];
}

/** Reads "a + b - c". Only + and -: brackets already mean "indirect" in an operand. */
export function parseExpression(text: string): Expression {
  const trimmed = text.trim();
  const terms: Term[] = [];
  // Split into alternating [term, operator, term, ...], keeping the operators.
  const pieces = trimmed.split(/([+-])/).map((piece) => piece.trim());
  let sign: 1 | -1 = 1;
  let after = '';
  pieces.forEach((piece, i) => {
    if (i % 2 === 1) {
      sign = piece === '-' ? -1 : 1;
      after = piece;
      return;
    }
    // A leading sign ("-1") leaves an empty first piece. Anywhere else, an
    // empty piece is a missing value.
    if (piece === '' && i === 0 && pieces.length > 1) return;
    if (piece === '') throw new LineError(after === '' ? 'missing a value' : `missing a value after "${after}"`);
    const number = parseNumber(piece);
    if (number !== undefined) terms.push({ sign, value: number });
    else if (NAME.test(piece)) terms.push({ sign, value: piece });
    else throw new LineError(`"${piece}" isn't a number or a label`);
  });
  return { text: trimmed, terms };
}

/** The expression's value, or undefined if it uses a name that isn't in symbols (yet). */
export function evaluate(expr: Expression, symbols: ReadonlyMap<string, number>): number | undefined {
  let total = 0;
  for (const term of expr.terms) {
    const value = typeof term.value === 'number' ? term.value : symbols.get(term.value);
    if (value === undefined) return undefined;
    total += term.sign * value;
  }
  return total;
}

/** The first name in expr that symbols doesn't have, for error messages. */
export function firstUnknown(expr: Expression, symbols: ReadonlyMap<string, number>): string | undefined {
  for (const term of expr.terms) {
    if (typeof term.value === 'string' && !symbols.has(term.value)) return term.value;
  }
  return undefined;
}

// --- Operands ---------------------------------------------------------------

/**
 * The operand's shape. It narrows the addressing mode down to a family; the
 * assembler picks within it (zero page or absolute) once it knows the value.
 */
export type Operand =
  | { readonly kind: 'none' }
  | { readonly kind: 'accumulator' }
  | { readonly kind: 'immediate'; readonly expr: Expression }
  | { readonly kind: 'direct'; readonly expr: Expression; readonly index: 'X' | 'Y' | undefined }
  | { readonly kind: 'indirect'; readonly expr: Expression }
  | { readonly kind: 'indexedIndirectX'; readonly expr: Expression }
  | { readonly kind: 'indirectIndexedY'; readonly expr: Expression };

export function parseOperand(text: string): Operand {
  const t = text.trim();
  if (t === '') return { kind: 'none' };
  if (/^a$/i.test(t)) return { kind: 'accumulator' };
  if (t.startsWith('#')) return { kind: 'immediate', expr: parseExpression(t.slice(1)) };

  if (t.startsWith('(')) {
    let m = /^\((.*),\s*x\s*\)$/i.exec(t);
    if (m !== null) return { kind: 'indexedIndirectX', expr: parseExpression(m[1]) };
    m = /^\((.*)\)\s*,\s*y$/i.exec(t);
    if (m !== null) return { kind: 'indirectIndexedY', expr: parseExpression(m[1]) };
    if (/^\(.*,\s*y\s*\)$/i.test(t)) throw new LineError("(&nn,Y) doesn't exist: did you mean (&nn),Y?");
    if (/^\(.*\)\s*,\s*x$/i.test(t)) throw new LineError("(&nn),X doesn't exist: did you mean (&nn,X)?");
    m = /^\(([^,]*)\)$/.exec(t);
    if (m !== null) return { kind: 'indirect', expr: parseExpression(m[1]) };
    throw new LineError('unmatched bracket');
  }

  const comma = t.lastIndexOf(',');
  if (comma === -1) return { kind: 'direct', expr: parseExpression(t), index: undefined };
  const index = t.slice(comma + 1).trim().toUpperCase();
  if (index !== 'X' && index !== 'Y') throw new LineError('an index must be X or Y');
  return { kind: 'direct', expr: parseExpression(t.slice(0, comma)), index };
}

// --- Lines ------------------------------------------------------------------

export type Statement =
  | { readonly kind: 'empty' }
  | { readonly kind: 'origin'; readonly expr: Expression }
  | { readonly kind: 'constant'; readonly name: string; readonly expr: Expression }
  | { readonly kind: 'byte' | 'word'; readonly values: readonly Expression[] }
  | { readonly kind: 'instruction'; readonly mnemonic: Mnemonic; readonly operand: Operand };

export interface ParsedLine {
  /** A label defined on this line ("loop:"), naming the address of whatever follows. */
  readonly label: string | undefined;
  readonly statement: Statement;
  /** The line without its comment, trimmed. */
  readonly code: string;
  /** The text after ";", trimmed. */
  readonly comment: string;
}

function checkName(name: string): string {
  if (isRegisterName(name)) throw new LineError(`"${name}" can't be a label: A, X and Y are register names`);
  return name;
}

/** Reads one line of source. Throws LineError if it doesn't make sense. */
export function parseLine(text: string): ParsedLine {
  const semicolon = text.indexOf(';');
  const code = (semicolon === -1 ? text : text.slice(0, semicolon)).trim();
  const comment = semicolon === -1 ? '' : text.slice(semicolon + 1).trim();
  const line = (label: string | undefined, statement: Statement): ParsedLine => ({ label, statement, code, comment });

  // "*= &0400" sets the address of the next byte.
  const origin = /^\*\s*=(.*)$/.exec(code);
  if (origin !== null) return line(undefined, { kind: 'origin', expr: parseExpression(origin[1]) });

  // "screen = &7C00" names a number.
  const constant = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(code);
  if (constant !== null) {
    const name = checkName(constant[1]);
    return line(undefined, { kind: 'constant', name, expr: parseExpression(constant[2]) });
  }

  // "loop:" names this address.
  let rest = code;
  let label: string | undefined;
  const labelled = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(code);
  if (labelled !== null) {
    label = checkName(labelled[1]);
    rest = labelled[2].trim();
  }
  if (rest === '') return line(label, { kind: 'empty' });

  const [word = '', ...others] = rest.split(/\s+/);
  const operandText = rest.slice(word.length);

  if (word.startsWith('.')) {
    const directive = word.toLowerCase();
    if (directive !== '.byte' && directive !== '.word') {
      throw new LineError(`unknown directive "${word}" (this assembler has .byte and .word)`);
    }
    if (operandText.trim() === '') throw new LineError(`${directive} needs at least one value`);
    const values = operandText.split(',').map(parseExpression);
    return line(label, { kind: directive === '.byte' ? 'byte' : 'word', values });
  }

  const mnemonic = word.toUpperCase();
  if (!isMnemonic(mnemonic)) {
    const next = (others.at(0) ?? '').toUpperCase();
    const hint = label === undefined && NAME.test(word) && isMnemonic(next) ? ` (a label needs a colon: "${word}:")` : '';
    throw new LineError(`unknown mnemonic "${mnemonic}"${hint}`);
  }
  return line(label, { kind: 'instruction', mnemonic, operand: parseOperand(operandText) });
}
