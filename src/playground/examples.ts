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

/**
 * Stage 11: decimal mode. A four-digit BCD score goes up by 10 and down by 6,
 * with the carry and borrow handing off between its two bytes, and two ADCs
 * show the NMOS Z quirk both ways round. Still no CLC/SEC (Stage 14), so each
 * ADC/SBC is placed where C is already what it needs.
 */
export const DECIMAL_SOURCE = `; Stage 11: decimal mode. With D set, ADC and SBC count in BCD:
; each hex digit is a decimal digit, so A never shows A-F.
; Watch C carry hundreds, and Z go wrong (both ways) after ADC.

score   = &80             ; 4 digits in 2 bytes, low byte first: &80/&81

        *= &0400
start:  SED               ; D=1: ADC and SBC now work in decimal
        LDA #&09
        ADC #&01          ; &09 + &01 = &10, not &0A. (C=0 after our reset)
        LDA #&95          ; the score is 0995: add 10 points
        ADC #&10          ; 95 + 10 = 105: A=&05, and C=1 carries the hundred
        STA score
        LDA #&09
        ADC #&00          ; 09 + 00 + carry 1 = &10. C=0
        STA score+1       ; score = 05 10, which reads as 1005
        LDA #&80
        ADC #&80          ; 80 + 80 = 160: A=&60, C=1. But Z=1! (binary &100)
        LDA score         ; now take 6 points off. C=1: no borrow in
        SBC #&06          ; 05 - 06 goes below 0: A=&99, C=0 (borrowed)
        STA score
        LDA score+1
        SBC #&00          ; 10 - 00 - borrow 1 = &09. C=1
        STA score+1       ; score = 99 09, which reads as 0999
        LDA #&98
        ADC #&01          ; 98 + 01 + carry 1 = 100: A=&00, C=1. But Z=0, N=1!
        CLD               ; D=0: binary again
        LDA #&10
        SBC #&01          ; &10 - &01 = &0F in binary (decimal would give &09)
        NOP               ; then the NOP slide, and BRK at &0500 stops it
`;

const DECIMAL_EXAMPLE: Example = { id: 'decimal', title: 'Stage 11: decimal mode', source: DECIMAL_SOURCE };

/**
 * Stage 12: logic & BIT. Masks on A (clear, set, toggle), the three ASCII
 * case tricks on "HELLO" at &7C00, then BIT tests that set N and V from
 * memory and leave A alone. Watch A's binary view in the Registers panel.
 */
export const LOGIC_SOURCE = `; Stage 12: logic & BIT. Watch A's bits in the Registers panel.
; AND clears bits, ORA sets them, EOR flips them. BIT only looks.

flags   = &80             ; a byte of status bits for BIT to test
screen  = &7C00           ; "HELLO, BBC MICRO" is here

        *= &0400
start:  LDA #&B5          ; A = %1011 0101
        AND #&0F          ; keep the low nibble:  %0000 0101 = &05
        ORA #&C0          ; set bits 7 and 6:     %1100 0101 = &C5. N=1
        EOR #&FF          ; flip all eight (NOT): %0011 1010 = &3A
        EOR #&FF          ; flip them back:       %1100 0101 = &C5
        AND #&30          ; no 1s in common:      %0000 0000. Z=1
        LDA screen        ; "H" = &48 = %0100 1000
        EOR #&20          ; flip bit 5: &68 = "h". Case swapped
        STA screen
        LDA screen+1      ; "E" = &45
        ORA #&20          ; set bit 5: &65 = "e". Forced lower case
        STA screen+1
        LDA screen        ; "h" = &68
        AND #&DF          ; clear bit 5 (%1101 1111): &48 = "H". Forced upper
        STA screen        ; the screen now says "HeLLO"
        LDA #&C1          ; %1100 0001: bits 7, 6 and 0
        STA flags
        LDA #&01          ; test bit 0
        BIT flags         ; &01 AND &C1 = &01: Z=0. N=1, V=1 from &C1. A=&01 still
        LDA #&02          ; test bit 1
        BIT flags         ; &02 AND &C1 = &00: Z=1. N and V still from &C1
        LDA #&FF          ; A is negative: N=1
        BIT screen+6      ; the space, &20 = %0010 0000: N=0 and V=0, from memory
        NOP               ; then the NOP slide, and BRK at &0500 stops it
`;

