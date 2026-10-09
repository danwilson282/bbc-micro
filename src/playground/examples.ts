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

/**
 * Stage 14: the first real loops. Fills the 1K of Mode 7 screen memory with
 * "A", waits about 1/6 second in a count-down loop, then "B", and so on to
 * "Z". A compare (CPX, CMP) and branches (BNE, BCC) decide every step. Ends
 * on a BRK, which is where Run stops.
 */
export const FILL_SOURCE = `; Stage 14: compare & branch. The first real loops.
; Fills Mode 7 screen memory (&7C00-&7FFF) with "A", waits, then "B" ... "Z".
; Type 7C00 in the Memory panel's Go box, then press Run and watch the bytes
; and the cycle counter. About 8.8 million cycles: 4.4 seconds on a real BBC.

ptr     = &80             ; zero-page pointer to the page being filled: &80/&81
char    = &82             ; the character to fill with

        *= &0400
start:  LDA #&41          ; "A"
        STA char
        LDA #&00
        STA ptr           ; the pointer's low byte stays &00 all the way
pass:   LDA #&7C
        STA ptr+1         ; ptr = &7C00, the first page of the screen
        LDY #0
        LDA char
fill:   STA (ptr),Y       ; 6 cycles
        INY               ; 2
        BNE fill          ; 3 while Y hasn't wrapped to 0: 256 bytes a page
        INC ptr+1         ; on to the next page
        LDX ptr+1
        CPX #&80          ; past the end of the screen? C=1 once X >= &80
        BCC fill          ; C=0, X < &80: fill this page too (Y is 0 again)
        LDX #0            ; wait: count Y down 256 times, 256 times over
wait:   DEY               ; Y is 0, so the first DEY gives &FF
        BNE wait          ; 256 x 5 cycles round this little loop ...
        DEX
        BNE wait          ; ... 256 times: about 329,000 cycles, 1/6 second
next:   CLC               ; at last, a CLC before an ADC
        LDA char
        ADC #1
        STA char          ; next character
        CMP #&5B          ; past "Z" (&5A)? Z=1 when char = &5B
        BNE pass          ; not yet: fill the screen again
done:   BRK               ; Run stops here (BRK itself is Stage 17)
`;

const FILL_EXAMPLE: Example = { id: 'fill', title: 'Stage 14: compare & branch (Run me)', source: FILL_SOURCE };

/**
 * Stage 15: jumps & the stack. Pushes and pulls in the Stack panel, PHP's
 * extra bits, setting V through PLP, a JMP over a BRK, the JMP (&10FF)
 * page-boundary bug, and the stack wrapping round page 1.
 */
export const STACK_SOURCE = `; Stage 15: jumps & the stack. Step it and watch the Stack panel.
; Pushes go down from &01FF; pulls come back up. Last in, first out.

        *= &0400
start:  LDX #&FF
        TXS               ; S=&FF: an empty stack. The MOS does this at reset
        LDA #&11
        PHA               ; &01FF = &11, S=&FE
        LDA #&22
        PHA               ; &01FE = &22, S=&FD
        LDA #&33
        PHA               ; &01FD = &33, S=&FC. Three bytes in use
        PLA               ; A=&33: the last one in comes out first. S=&FD
        PLA               ; A=&22, S=&FE
        PLA               ; A=&11, S=&FF. Empty, but the bytes are still there
        SEC
        SED               ; C=1, D=1 (and I=1 from reset)
        PHP               ; pushes &3D = %0011 1101: bits 5 and 4 (B) come out as 1
        CLC
        CLD               ; C=0, D=0
        PLP               ; pulls &3D: C=1 and D=1 again. Bits 5 and 4 go nowhere
        LDA #&C0          ; %1100 0000
        PHA
        PLP               ; P = &C0: N=1, V=1 (there's no SEV), and I=0, D=0, C=0
        JMP over          ; JMP absolute: PC = over. 3 cycles
        BRK               ; jumped over: Run would stop here if JMP didn't work
over:   LDA #&80
        STA &10FF         ; a pointer at the very end of page &10: low byte &80
        LDA #&04
        STA &1000         ; the high byte the NMOS 6502 actually reads
        LDA #&05
        STA &1100         ; the high byte you'd expect it to read
        JMP (&10FF)       ; the bug: PC = &0480, not &0580

        *= &0480
bug:    LDX #&00          ; you're here because of the bug
        TXS               ; S=&00: only one free byte left
        LDA #&AA
        PHA               ; writes &0100, and S wraps to &FF
        PHA               ; writes &01FF: the &11 from the start is overwritten
        BRK               ; Run stops here
`;

