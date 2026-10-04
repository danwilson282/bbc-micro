// The mini assembler: 6502 source text in, bytes out, in two passes.
//
//   Pass 1  works out every line's SIZE, so every label gets its address. An
//           operand that uses a label not seen yet (a forward reference) is
//           assumed to need 2 bytes.
//   Pass 2  works out every line's BYTES, now that every label is known. It
//           keeps the mode pass 1 chose, so nothing moves (no phase errors).
//
// Mistakes in the source aren't exceptions: they come back as a list of
// errors with line numbers, and then no bytes come back at all.

import { MODES, type AddressingMode } from '../cpu/addressing';
import { hex16 } from '../util/bits';
import { encodingsOf, opcodeFor, type Mnemonic } from './encodings';
import {
  LineError,
  evaluate,
  firstUnknown,
  parseLine,
  type Expression,
  type Operand,
  type ParsedLine,
} from './parse';

/** One line that produced bytes. Same shape as the playground's ListingLine. */
export interface AssembledLine {
  /** 1-based line number in the source. */
  readonly lineNumber: number;
  readonly address: number;
  readonly bytes: readonly number[];
  /** The code, without its comment, with any labels naming this address in front. */
  readonly source: string;
  readonly comment: string;
}

export interface AssemblyError {
  readonly lineNumber: number;
  readonly message: string;
  /** The whole source line, as typed. */
  readonly text: string;
}

export type Assembly =
  | {
      readonly ok: true;
      readonly lines: readonly AssembledLine[];
      /** Every label and constant, with its value. */
      readonly symbols: ReadonlyMap<string, number>;
      /** The first byte emitted: where "Assemble & Run" starts. Undefined if no bytes. */
      readonly entry: number | undefined;
    }
  | { readonly ok: false; readonly errors: readonly AssemblyError[] };

/** "line 7: unknown label "mesage"" */
export function formatError(error: AssemblyError): string {
  return `line ${String(error.lineNumber)}: ${error.message}`;
}

// --- Small helpers ----------------------------------------------------------

/** &7C for messages; plain decimal for negatives, which have no sensible hex. */
function show(value: number): string {
  return value < 0 ? String(value) : `&${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function checkByte(value: number): number {
  if (value < 0 || value > 0xff) throw new LineError(`${show(value)} doesn't fit in a byte (&00-&FF)`);
  return value;
}

function checkWord(value: number): number {
  if (value < 0 || value > 0xffff) throw new LineError(`${show(value)} doesn't fit in a word (&0000-&FFFF)`);
  return value;
}

/** "&nn, &nn,Y, &nnnn": a mnemonic's modes as you'd type them, in MODES order. */
function modeList(mnemonic: Mnemonic): string {
  const order = Object.keys(MODES);
  const modes = encodingsOf(mnemonic).map(([mode]) => mode);
  modes.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return modes.map((mode) => MODES[mode].syntax).join(', ');
}

function has(mnemonic: Mnemonic, mode: AddressingMode): boolean {
  return opcodeFor(mnemonic, mode) !== undefined;
}

/** Each zero-page mode's two-byte equivalent. */
const LONG_FORM: Partial<Record<AddressingMode, AddressingMode>> = {
  zeroPage: 'absolute',
  zeroPageX: 'absoluteX',
  zeroPageY: 'absoluteY',
};

// --- Choosing the mode ------------------------------------------------------

/**
 * Turns an operand's shape into one addressing mode. value is the operand's
 * value if it's known yet (pass 1 may not know it). Throws if the mnemonic
 * has no mode that fits.
 */
