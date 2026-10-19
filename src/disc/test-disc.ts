// The Stage 48 test disc: a small DFS disc whose every byte we chose, for the
// demo, the tests, and (from Stage 50) for the real DFS ROM to read.
//
// It has one of everything the catalogue can say: a !BOOT with boot option 3
// (EXEC), a locked machine-code program assembled by our own assembler
// (Stage 08) with FF addresses, a text file, an empty file, and a file in
// another directory.

import { assemble, formatError } from '../asm/assembler';
import type { NewDfsSide } from './dfs-disc';
import { buildDfsImage } from './dfs-disc';

const MESSAGE = 'HELLO FROM DISC';

/** Prints MESSAGE through OSWRCH, then a new line, and returns. */
export const HELLO_SOURCE = `; $.HELLO on the Stage 48 test disc: *RUN HELLO prints a message.
oswrch  = &FFEE           ; MOS: write the character in A
osnewl  = &FFE7           ; MOS: write a new line

        *= &1900          ; DFS's PAGE: the first free byte with a DFS
start:  LDX #0
next:   LDA message,X
        BEQ done          ; a zero byte ends the message
        JSR oswrch
        INX
        BNE next
done:   JSR osnewl
        RTS
message: .byte ${Array.from(MESSAGE, (c) => `&${c.charCodeAt(0).toString(16).toUpperCase()}`).join(', ')}, 0  ; "${MESSAGE}"
`;

/** HELLO's load and execution address: &1900 in the BBC itself (&FFFF...). */
export const HELLO_ADDRESS = 0xffff_1900;

/** HELLO_SOURCE's bytes, from &1900 on. Throws if it doesn't assemble (a bug here, not a user error). */
export function helloProgram(): Uint8Array {
  const assembly = assemble(HELLO_SOURCE);
  if (!assembly.ok) throw new Error(`HELLO_SOURCE doesn't assemble: ${assembly.errors.map(formatError).join('; ')}`);
  return Uint8Array.from(assembly.lines.flatMap((line) => line.bytes));
}

/** BBC text files end their lines with CR (&0D). */
const text = (s: string): Uint8Array => Uint8Array.from(s.replaceAll('\n', '\r'), (c) => c.charCodeAt(0) & 0x7f);

/** The side's description: what buildDfsImage lays out. */
export function testDiscSide(): NewDfsSide {
  return {
    title: 'STAGE 48',
    bootOption: 3, // EXEC: SHIFT-BREAK types !BOOT in (Stage 51)
    tracks: 40,
    files: [
      { name: '!BOOT', load: 0, exec: 0, data: text('*RUN HELLO\n') },
      { name: 'HELLO', load: HELLO_ADDRESS, exec: HELLO_ADDRESS, data: helloProgram(), locked: true },
      { name: 'README', load: 0, exec: 0, data: text('This disc was made by the BBC Micro\nemulator\'s own DFS writer (Stage 48).\n') },
      { name: 'EMPTY', load: 0x3000, exec: 0x3000, data: new Uint8Array(0) },
      // 600 bytes: 3 sectors, the last one only partly used.
      { directory: 'E', name: 'DATA', load: 0x3000, exec: 0x3000, data: Uint8Array.from({ length: 600 }, (_, i) => i & 0xff) },
    ],
  };
}

/** The test disc as a 40-track .ssd, 102,400 bytes. */
export function buildTestDisc(): Uint8Array {
  return buildDfsImage('ssd', [testDiscSide()]);
}