const STACK_EXAMPLE: Example = { id: 'stack', title: 'Stage 15: jumps & the stack', source: STACK_SOURCE };

/**
 * Stage 16: subroutines. A shift-and-add multiply called three times, once
 * from inside square, so two return addresses are on the stack at once.
 */
export const SUBROUTINES_SOURCE = `; Stage 16: subroutines. JSR pushes a return address, RTS pulls it back.
; Step it and watch the Stack panel: each JSR adds two bytes, each RTS
; takes them away. square calls multiply, so for a while there are four.

mcand   = &80             ; multiply's scratch: the multiplicand
mplier  = &81             ; the multiplier, shifted out one bit at a time
lowbyte = &82             ; the product's low byte, built up by ROR
results = &90             ; three 16-bit answers, low byte first

        *= &0400
start:  LDX #&FF
        TXS               ; an empty stack, so the return addresses are easy to spot
        LDA #13
        LDX #11
        JSR multiply      ; pushes &0409, the JSR's last byte. 13 x 11 = 143 = &008F
        STA results       ; RTS comes back here, to &0409 + 1
        STX results+1
        LDA #12
        JSR square        ; 12 x 12 = 144 = &0090, two calls deep
        STA results+2
        STX results+3
        LDA #200
        LDX #150
        JSR multiply      ; 200 x 150 = 30000 = &7530
        STA results+4
        STX results+5
        BRK               ; Run stops here. The answers are at &90-&95

; square: A x A.  In: A.  Out: A = low byte, X = high byte.  Uses &80-&82 and Y.
square: TAX               ; multiply wants its second number in X
        JSR multiply      ; a call inside a call: the stack now holds two return addresses
        RTS               ; (JMP multiply would do the same job, faster)

; multiply: A x X, 8 bits x 8 bits = 16 bits, by shifting and adding.
; In: A, X.  Out: A = low byte, X = high byte.  Uses &80-&82 and Y.
multiply:
        STA mcand
        STX mplier
        LDA #0            ; the product's high byte builds up in A
        LDY #8            ; one round per bit of the multiplier
next:   LSR mplier        ; the multiplier's next bit, lowest first, into C
        BCC noadd         ; a 0 bit adds nothing
        CLC
        ADC mcand         ; a 1 bit adds the multiplicand to the high byte
noadd:  ROR A             ; shift the 16-bit product right one place:
        ROR lowbyte       ; A's bit 0 drops into the low byte's bit 7
        DEY
        BNE next
        TAX               ; the high byte to X
        LDA lowbyte       ; the low byte to A
        RTS               ; back to whoever called: the address is on the stack
`;

const SUBROUTINES_EXAMPLE: Example = { id: 'subroutines', title: 'Stage 16: subroutines', source: SUBROUTINES_SOURCE };

/**
 * Stage 17: interrupts. An endless main loop, with IRQ, NMI and BRK handlers
 * that each count. The IRQ handler tells BRK from IRQ by the B bit in the
 * pushed P, and answers the playground's doorbell so it lets go of IRQ.
 */
export const INTERRUPTS_SOURCE = `; Stage 17: interrupts. Press Run: it stops at the BRK, like a breakpoint.
; Press Run again to go through it, then press IRQ and NMI in the
; Interrupts panel. Each handler adds 1 to its own counter. Type 0080 in
; the Memory panel's Go box to watch them:
;   &80 = IRQs   &81 = NMIs   &82 = BRKs   &84/&85 = the main loop's count

doorbell = &FC00          ; the playground's IRQ device. Write to it to answer it
irqs    = &80
nmis    = &81
brks    = &82
main    = &84             ; 16 bits, low byte first

        *= &0400
start:  LDX #&FF
        TXS
        CLI               ; reset left I set: let IRQs in from now on
        BRK               ; a software interrupt: IRQ's vector, but B = 1
        .byte &42         ; the padding byte BRK skips (the BBC puts an error number here)
idle:   INC main          ; the main program: count, for ever
        BNE idle
        INC main+1
        JMP idle

; IRQ and BRK both arrive here, through &FFFE.
irq:    PHA               ; save A and X: the interrupted code mustn't notice
        TXA
        PHA
        TSX               ; X = S. Now &0101,X = the saved X, &0102,X = A,
        LDA &0103,X       ; and &0103,X = the P that was pushed
        AND #&10          ; B: 1 if BRK pushed it, 0 for a real IRQ
        BNE isbrk
        STA doorbell      ; answer the doorbell, so it lets go of IRQ.
                          ; Delete this line and press IRQ: the handler runs for ever
        INC irqs
        JMP done
isbrk:  INC brks
done:   PLA               ; put X and A back, in reverse order
        TAX
        PLA
        RTI               ; pulls P (so I = 0 again) and PC: back to what was interrupted

; NMI has a vector to itself, so there's no one to ask "who called?".
nmi:    INC nmis          ; changes N and Z, but RTI puts the old P back
        RTI

        *= &FFFA          ; the vectors, at the very top of memory
        .word nmi         ; &FFFA: NMI
        .word start       ; &FFFC: RESET
        .word irq         ; &FFFE: IRQ and BRK
`;