function chooseMode(mnemonic: Mnemonic, operand: Operand, value: number | undefined): AddressingMode {
  const impliedOnly = encodingsOf(mnemonic).every(([mode]) => mode === 'implied');
  if (impliedOnly) {
    if (operand.kind !== 'none') throw new LineError(`${mnemonic} takes no operand`);
    return 'implied';
  }
  if (has(mnemonic, 'relative')) {
    if (operand.kind !== 'direct' || operand.index !== undefined) {
      throw new LineError(`${mnemonic} only has Relative mode: give it a target address`);
    }
    return 'relative';
  }

  let mode: AddressingMode;
  switch (operand.kind) {
    case 'none':
      if (!has(mnemonic, 'accumulator')) throw new LineError(`${mnemonic} needs an operand`);
      return 'accumulator';
    case 'accumulator':
    case 'immediate':
    case 'indirect':
    case 'indexedIndirectX':
    case 'indirectIndexedY':
      mode = operand.kind;
      break;
    case 'direct': {
      const zp = operand.index === 'X' ? 'zeroPageX' : operand.index === 'Y' ? 'zeroPageY' : 'zeroPage';
      const abs = operand.index === 'X' ? 'absoluteX' : operand.index === 'Y' ? 'absoluteY' : 'absolute';
      // The short form whenever it's sure to fit; the long form otherwise,
      // including when pass 1 doesn't know the value yet.
      const fits = value !== undefined && value >= 0 && value <= 0xff;
      if (fits && has(mnemonic, zp)) mode = zp;
      else if (has(mnemonic, abs)) mode = abs;
      else if (has(mnemonic, zp)) mode = zp; // e.g. STY &nn,X: no long form exists
      else mode = abs;
      break;
    }
  }
  if (!has(mnemonic, mode)) throw new LineError(`${mnemonic} has no ${MODES[mode].name} mode (it has ${modeList(mnemonic)})`);
  return mode;
}

/** The operand's expression, if it has one. */
function operandExpression(operand: Operand): Expression | undefined {
  return operand.kind === 'none' || operand.kind === 'accumulator' ? undefined : operand.expr;
}

// --- The two passes ---------------------------------------------------------

/** What pass 1 learns about a line, for pass 2 to use. */
interface Planned {
  readonly lineNumber: number;
  readonly text: string;
  readonly parsed: ParsedLine;
  /** Undefined until the first *=. */
  readonly address: number | undefined;
  /** For instructions: the mode pass 1 chose, which fixes the size. */
  readonly mode: AddressingMode | undefined;
  /** Labels on this line, or on label-only lines just before it. */
  readonly labels: readonly string[];
}

export function assemble(source: string): Assembly {
  const errors: AssemblyError[] = [];
  const texts = source.split(/\r?\n/);
  const fail = (index: number, error: unknown): void => {
    if (!(error instanceof LineError)) throw error;
    errors.push({ lineNumber: index + 1, message: error.message, text: texts[index] ?? '' });
  };

  // Every name and the line that defined it. Labels get a value in pass 1;
  // constants get one as soon as everything they use is known.
  const symbols = new Map<string, number>();
  const definedOn = new Map<string, number>();
  const constants: { name: string; expr: Expression; lineIndex: number }[] = [];
  const define = (name: string, value: number | undefined, index: number): void => {
    const previous = definedOn.get(name);
    if (previous !== undefined) throw new LineError(`"${name}" is already defined on line ${String(previous)}`);
    definedOn.set(name, index + 1);
    if (value !== undefined) symbols.set(name, value);
  };

  // --- Pass 1: sizes and addresses ---
  const planned: Planned[] = [];
  let pc: number | undefined;
  let originFailed = false; // after a bad *=, don't also complain "no address yet"
  let pendingLabels: string[] = [];

  texts.forEach((text, index) => {
    try {
      const parsed = parseLine(text);
      const { statement } = parsed;

      if (statement.kind === 'origin') {
        const value = evaluate(statement.expr, symbols);
        if (value === undefined) {
          originFailed = true;
          const name = firstUnknown(statement.expr, symbols) ?? '';
          throw new LineError(`*= needs a value known at this point, not a forward reference ("${name}")`);
        }
        if (value < 0 || value > 0xffff) {
          originFailed = true;
          throw new LineError(`address ${show(value)} is beyond &FFFF`);
        }
        pc = value;
        originFailed = false;
        return;
      }
      if (statement.kind === 'constant') {
        define(statement.name, evaluate(statement.expr, symbols), index);
        constants.push({ name: statement.name, expr: statement.expr, lineIndex: index });
        return;
      }

      let mode: AddressingMode | undefined;
      let size = 0;
      if (statement.kind === 'instruction') {
        const expr = operandExpression(statement.operand);
        mode = chooseMode(statement.mnemonic, statement.operand, expr === undefined ? undefined : evaluate(expr, symbols));
        size = 1 + MODES[mode].operandBytes;
      } else if (statement.kind === 'byte') {
        size = statement.values.length;
      } else if (statement.kind === 'word') {
        size = 2 * statement.values.length;
      }

      if (pc === undefined && (size > 0 || parsed.label !== undefined)) {
        if (originFailed) return;
        throw new LineError('no address yet: put "*= &nnnn" before the first instruction or data');
      }
      if (parsed.label !== undefined) {
        define(parsed.label, pc, index);
        pendingLabels.push(parsed.label);
      }
      if (size === 0 || pc === undefined) return;

      planned.push({ lineNumber: index + 1, text, parsed, address: pc, mode, labels: pendingLabels });
      pendingLabels = [];
      pc += size;
      if (pc > 0x10000) {
        originFailed = true;
        pc = undefined;
        throw new LineError('the program runs past &FFFF');
      }
    } catch (error) {
      fail(index, error);
    }
  });

  // Constants that used later names: keep evaluating until nothing changes.
  let progress = true;
  while (progress) {
    progress = false;
    for (const { name, expr } of constants) {
      if (symbols.has(name)) continue;
      const value = evaluate(expr, symbols);
      if (value !== undefined) {
        symbols.set(name, value);
        progress = true;
      }
    }
  }
  for (const { name, lineIndex } of constants) {
    if (!symbols.has(name)) {
      fail(lineIndex, new LineError(`can't work out "${name}": it depends on itself or on an unknown label`));
    }
  }

  // --- Pass 2: bytes ---
  const valueOf = (expr: Expression): number | undefined => {
    const value = evaluate(expr, symbols);
    if (value !== undefined) return value;
    const name = firstUnknown(expr, symbols) ?? expr.text;
    // A constant that couldn't be worked out has had its error already.
    if (definedOn.has(name)) return undefined;
    throw new LineError(`unknown label "${name}"`);
  };

  const lines: AssembledLine[] = [];
  for (const plan of planned) {
    try {
      const bytes = encode(plan, valueOf);
      if (bytes === undefined) continue;
      const { label, code, comment } = plan.parsed;
      const body = label === undefined ? code : code.slice(code.indexOf(':') + 1).trim();
      const source = [...plan.labels.map((l) => `${l}:`), body].join(' ');
      lines.push({ lineNumber: plan.lineNumber, address: plan.address ?? 0, bytes, source, comment });
    } catch (error) {
      fail(plan.lineNumber - 1, error);
    }
  }

  if (errors.length > 0) {
    errors.sort((a, b) => a.lineNumber - b.lineNumber);
    return { ok: false, errors };
  }
  return { ok: true, lines, symbols, entry: lines[0]?.address };
}

