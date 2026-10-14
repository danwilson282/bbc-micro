// Stage 32-33 demo: teletext's serial attributes, cell by cell.
//
//   npm run demo:teletext                 test page 1 in colour, then a trace of rows 6 and 23
//   npm run demo:teletext -- 19 22        trace these rows of page 1 instead
//   npm run demo:teletext -- --page 2     page 2 (Stage 33): double height, flash, conceal
//   npm run demo:teletext -- --page 2 9 10   trace a double-height pair
//
// Flashing cells blink (ANSI blink: most terminals honour it). A terminal
// can't draw half a character, so double-height cells show their
// character on both rows, marked by the trace's "top"/"bottom".
//
// The preview is one terminal character per cell, in 24-bit ANSI colour,
// with mosaics as Unicode block sextants (your terminal font needs them:
// Unicode 13, "Symbols for Legacy Computing"). The trace shows what
// decodeCell did with each byte: the state before, what the cell drew as,
// and what changed after.

import { hex8 } from '../src/util/bits';
import { TELETEXT, type TeletextState, createTeletextCell, createTeletextState, decodeCell, startRow, teletextCellText } from '../src/video/teletext-attributes';
import { TEST_PAGES } from '../src/video/teletext-test-page';

const COLOUR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
const CODE_NAMES = new Map<number, string>(Object.entries(TELETEXT).map(([name, code]) => [code, name.toLowerCase().replace(/_/g, ' ')]));

function rgb(colour: number): string {
  return `${String(colour & 1 ? 255 : 0)};${String(colour & 2 ? 255 : 0)};${String(colour & 4 ? 255 : 0)}`;
}

const args = process.argv.slice(2);
const pageFlag = args.indexOf('--page');
const pageNumber = pageFlag >= 0 ? Number(args[pageFlag + 1]) : 1;
if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > TEST_PAGES.length) throw new Error(`There are test pages 1-${String(TEST_PAGES.length)}`);
const pageRows = TEST_PAGES[pageNumber - 1] ?? [];
const rowArgs = args.filter((_, i) => i !== pageFlag && i !== pageFlag + 1);

function preview(): void {
  console.log(`Test page ${String(pageNumber)}, one character per cell:\n`);
  // One state down the whole page, so double-height pairs work (Stage 33).
  const state = createTeletextState();
  const cell = createTeletextCell();
  pageRows.forEach((bytes, row) => {
    startRow(state);
    let line = '';
    for (const byte of bytes) {
      decodeCell(state, byte, cell);
      const blink = cell.flash && cell.kind !== 'blank' ? '\x1b[5m' : '\x1b[25m';
      line += `${blink}\x1b[38;2;${rgb(cell.foreground)}m\x1b[48;2;${rgb(cell.background)}m${teletextCellText(cell)}`;
    }
    console.log(`${String(row).padStart(2)} ${line}\x1b[0m${state.bottomRow ? '  (bottom row)' : ''}`);
  });
  console.log();
}

function describeState(s: TeletextState): string {
  const extras = [s.separated && 'sep', s.hold && 'hold', s.flash && 'flash', s.conceal && 'conceal', s.doubleHeight && 'dbl'].filter(Boolean).join(' ');
  return `${s.graphics ? 'gfx' : 'txt'} ${COLOUR_NAMES[s.foreground] ?? '?'}/${COLOUR_NAMES[s.background] ?? '?'}${extras ? ` ${extras}` : ''}`;
}

function trace(row: number): void {
  if (!Number.isInteger(row) || row < 0 || row >= pageRows.length) {
    console.log(`(no row ${String(row)}: the page has rows 0-24)`);
    return;
  }
  // Decode the rows above first, so the state knows whether this is a bottom row.
  const state = createTeletextState();
  const cell = createTeletextCell();
  for (let above = 0; above < row; above++) {
    startRow(state);
    for (const byte of pageRows[above] ?? []) decodeCell(state, byte, cell);
  }
  startRow(state);
  console.log(`Page ${String(pageNumber)}, row ${String(row)}${state.bottomRow ? ' (a bottom row: the row above had an &8D)' : ''}, cell by cell (stops at the first trailing space):`);
  console.log('cell byte  code (as text)        state before                 draws as                                state after');
  const bytes = pageRows[row] ?? [];
  const last = bytes.reduce((end, byte, i) => (byte !== 0x20 ? i : end), 0);
  for (let i = 0; i <= last; i++) {
    const byte = bytes[i] ?? 0x20;
    const before = describeState(state);
    decodeCell(state, byte, cell);
    const code = byte & 0x7f;
    const name = code < 0x20 ? (CODE_NAMES.get(code) ?? '?') : `'${teletextCellText({ ...cell, kind: 'letter', code })}'`;
    const visible = cell.kind !== 'blank';
    const shows = `${cell.kind}${visible ? ` &${hex8(cell.code)} ${teletextCellText(cell)}` : ''}${cell.separated ? ' sep' : ''}${visible && cell.height !== 'normal' ? ` ${cell.height}` : ''}${visible && cell.flash ? ' flash' : ''} in ${COLOUR_NAMES[cell.foreground] ?? '?'}/${COLOUR_NAMES[cell.background] ?? '?'}`;
    const after = describeState(state);
    console.log(`${String(i).padStart(4)}  &${hex8(byte)}  ${name.padEnd(20)} ${before.padEnd(28)} ${shows.padEnd(39)} ${after === before ? '' : after}`);
  }
  console.log();
}

const rows = rowArgs.map(Number).filter((n) => Number.isInteger(n));
if (rows.length === 0) preview();
for (const row of rows.length > 0 ? rows : pageNumber === 1 ? [6, 23] : [9, 10]) trace(row);
