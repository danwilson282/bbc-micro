// The Assembler panel's view-model: what to say about an assembly result.
//
//   Assembled 36 bytes from 15 lines. Runs from &0400.
//   Labels: screen = &7C00, row2 = &7C50, ptr = &80, start = &0400, …
//
// No DOM here: assembler-panel.ts turns this into elements, Jest tests this.

import { formatError, type Assembly } from '../../asm/assembler';

export interface AssemblyView {
  /** One-line summary for the status line. */
  readonly status: string;
  readonly isError: boolean;
  /** "line 7: unknown label …", in line order. Empty on success. */
  readonly errors: readonly string[];
  /** "name = &value, …", or '' if there are none (or there were errors). */
  readonly symbols: string;
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** &80 for a byte-sized value, &7C00 for a bigger one. Negative constants print in decimal. */
function showSymbol(value: number): string {
  if (value < 0) return String(value);
  return `&${value.toString(16).toUpperCase().padStart(value > 0xff ? 4 : 2, '0')}`;
}

export function describeAssembly(result: Assembly): AssemblyView {
  if (!result.ok) {
    return {
      status: `${plural(result.errors.length, 'error')}: nothing was loaded.`,
      isError: true,
      errors: result.errors.map(formatError),
      symbols: '',
    };
  }
  const symbols = [...result.symbols].map(([name, value]) => `${name} = ${showSymbol(value)}`).join(', ');
  const bytes = result.lines.reduce((total, line) => total + line.bytes.length, 0);
  if (result.entry === undefined) {
    return { status: 'Nothing to run: the program has no instructions or data.', isError: true, errors: [], symbols };
  }
  return {
    status: `Assembled ${plural(bytes, 'byte')} from ${plural(result.lines.length, 'line')}. Runs from ${showSymbol(result.entry)}.`,
    isError: false,
    errors: [],
    symbols,
  };
}
