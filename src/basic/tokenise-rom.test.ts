// The real BASIC II as referee: it tokenises the same programs, and what it
// keeps from PAGE to TOP must be what tokeniseProgram makes, byte for byte.
//
// The programs go in the way BBC users moved programs between machines: as
// text, *EXECed from a disc. EXEC feeds the file to BASIC as if typed, so
// BASIC's own tokeniser does the work. Skips without the three ROMs.

import { DEMO_SOURCE, GREET_SOURCE } from '../disc/demo-disc';
import { buildDfsImage } from '../disc/dfs-disc';
import { DiscImage } from '../disc/disc-image';
import { BbcModelB } from '../machine/bbc-model-b';
import { typeText } from '../machine/type-text';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { tokeniseProgram } from './tokenise';

const ALL = ['roms/os12.rom', 'roms/basic2.rom', 'roms/dfs.rom'] as const;

/** One line of each kind the unit tests cover, numbered 10, 20, 30... */
const CASES = [
  'PRINT "HI"',
  'GOTO 10',
  'X=TOP:TIME=0:A=TIME',
  'PROCPRINT:REM PRINT',
  'IF X THEN 1000 ELSE 300',
  'PRINTER=1',
  '*RUN HELLO',
  'A=&DEF',
  'DATA AND,OR',
  'X=FNAND',
  'DEFPROCOR',
  'LOMEM=X',
  'ON X GOTO 10,20',
  'RESTORE 100',
  'A%=1:B=A%AND3',
  'X=1:*CAT',
  'X=TIME2',
  'TIMEQ',
  'ENDPROCQ',
  'FOR I=1TO9',
  '  PRINT TAB(3)',
  'A_B=1',
  'THENX',
  'REPEAT TIME=1',
  'GOTO 32767',
  'print',
  'ON ERROR GOTO 10',
  'DELETE 10,20',
]
  .map((text, i) => `${String((i + 1) * 10)} ${text}\n`)
  .join('');

const text = (s: string): Uint8Array => Uint8Array.from(s.replaceAll('\n', '\r'), (c) => c.charCodeAt(0) & 0x7f);

/** What BASIC II keeps from PAGE to TOP after *EXECing `source` from a disc. Every line needs its CR, the last one too. */
function basicTokenises(source: string): number[] {
  const disc = buildDfsImage('ssd', [{ tracks: 40, files: [{ name: 'SRC', load: 0, exec: 0, data: text(source) }] }]);
  const m = new BbcModelB();
  loadStandardRoms(m.map);
  m.insertDisc(0, DiscImage.fromBytes(disc, 'ssd', 'src.ssd'));
  m.powerOn();
  for (let i = 0; i < 100; i++) m.runFrame();
  typeText(m, '*EXEC SRC\r');
  for (let i = 0; i < 100; i++) m.runFrame();
  const page = m.peek(0x18) << 8; // BASIC's PAGE high byte
  const top = m.peek(0x12) | (m.peek(0x13) << 8); // TOP
  return Array.from({ length: top - page }, (_, i) => m.peek(page + i));
}

describe('our tokeniser makes what BASIC II makes', () => {
  withRoms(...ALL)('for one line of every kind in the unit tests', () => {
    expect(basicTokenises(CASES)).toEqual(Array.from(tokeniseProgram(CASES)));
  });

  withRoms(...ALL)('for the demo disc\'s DEMO', () => {
    expect(basicTokenises(DEMO_SOURCE)).toEqual(Array.from(tokeniseProgram(DEMO_SOURCE)));
  });

  withRoms(...ALL)('for the demo disc\'s GREET', () => {
    expect(basicTokenises(GREET_SOURCE)).toEqual(Array.from(tokeniseProgram(GREET_SOURCE)));
  });
});