const INTERRUPTS_EXAMPLE: Example = { id: 'interrupts', title: 'Stage 17: interrupts (Run, then press IRQ / NMI)', source: INTERRUPTS_SOURCE };

/**
 * Stage 18: disassembler & trace. Two ways to make the disassembly (memory
 * now) and the trace (what ran) disagree: one run of bytes with two entry
 * points (the &2C "BIT skip"), and a loop that rewrites its own STA operand.
 */
export const TRACE_SOURCE = `; Stage 18: disassembler & trace. The Disassembly panel decodes MEMORY;
; the Program panel shows this SOURCE. Step it and watch them disagree:
;  - "one" and "two" share bytes: the &2C hides LDA #2 inside a BIT.
;  - the loop rewrites its own STA, so the listing goes out of date.
; npm run demo:trace prints the whole run as a trace.

screen  = &7C28           ; Mode 7, row 1
result  = &80

        *= &0400
start:  LDX #&FF
        TXS
        JSR one           ; result = 1
        JSR two           ; result = 2
        LDA #&2A          ; "*"
        LDY #4
store:  STA screen        ; 8D 28 7C, but not for long:
        INC store+1       ; self-modifying code. Next time round it's STA &7C29
        DEY
        BNE store
        BRK               ; Run stops here, like a breakpoint

; Two entry points into one run of bytes. Enter at "one" and the &2C makes
; the next two bytes (A9 02, "LDA #2") the operand of a BIT &02A9, which only
; reads &02A9 and sets flags. Enter at "two" and they're an LDA again.
one:    LDA #1
        .byte &2C         ; BIT &nnnn: swallows the next two bytes
two:    LDA #2
        STA result
        RTS
`;

const TRACE_EXAMPLE: Example = { id: 'trace', title: 'Stage 18: disassembler & trace', source: TRACE_SOURCE };

/**
 * Stage 21: the BBC memory map. Each part of the map answers differently:
 * RAM keeps a write, ROM loses it, SHEILA's chips (placeholders for now)
 * see register numbers, and empty addresses return the floating bus.
 */
export const MEMORY_MAP_SOURCE = `; Stage 21: the BBC memory map. Press Run (it stops at the BRK), then
; read the Memory map panel's I/O log, and the results at &80-&84:
;   &80  &48  RAM kept what was written
;   &81  &00  the MOS ROM didn't: a ROM has no write line
;   &82  &FE  System VIA reg 4 is a placeholder, so the bus floats:
;             the last byte on it was &FE, from fetching "LDA &FE44"
;   &83  &FD  JIM: nothing connected, so &FD, the same way
;   &84  &80  the sideways ROM socket is empty (until Stage 22)

result  = &80

        *= &0400
start:  LDA #&48
        STA &3000         ; RAM
        LDA #0            ; forget it...
        LDA &3000         ; ...and read it back
        STA result
        LDA #&48
        STA &C000         ; MOS ROM: the write is lost
        LDA &C000
        STA result+1
        LDA #&7F
        STA &FE4E         ; System VIA reg 14 (IER)
        STA &FE5E         ; the same register again, through its mirror
        LDA &FE44         ; System VIA reg 4 (T1C-L)
        STA result+2
        LDA &FD00         ; JIM
        STA result+3
        LDA &8000         ; the empty sideways socket
        STA result+4
        LDA #&0C
        STA &FE30         ; ROMSEL: "page in ROM 12" (Stage 22 makes it work)
        LDA #&0D
        STA &FE00         ; CRTC: select register 13...
        LDA #&00
        STA &FE01         ; ...and write it
        BRK               ; Run stops here
`;

const MEMORY_MAP_EXAMPLE: Example = { id: 'memory-map', title: 'Stage 21: the BBC memory map (Run me)', source: MEMORY_MAP_SOURCE };

export const EXAMPLES: readonly Example[] = [
  MEMORY_MAP_EXAMPLE,
  TRACE_EXAMPLE,
  INTERRUPTS_EXAMPLE,
  SUBROUTINES_EXAMPLE,
  STACK_EXAMPLE,
  FILL_EXAMPLE,
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
  return EXAMPLES.find((example) => example.id === id) ?? MEMORY_MAP_EXAMPLE;
}
