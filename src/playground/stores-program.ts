// The Stage 07 playground program: copy "HELLO" from row 0 of the Mode 7
// screen (&7C00) to row 1 (&7C28), hand-assembled from the opcode table
// (MCS6500 Programming Manual, Appendix B).
//
// Each letter takes a different route through the registers, so the program
// uses all six transfers and five kinds of store. It starts by showing the
// TSX/TXS flag asymmetry, and ends by storing a byte over itself: a write
// that isn't a change.
//
// It expects the playground set-up (setup.ts): "HELLO, BBC MICRO" at &7C00
// and a pointer to &7C00 at &70/&71.

import type { ListingLine } from './listing';

export const STORES_PROGRAM_START = 0x0400;

export const STORES_PROGRAM: readonly ListingLine[] = [
  { address: 0x0400, bytes: [0xba], source: 'TSX', comment: 'X=&FD: reset left S at &FD. TSX sets N=1' },
  { address: 0x0401, bytes: [0xa2, 0xff], source: 'LDX #&FF', comment: 'X=&FF, ready for the stack' },
  { address: 0x0403, bytes: [0xa9, 0x00], source: 'LDA #&00', comment: 'A=&00: Z=1, N=0' },
  { address: 0x0405, bytes: [0x9a], source: 'TXS', comment: 'S=&FF. No flags: N stays 0 though &FF is negative' },
  { address: 0x0406, bytes: [0xad, 0x00, 0x7c], source: 'LDA &7C00', comment: 'A="H" (&48)' },
  { address: 0x0409, bytes: [0xaa], source: 'TAX', comment: 'X=&48: a copy, A still holds "H"' },
  { address: 0x040a, bytes: [0x8e, 0x28, 0x7c], source: 'STX &7C28', comment: 'writes "H" at &7C28, row 1 of Mode 7' },
  { address: 0x040d, bytes: [0xad, 0x01, 0x7c], source: 'LDA &7C01', comment: 'A="E" (&45)' },
  { address: 0x0410, bytes: [0xa8], source: 'TAY', comment: 'Y=&45: a copy of A' },
  { address: 0x0411, bytes: [0x8c, 0x29, 0x7c], source: 'STY &7C29', comment: 'writes "E" at &7C29' },
  { address: 0x0414, bytes: [0xae, 0x02, 0x7c], source: 'LDX &7C02', comment: 'X="L" (&4C)' },
  { address: 0x0417, bytes: [0x8a], source: 'TXA', comment: 'A=&4C: a copy of X' },
  { address: 0x0418, bytes: [0x8d, 0x2a, 0x7c], source: 'STA &7C2A', comment: 'writes "L" at &7C2A: 4 cycles' },
  { address: 0x041b, bytes: [0xa2, 0x03], source: 'LDX #&03', comment: 'X=&03' },
  { address: 0x041d, bytes: [0x9d, 0x28, 0x7c], source: 'STA &7C28,X', comment: 'writes "L" at &7C2B: 5 cycles, no page crossed' },
  { address: 0x0420, bytes: [0xac, 0x04, 0x7c], source: 'LDY &7C04', comment: 'Y="O" (&4F)' },
  { address: 0x0423, bytes: [0x98], source: 'TYA', comment: 'A=&4F: a copy of Y' },
  { address: 0x0424, bytes: [0xa0, 0x2c], source: 'LDY #&2C', comment: 'Y=&2C (44)' },
  { address: 0x0426, bytes: [0x91, 0x70], source: 'STA (&70),Y', comment: 'pointer &7C00 + &2C: writes "O" at &7C2C, 6 cycles' },
  { address: 0x0428, bytes: [0x8d, 0x04, 0x7c], source: 'STA &7C04', comment: '"O" over "O": written, but not changed' },
];
