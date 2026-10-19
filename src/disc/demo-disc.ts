// The Stage 51 demo disc: real software, made by our own tools.
//
//   !BOOT   EXEC file (boot option 3): CHAIN "DEMO"
//   DEMO    BASIC, tokenised by src/basic/tokenise.ts: MODE 2 colour bands
//           and a title, then the palette cycles until Escape
//   GREET   BASIC: prints in MODE 7, for the CHAIN test
//   HELLO   machine code from our assembler (Stage 48's): *RUN HELLO
//
// SHIFT-BREAK it and it boots. Every byte comes from code in this repo: the
// DFS writer (Stage 48), the assembler (Stage 08) and the tokeniser (Stage 51).

import { tokeniseProgram } from '../basic/tokenise';
import { buildDfsImage, type NewDfsSide } from './dfs-disc';
import { HELLO_ADDRESS, helloProgram } from './test-disc';

/**
 * BASIC's PAGE with DFS: CHAIN loads a program here, whatever its catalogue
 * entry says. &FFFF.... means the BBC itself (the I/O processor).
 */
export const BASIC_LOAD_ADDRESS = 0xffff_1900;
/** What BASIC II puts as a SAVEd program's execution address (seen in Stage 51). */
export const BASIC_EXEC_ADDRESS = 0xffff_8023;

/** MODE 2 bands in colours 1-6 and a white title; then the bands' colours turn until Escape. */
export const DEMO_SOURCE = `10 REM DEMO: BOOTED FROM THE STAGE 51 DISC
20 MODE 2
30 VDU 23,1,0;0;0;0;
40 FOR C%=1 TO 6
50 GCOL 0,C%
60 Y%=C%*112
70 MOVE 0,Y%:MOVE 1279,Y%:PLOT 85,0,Y%+100:PLOT 85,1279,Y%+100
80 NEXT
90 COLOUR 7
100 PRINT TAB(2,1)"BOOTED FROM DISC"
110 PRINT TAB(6,3)"STAGE 51"
120 T%=0
130 REPEAT
140 FOR C%=1 TO 6:VDU 19,C%,(C%+T%) MOD 6+1,0,0,0:NEXT
150 T%=T%+1
160 W%=TIME:REPEAT UNTIL TIME>W%+8
170 UNTIL FALSE
`;

/** Prints in MODE 7, so a test can read the screen. */
export const GREET_SOURCE = `10 REM GREET: CHAIN "GREET"
20 PRINT "HELLO FROM BASIC ON DISC"
30 FOR I%=1 TO 3
40 PRINT I%;" TIMES 7 IS ";I%*7
50 NEXT
`;

/**
 * What GREET prints, line by line. A number that starts a PRINT is
 * right-justified in BASIC's default 10-character field (@% = &90A); after
 * a ; it isn't.
 */
export const GREET_OUTPUT: readonly string[] = [
  'HELLO FROM BASIC ON DISC',
  '         1 TIMES 7 IS 7',
  '         2 TIMES 7 IS 14',
  '         3 TIMES 7 IS 21',
];

const text = (s: string): Uint8Array => Uint8Array.from(s.replaceAll('\n', '\r'), (c) => c.charCodeAt(0) & 0x7f);

export function demoDiscSide(): NewDfsSide {
  return {
    title: 'STAGE 51',
    bootOption: 3, // EXEC: SHIFT-BREAK types !BOOT in
    tracks: 80,
    files: [
      { name: '!BOOT', load: 0, exec: 0, data: text('CHAIN "DEMO"\n') },
      { name: 'DEMO', load: BASIC_LOAD_ADDRESS, exec: BASIC_EXEC_ADDRESS, data: tokeniseProgram(DEMO_SOURCE) },
      { name: 'GREET', load: BASIC_LOAD_ADDRESS, exec: BASIC_EXEC_ADDRESS, data: tokeniseProgram(GREET_SOURCE) },
      { name: 'HELLO', load: HELLO_ADDRESS, exec: HELLO_ADDRESS, data: helloProgram(), locked: true },
    ],
  };
}

/** The demo disc as an 80-track .ssd: 204,800 bytes, with room to SAVE. */
export function buildDemoDisc(): Uint8Array {
  return buildDfsImage('ssd', [demoDiscSide()]);
}

/** An empty, formatted 80-track DFS disc, to SAVE onto. */
export function buildBlankDisc(title = 'BLANK'): Uint8Array {
  return buildDfsImage('ssd', [{ title, bootOption: 0, tracks: 80, files: [] }]);
}
