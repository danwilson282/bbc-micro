// The Disassembly panel's view-model. Two halves, with two sources:
//
//   Just ran  (from the trace: what really ran, with the bytes it had then)
//     &040D  8D 28 7C  STA screen        cycle 53   memory has changed since
//     &0410  EE 0E 04  INC &040E         cycle 57
//   Coming up  (disassembled from memory, starting at PC)
//   ▶ &0413  88        DEY
//     &0414  D0 F7     BNE store
//
// Nothing is decoded backwards from PC: with 1-3 byte instructions there's no
// reliable way to (Stage 18 doc, concept 2). The history comes from the trace.
//
// No DOM here: disassembly-panel.ts turns this into elements, Jest tests this.

import { IRQ_VECTOR, NMI_VECTOR } from '../../cpu/cpu6502';
import { disassemble, disassembleRange, type Labels } from '../../cpu/disassembler';
import type { TraceEntry } from '../../cpu/trace';
import { hex16, hex8 } from '../../util/bits';
import type { TracedTarget } from './debug-target';

/** How many trace entries "Just ran" shows. */
export const DISASSEMBLY_RAN_ROWS = 6;
/** How many instructions "Coming up" decodes. */
export const DISASSEMBLY_NEXT_ROWS = 12;

export interface RanRow {
  readonly addressHex: string;
  readonly label: string;
  /** The bytes as they were when it ran; "" for an interrupt. */
  readonly bytes: string;
  readonly text: string;
  /** e.g. "cycle 63": the CPU's cycle count when the step started. */
  readonly cycle: string;
  /** Memory no longer holds the bytes it ran with (self-modifying code, or a poke). */
  readonly changedSince: boolean;
}

export interface NextRow {
  readonly address: number;
  readonly addressHex: string;
  readonly label: string;
  readonly bytes: string;
  readonly text: string;
  /** PC is here: the ▶ line. */
  readonly current: boolean;
}

export interface DisassemblyView {
  readonly ran: readonly RanRow[];
  readonly heading: string;
  readonly next: readonly NextRow[];
  /** Set when the next step is an interrupt rather than the ▶ instruction. */
  readonly interrupt: string | undefined;
}

export interface DisassemblyOptions {
  /** Address → name, from the last assembly. */
  readonly labels?: Labels;
  /** Where "Coming up" starts. Undefined: follow PC. */
  readonly start?: number;
}

/** The assembler gives name → value; the disassembler wants value → name. The first name for a value wins. */
export function labelsFromSymbols(symbols: ReadonlyMap<string, number>): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [name, value] of symbols) if (!labels.has(value)) labels.set(value, name);
  return labels;
}

function ranRow(entry: TraceEntry, target: TracedTarget, labels: Labels | undefined): RanRow {
  const { pc, bytes } = entry;
  const common = { addressHex: `&${hex16(pc)}`, label: labels?.get(pc) ?? '', cycle: `cycle ${String(entry.cycles)}` };
  if (entry.kind !== 'instruction') {
    const vector = entry.kind === 'nmi' ? NMI_VECTOR : IRQ_VECTOR;
    return { ...common, bytes: '', text: `${entry.kind.toUpperCase()} (via &${hex16(vector)})`, changedSince: false };
  }
  // Decode the recorded bytes, not today's memory.
  const text = disassemble((address) => bytes[(address - pc) & 0xffff] ?? 0, pc, labels).text;
  const changedSince = bytes.some((byte, i) => target.peek((pc + i) & 0xffff) !== byte);
  return { ...common, bytes: bytes.map(hex8).join(' '), text, changedSince };
}

export function buildDisassemblyView(target: TracedTarget, options: DisassemblyOptions = {}): DisassemblyView {
  const { labels, start } = options;
  const pc = target.registers.pc;
  const from = start ?? pc;
  const peek = (address: number): number => target.peek(address);

  const ran = target.trace.recent(DISASSEMBLY_RAN_ROWS).map((entry) => ranRow(entry, target, labels));
  const next = disassembleRange(peek, from, DISASSEMBLY_NEXT_ROWS, labels).map((line) => ({
    address: line.address,
    addressHex: `&${hex16(line.address)}`,
    label: labels?.get(line.address) ?? '',
    bytes: line.bytes.map(hex8).join(' '),
    text: line.text,
    current: line.address === pc,
  }));

  const heading =
    start === undefined
      ? `Coming up: disassembled from memory, following PC (&${hex16(pc)})`
      : `From &${hex16(start)}: disassembled from memory (not following PC)`;

  const pending = target.pendingInterrupt;
  const interrupt =
    pending === undefined
      ? undefined
      : `Next step is an ${pending.toUpperCase()} (via &${hex16(pending === 'nmi' ? NMI_VECTOR : IRQ_VECTOR)}), not the ▶ line: it runs after the handler returns.`;

  return { ran, heading, next, interrupt };
}
