// The stack panel's view-model: page 1, from the bottom of the stack down to S.
//
//   S = &FC · 3 bytes in use · next push → &01FC · next pull ← &01FD
//   01FF  11  %0001 0001
//   01FE  22  %0010 0010
//   01FD  33  %0011 0011   next pull
//   01FC  00  %0000 0000   ← S (next push)
//   01FB  00  %0000 0000   (free)
//
// The 6502's stack grows DOWN from &01FF, so the table runs from &01FF
// downwards: the first byte pushed is at the top, and the newest is nearest S.
// No DOM here: stack-panel.ts turns this into elements, Jest tests this.

import { STACK_PAGE } from '../../cpu/cpu6502';
import { hex16, hex8 } from '../../util/bits';
import type { CpuTarget } from './debug-target';
import { formatBinary } from './registers-view-model';

/** Free slots shown below S, so you can see where the next few pushes will land. */
export const STACK_FREE_ROWS = 3;
/** The most rows the table shows. Deeper stacks lose their middle to a "⋮" row. */
export const STACK_MAX_ROWS = 20;
/** Rows kept from the bottom of the stack (&01FF down) when the middle is elided. */
const STACK_HEAD_ROWS = 4;
/** The last slot in page 1: an empty stack's first push goes here. */
const STACK_TOP = STACK_PAGE | 0xff;

/**
 * used:      above S, so a pull will return it eventually
 * next-push: exactly at S, where the next push will write
 * free:      below S. It may still hold an old value, but the next push overwrites it
 */
export type StackSlot = 'used' | 'next-push' | 'free';

export interface StackByte {
  readonly kind: 'byte';
  readonly address: number;
  /** e.g. "01FD". */
  readonly label: string;
  readonly value: number;
  readonly hex: string;
  /** e.g. "%0011 1101": a pushed P reads bit by bit. */
  readonly binary: string;
  readonly slot: StackSlot;
  /** The byte the next pull returns: &0100 + S + 1. */
  readonly isTop: boolean;
  /** Differs from the previous view. */
  readonly changed: boolean;
  /** The CPU wrote it in the last run. */
  readonly written: boolean;
}

/** Stands in for the rows left out of a deep stack. */
export interface StackGap {
  readonly kind: 'gap';
  readonly count: number;
  readonly text: string;
}

export type StackRow = StackByte | StackGap;

export interface StackView {
  readonly s: number;
  /** Bytes in use: &FF − S. */
  readonly depth: number;
  readonly summary: string;
  readonly rows: readonly StackRow[];
  /** All 256 bytes of page 1, so the next view can tell what changed. */
  readonly page: readonly number[];
}

export interface StackViewMarks {
  readonly previous?: StackView;
  /** Addresses the CPU wrote during the last run. */
  readonly written?: ReadonlySet<number>;
}

export function buildStackView(target: Pick<CpuTarget, 'peek' | 'registers'>, marks: StackViewMarks = {}): StackView {
  const s = target.registers.s & 0xff;
  const depth = 0xff - s;
  const page: number[] = [];
  for (let offset = 0; offset <= 0xff; offset++) page.push(target.peek(STACK_PAGE | offset) & 0xff);

  const byteRow = (address: number): StackByte => {
    const offset = address & 0xff;
    const value = page[offset] ?? 0;
    const previous = marks.previous?.page[offset];
    return {
      kind: 'byte',
      address,
      label: hex16(address),
      value,
      hex: hex8(value),
      binary: formatBinary(value),
      slot: offset > s ? 'used' : offset === s ? 'next-push' : 'free',
      isTop: offset === s + 1,
      changed: previous !== undefined && previous !== value,
      written: marks.written?.has(address) ?? false,
    };
  };

  // From &01FF down to a few free slots below S, but not past &0100.
  const lowest = STACK_PAGE | Math.max(0, s - STACK_FREE_ROWS);
  const total = STACK_TOP - lowest + 1;
  const rows: StackRow[] = [];
  if (total <= STACK_MAX_ROWS) {
    for (let address = STACK_TOP; address >= lowest; address--) rows.push(byteRow(address));
  } else {
    const tail = STACK_MAX_ROWS - STACK_HEAD_ROWS - 1;
    for (let i = 0; i < STACK_HEAD_ROWS; i++) rows.push(byteRow(STACK_TOP - i));
    const hidden = total - STACK_HEAD_ROWS - tail;
    rows.push({ kind: 'gap', count: hidden, text: `⋮ ${String(hidden)} more` });
    for (let address = lowest + tail - 1; address >= lowest; address--) rows.push(byteRow(address));
  }

  return { s, depth, summary: summarise(s, depth), rows, page };
}

/** "S = &FC · 3 bytes in use · next push → &01FC · next pull ← &01FD" */
function summarise(s: number, depth: number): string {
  const push = `next push → &${hex16(STACK_PAGE | s)}`;
  if (depth === 0) return `S = &${hex8(s)} · empty · ${push}`;
  const bytes = depth === 1 ? '1 byte' : `${String(depth)} bytes`;
  return `S = &${hex8(s)} · ${bytes} in use · ${push} · next pull ← &${hex16(STACK_PAGE | (s + 1))}`;
}