/** One planned line's bytes, or undefined if a value can't be known (error already reported). */
function encode(plan: Planned, valueOf: (expr: Expression) => number | undefined): number[] | undefined {
  const { statement } = plan.parsed;
  const address = plan.address ?? 0;

  if (statement.kind === 'byte' || statement.kind === 'word') {
    const bytes: number[] = [];
    for (const expr of statement.values) {
      const value = valueOf(expr);
      if (value === undefined) return undefined;
      if (statement.kind === 'byte') bytes.push(checkByte(value));
      else bytes.push(checkWord(value) & 0xff, checkWord(value) >> 8);
    }
    return bytes;
  }
  if (statement.kind !== 'instruction' || plan.mode === undefined) return undefined;

  const { mnemonic, operand } = statement;
  const mode = plan.mode;
  const opcode = opcodeFor(mnemonic, mode);
  if (opcode === undefined) return undefined; // chooseMode already checked this
  const expr = operandExpression(operand);
  if (expr === undefined) return [opcode];
  const value = valueOf(expr);
  if (value === undefined) return undefined;

  if (mode === 'relative') {
    const target = checkWord(value);
    const offset = target - ((address + 2) & 0xffff);
    if (offset < -128 || offset > 127) {
      throw new LineError(`${mnemonic} target &${hex16(target)} is ${String(offset)} bytes away; a branch reaches -128..+127`);
    }
    return [opcode, offset & 0xff];
  }
  if (MODES[mode].operandBytes === 1) {
    if (operand.kind === 'direct' && value > 0xff) {
      // Only the zero-page form exists (STX &nn,Y, STY &nn,X) and the value is too big for it.
      const long = LONG_FORM[mode];
      if (long !== undefined) throw new LineError(`${mnemonic} has no ${MODES[long].name} mode (it has ${modeList(mnemonic)})`);
    }
    return [opcode, checkByte(value)];
  }
  const word = checkWord(value);
  return [opcode, word & 0xff, word >> 8];
}
