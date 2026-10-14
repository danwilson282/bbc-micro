// Stage 32 demo: teletext's serial attributes, cell by cell.
//
//   npm run demo:teletext            the test page in colour, then a trace of rows 6 and 23
//   npm run demo:teletext -- 19 22   trace these rows of the test page instead
//
// The preview is one terminal character per cell, in 24-bit ANSI colour,
// with mosaics as Unicode block sextants (your terminal font needs them:
// Unicode 13, "Symbols for Legacy Computing"). The trace shows what
// decodeCell did with each byte: the state before, what the cell drew as,
// and what changed after.

import { hex8 } from '../src/util/bits';
import { TELETEXT, createTeletextCell, createTeletextState, decodeCell, teletextCellText } from '../src/video/teletext-attributes';
import { TEST_PAGE_ROWS } from '../src/video/teletext-test-page';

const COLOUR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
const CODE_NAMES = new Map<number, string>(Object.entries(TELETEXT).map(([name, code]) => [code, name.toLowerCase().replace(/_/g, ' ')]));

function rgb(colour: number): string {
  return `${String(colour & 1 ? 255 : 0)};${String(colour & 2 ? 255 : 0)};${String(colour & 4 ? 255 : 0)}`;
}

function preview(): void {
  console.log('The Stage 32 test page, one character per cell:\n');
  TEST_PAGE_ROWS.forEach((bytes, row) => {
    const state = createTeletextState();
    const cell = createTeletextCell();
    let line = '';
    for (const byte of bytes) {
      decodeCell(state, byte, cell);
      line += `\x1b[38;2;${rgb(cell.foreground)}m\x1b[48;2;${rgb(cell.background)}m${teletextCellText(cell)}`;
    }
    console.log(`${String(row).padStart(2)} ${line}\x1b[0m`);
  });
  console.log();
}

function describeState(s: { foreground: number; background: number; graphics: boolean; separated: boolean; hold: boolean }): string {
  return `${s.graphics ? 'gfx' : 'txt'} ${COLOUR_NAMES[s.foreground] ?? '?'}/${COLOUR_NAMES[s.background] ?? '?'}${s.separated ? ' sep' : ''}${s.hold ? ' hold' : ''}`;
}

function trace(row: number): void {
  if (row < 0 || row >= TEST_PAGE_ROWS.length) {
    console.log(`(no row ${String(row)}: the page has rows 0-24)`);
    return;
  }
  const bytes = TEST_PAGE_ROWS[row];
  console.log(`Row ${String(row)}, cell by cell (stops at the first trailing space):`);
  console.log('cell byte  code (as text)        state before                 draws as                         state after');
  const state = createTeletextState();
  const cell = createTeletextCell();
  const last = bytes.reduce((end, byte, i) => (byte !== 0x20 ? i : end), 0);
  for (let i = 0; i <= last; i++) {
    const byte = bytes[i] ?? 0x20;
    const before = describeState(state);
    decodeCell(state, byte, cell);
    const code = byte & 0x7f;
    const name = code < 0x20 ? (CODE_NAMES.get(code) ?? '?') : `'${teletextCellText({ ...cell, kind: 'letter', code })}'`;
    const shows = `${cell.kind}${cell.kind === 'blank' ? '' : ` &${hex8(cell.code)} ${teletextCellText(cell)}`}${cell.separated ? ' sep' : ''} in ${COLOUR_NAMES[cell.foreground] ?? '?'}/${COLOUR_NAMES[cell.background] ?? '?'}`;
    const after = describeState(state);
    console.log(`${String(i).padStart(4)}  &${hex8(byte)}  ${name.padEnd(20)} ${before.padEnd(28)} ${shows.padEnd(32)} ${after === before ? '' : after}`);
  }
  console.log();
}

const rows = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n));
if (rows.length === 0) preview();
for (const row of rows.length > 0 ? rows : [6, 23]) trace(row);