const LOGIC_EXAMPLE: Example = { id: 'logic', title: 'Stage 12: logic & BIT', source: LOGIC_SOURCE };

/**
 * Stage 13: shifts & rotates. 23 × 10 = 23 × 8 + 23 × 2 with ASL and one ADC,
 * halving with LSR (remainder in C), a memory ASL, a 16-bit doubling with
 * ASL/ROL, and one bit walked round the 9-bit C + A ring. Still no CLC
 * (Stage 14): the last ASL before the ADC leaves C=0.
 */
export const SHIFTS_SOURCE = `; Stage 13: shifts & rotates. Multiply by 10 with no multiply instruction:
; n * 10 = n * 8 + n * 2. Watch A's bits slide, and C catch the one that falls off.

num     = &80             ; the number to multiply (not "x": that's a register)
times2  = &81             ; num * 2, kept for the add
result  = &82             ; num * 10
word    = &84             ; a 16-bit number, low byte first: &84/&85

        *= &0400
start:  LDA #23           ; num = 23 = &17 = %0001 0111
        STA num
        ASL A             ; n * 2 = 46 = &2E. Old bit 7 (a 0) falls into C
        STA times2
        ASL A             ; n * 4 = 92 = &5C
        ASL A             ; n * 8 = 184 = &B8. C=0: nothing fell off the top
        ADC times2        ; n * 8 + n * 2 = 230 = &E6. That last ASL left C=0
        STA result        ; result = 230 = 23 * 10
        LSR A             ; halve: 115 = &73. Old bit 0 (a 0) falls into C
        LSR A             ; halve: 57 = &39, C=1. 115 was odd: the remainder is in C
        ASL num           ; on memory: num = 46. 5 cycles, 2 writes (watch the Wrote line)
        LDA #&C0
        STA word          ; word = &01C0 = 448
        LDA #&01
        STA word+1
        ASL word          ; low byte: &C0 -> &80. Bit 7 (a 1) falls into C
        ROL word+1        ; high byte: &01 -> &03. C comes in at bit 0. word = &0380 = 896
        LDA #&01          ; now walk one bit round the 9-bit ring of C and A
        LSR A             ; A = &00, C=1: the bit is in C. Z=1
        ROR A             ; A = &80, C=0: C came in at the top. N=1
        ROL A             ; A = &00, C=1: back out of the top into C
        ROL A             ; A = &01, C=0: and in at the bottom. Where it started
        NOP               ; then the NOP slide, and BRK at &0500 stops it
`;

const SHIFTS_EXAMPLE: Example = { id: 'shifts', title: 'Stage 13: shifts & rotates', source: SHIFTS_SOURCE };

export const EXAMPLES: readonly Example[] = [
  SHIFTS_EXAMPLE,
  LOGIC_EXAMPLE,
  DECIMAL_EXAMPLE,
  ARITHMETIC_EXAMPLE,
  INCDEC_EXAMPLE,
  LABELS_EXAMPLE,
  { id: 'stores', title: 'Stage 07: stores & transfers', source: sourceFromListing('Stage 07: copy "HELLO" from row 0 to row 1 of the Mode 7 screen.', STORES_PROGRAM) },
  { id: 'loads', title: 'Stage 06: loads', source: sourceFromListing('Stage 06: eleven loads, one mode or flag result each.', LOADS_PROGRAM) },
];

/** The example with this id, or the current stage's if there's none. */
export function findExample(id: string | null): Example {
  return EXAMPLES.find((example) => example.id === id) ?? SHIFTS_EXAMPLE;
}
