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

/**
 * Stage 09: counting up and down through the &FF/&00 join, in registers and
 * in memory, with the N and Z lights changing as it goes. No branches yet
 * (Stage 14), so it's straight-line code.
 */
export const INCDEC_SOURCE = `; Stage 09: increment & decrement. Step it and watch N and Z
; as values wrap round between &FF and &00. C never changes.

count   = &80             ; a counter in zero page
screen  = &7C00           ; "HELLO, BBC MICRO" is here

        *= &0400
start:  LDX #&FE          ; X=&FE: N=1, bit 7 is set
        INX               ; X=&FF: still negative
        INX               ; X=&00: wraps round. Z=1, N=0, no carry
        DEX               ; X=&FF: wraps back. N=1, Z=0
        LDY #&7F          ; Y=&7F (+127): N=0
        INY               ; Y=&80: N=1. +127 + 1 reads as -128
        DEY               ; Y=&7F: N=0 again
        LDA #&FE
        STA count         ; count=&FE
        INC count         ; count=&FF: 5 cycles, 2 writes
        INC count         ; count=&00: Z=1. A still holds &FE
        DEC count         ; count=&FF: N=1
        INC screen        ; "H" becomes "I": 6 cycles, 2 writes
        LDX #1
        DEC screen-1,X    ; &7BFF+1 crosses a page: still 7 cycles. "H" again
        NOP               ; then the NOP slide, and BRK at &0500 stops it
`;

const INCDEC_EXAMPLE: Example = { id: 'incdec', title: 'Stage 09: increment & decrement', source: INCDEC_SOURCE };

/**
 * Stage 10: a 16-bit addition, two signed overflows, then the addition run
 * backwards as a 16-bit subtraction. No CLC/SEC until Stage 14, so it uses
 * C=0 from our reset, and an overflowing ADC leaves C=1 ready for the SBCs.
 */
export const ARITHMETIC_SOURCE = `; Stage 10: binary arithmetic. 1000 + 300 in 16 bits, then back.
; Watch C carry the ninth bit from the low byte into the high byte.
; No CLC or SEC yet (Stage 14): C starts at 0 after our reset.

sum     = &80             ; 2 bytes, low byte first: &80/&81
diff    = &82             ; 2 bytes: &82/&83

        *= &0400
start:  LDA #&E8          ; low byte of 1000 (&03E8). Real code: CLC first
        ADC #&2C          ; + low byte of 300 (&012C) = &114: A=&14, C=1
        STA sum           ; STA leaves C alone
        LDA #&03          ; high byte of 1000. LDA leaves C alone too
        ADC #&01          ; &03 + &01 + carry 1 = &05. C=0
        STA sum+1         ; sum = 14 05: &0514 = 1300
        LDA #&50          ; +80
        ADC #&50          ; +80 + +80 = +160 won't fit: A=&A0 (-96), V=1, C=0
        LDA #&D0          ; -48
        ADC #&90          ; -48 + -112 = -160 won't fit: A=&60 (+96), V=1, C=1
        LDA sum           ; C=1 now, which SBC needs for "no borrow"
        SBC #&E8          ; &14 - &E8 goes below 0: A=&2C, C=0 (borrowed)
        STA diff
        LDA sum+1
        SBC #&03          ; &05 - &03 - borrow 1 = &01. C=1
        STA diff+1        ; diff = 2C 01: &012C = 300 again
        NOP               ; then the NOP slide, and BRK at &0500 stops it
`;

const ARITHMETIC_EXAMPLE: Example = { id: 'arithmetic', title: 'Stage 10: binary arithmetic', source: ARITHMETIC_SOURCE };

export const EXAMPLES: readonly Example[] = [
  ARITHMETIC_EXAMPLE,
  INCDEC_EXAMPLE,
  LABELS_EXAMPLE,
  { id: 'stores', title: 'Stage 07: stores & transfers', source: sourceFromListing('Stage 07: copy "HELLO" from row 0 to row 1 of the Mode 7 screen.', STORES_PROGRAM) },
  { id: 'loads', title: 'Stage 06: loads', source: sourceFromListing('Stage 06: eleven loads, one mode or flag result each.', LOADS_PROGRAM) },
];

/** The example with this id, or the current stage's if there's none. */
export function findExample(id: string | null): Example {
  return EXAMPLES.find((example) => example.id === id) ?? ARITHMETIC_EXAMPLE;
}
