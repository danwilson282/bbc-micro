// The Stage 06 playground program: eleven loads at &0400, hand-assembled from
// the opcode table (MCS6500 Programming Manual, Appendix B).
//
// It expects the Stage 05 playground set-up: "HELLO, BBC MICRO" at &7C00
// (Mode 7 screen memory) and a pointer to &7C00 at &70/&71. Each line shows a
// different mode, or a different way N and Z come out.

import type { ListingLine } from './listing';

export const LOADS_PROGRAM_START = 0x0400;

export const LOADS_PROGRAM: readonly ListingLine[] = [
  { address: 0x0400, bytes: [0xa9, 0x00], source: 'LDA #&00', comment: 'A=&00: Z=1 (zero), N=0' },
  { address: 0x0402, bytes: [0xa9, 0x80], source: 'LDA #&80', comment: 'A=&80: N=1 (bit 7 set), Z=0' },
  { address: 0x0404, bytes: [0xa9, 0x41], source: 'LDA #&41', comment: 'A=&41 "A": N=0, Z=0' },
  { address: 0x0406, bytes: [0xa2, 0x07], source: 'LDX #&07', comment: 'X=&07, ready to index' },
  { address: 0x0408, bytes: [0xbd, 0x00, 0x7c], source: 'LDA &7C00,X', comment: '&7C07 holds "B" (&42): 4 cycles' },
  { address: 0x040b, bytes: [0xa0, 0xf8], source: 'LDY #&F8', comment: 'Y=&F8: N=1, it\'s ≥ &80' },
  { address: 0x040d, bytes: [0xb9, 0x08, 0x7b], source: 'LDA &7B08,Y', comment: '&7B08+&F8 = &7C00 "H": page crossed, 5 cycles' },
  { address: 0x0410, bytes: [0xa0, 0x04], source: 'LDY #&04', comment: 'Y=&04' },
  { address: 0x0412, bytes: [0xb1, 0x70], source: 'LDA (&70),Y', comment: 'pointer &7C00 + 4 = &7C04 "O" (&4F)' },
  { address: 0x0414, bytes: [0xa6, 0x70], source: 'LDX &70', comment: 'X=&00 (pointer low byte): Z=1' },
  { address: 0x0416, bytes: [0xac, 0x01, 0x7c], source: 'LDY &7C01', comment: 'Y=&45 "E", A and X unchanged' },
];
