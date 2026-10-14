// Stage 33 demo: the SAA5050's character rounding.
//
//   npm run demo:rounding           A, V, Z and s side by side
//   npm run demo:rounding -- Hello  your own characters
//
// Each character is shown at half-dot, half-line resolution (12 × 20, our
// pixels): on the left as Stage 31 drew it (each dot a 2 × 2 square), on the
// right rounded. '█' is a dot in both, '▒' a half-dot that rounding added.
// Odd lines are the interlaced second field, where the half-dots go.

import { HALF_DOTS_PER_CELL, HALF_LINES_PER_CELL, doubleDots, roundedGlyphLine } from '../src/video/character-rounding';
import { glyphRow, teletextCharacter } from '../src/video/saa5050-font';

const text = process.argv[2] ?? 'AVZs';

/** Half-line h of the character drawn without rounding: both fields show matrix line (h / 2) - 1. */
function plainLine(code: number, h: number): number {
  const line = h >> 1;
  return line === 0 ? 0 : doubleDots(glyphRow(code, line - 1));
}

function picture(mask: number, plain: number): string {
  let out = '';
  for (let x = HALF_DOTS_PER_CELL - 1; x >= 0; x--) {
    const bit = 1 << x;
    out += (plain & bit) !== 0 ? '█' : (mask & bit) !== 0 ? '▒' : '·';
  }
  return out;
}

const codes = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i) & 0x7f).filter((code) => code >= 0x20);
console.log(codes.map((code) => `  ${teletextCharacter(code)}: plain`.padEnd(14) + '   rounded'.padEnd(15)).join('  '));
for (let h = 0; h < HALF_LINES_PER_CELL; h++) {
  const field = h % 2 === 0 ? 'f1' : 'f2';
  const cells = codes.map((code) => `${picture(plainLine(code, h), plainLine(code, h))}  ${picture(roundedGlyphLine(code, h), plainLine(code, h))}`);
  console.log(`${field} ${cells.join('    ')}`);
}
let added = 0;
for (const code of codes) {
  for (let h = 0; h < HALF_LINES_PER_CELL; h++) {
    let extra = roundedGlyphLine(code, h) & ~plainLine(code, h);
    while (extra) {
      added += extra & 1;
      extra >>= 1;
    }
  }
}
console.log(`\nRounding added ${String(added)} half-dots to ${String(codes.length)} characters, all on second-field (f2) lines.`);
