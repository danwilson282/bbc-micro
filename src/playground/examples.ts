// Example programs for the Assembler panel, as assembly source.
//
// The Stage 06 and 07 programs were hand-assembled into listings. Their
// source text is generated from those listings, so a test can check that
// the assembler turns each line back into exactly the bytes worked out by hand.

import { hex16 } from '../util/bits';
import type { ListingLine } from './listing';
import { LOADS_PROGRAM } from './loads-program';
import { STORES_PROGRAM } from './stores-program';

export interface Example {
  /** Used in ?program=<id>. */
  readonly id: string;
  readonly title: string;
  readonly source: string;
}

/** Turns a hand-assembled listing back into source: a *= line, then one line per instruction. */
export function sourceFromListing(heading: string, lines: readonly ListingLine[]): string {
  const start = lines[0]?.address ?? 0x0400;
  return [
    `; ${heading}`,
    '',
    `        *= &${hex16(start)}`,
    ...lines.map((line) => `        ${line.source.padEnd(14)}; ${line.comment}`),
    '',
  ].join('\n');
}

/**
 * Stage 08: the first program written as assembly. Labels, constants, a
 * forward reference, .word, .byte and ptr+1, using only instructions the
 * CPU can run so far (loads, stores, transfers, NOP).
 */
export const LABELS_SOURCE = `; Stage 08: the first program written as assembly, not by hand.
; It copies "BBC" from a message onto row 2 of the Mode 7 screen,
; through a zero-page pointer it sets up itself.

screen  = &7C00           ; Mode 7 screen memory
row2    = screen + 80     ; 40 bytes per row, so row 2 is &7C50
ptr     = &80             ; a zero-page pointer at &80/&81

        *= &0400
start:  LDA target        ; forward reference: absolute, 3 bytes
        STA ptr           ; ptr is already known: zero page, 2 bytes
        LDA target+1
        STA ptr+1         ; the pointer at &80/&81 now holds &7C50
        LDY #0
        LDA message       ; "B"
        STA (ptr),Y       ; to &7C50
        LDY #1
        LDA message+1     ; "B"
        STA (ptr),Y       ; to &7C51
        LDX message+2     ; "C"
        STX row2+2        ; to &7C52, no pointer needed
        NOP               ; the CPU can't stop yet: it runs on into the data

target: .word row2        ; a word is stored low byte first: 50 7C
message: .byte &42, &42, &43  ; "BBC"
`;

const LABELS_EXAMPLE: Example = { id: 'labels', title: 'Stage 08: labels and pointers', source: LABELS_SOURCE };

export const EXAMPLES: readonly Example[] = [
  LABELS_EXAMPLE,
  { id: 'stores', title: 'Stage 07: stores & transfers', source: sourceFromListing('Stage 07: copy "HELLO" from row 0 to row 1 of the Mode 7 screen.', STORES_PROGRAM) },
  { id: 'loads', title: 'Stage 06: loads', source: sourceFromListing('Stage 06: eleven loads, one mode or flag result each.', LOADS_PROGRAM) },
];

/** The example with this id, or the current stage's if there's none. */
export function findExample(id: string | null): Example {
  return EXAMPLES.find((example) => example.id === id) ?? LABELS_EXAMPLE;
}
