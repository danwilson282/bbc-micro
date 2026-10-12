// Stage 31 demo: the SAA5050's character ROM, as we transcribed it.
//
//   npm run demo:font              all 96 characters, 8 to a line, as on the data sheet
//   npm run demo:font -- A £ &7F   just these (a character, or a code in &hex)
//
// Each character is its 5 × 9 dot matrix (data sheet Fig. 11) with the
// cell's gap column and gap line around it. Lay it next to the data sheet
// to check the transcription.

import { GLYPH_ROWS, glyphPicture, glyphRow, teletextCharacter } from '../src/video/saa5050-font';
import { hex8 } from '../src/util/bits';

const DOT = '█';
const GAP = '·';

/** A code from "&7F", "0x7f" or a single character (£ is &23 on the SAA5050). */
function parseCode(arg: string): number | undefined {
  const hex = /^(?:&|0x)([0-9a-f]{1,2})$/i.exec(arg);
  if (hex?.[1] !== undefined) return parseInt(hex[1], 16);
  if (arg.length !== 1) return undefined;
  for (let code = 0x20; code < 0x80; code++) if (teletextCharacter(code) === arg) return code;
  return undefined;
}

function show(codes: readonly number[]): void {
  console.log(codes.map((c) => `&${hex8(c)} ${teletextCharacter(c)}  `.padEnd(9)).join(' '));
  // Cell line 0 is the gap, then the 9 matrix lines; column 0 is the gap.
  for (let line = -1; line < GLYPH_ROWS; line++) {
    const cells = codes.map((code) => {
      const picture = line < 0 ? '.....' : (glyphPicture(code)[line] ?? '.....');
      return (GAP + picture.replace(/\./g, ' ').replace(/#/g, DOT)).replace(/ /g, line < 0 ? GAP : ' ').padEnd(9);
    });
    console.log(cells.join(' '));
  }
  console.log();
}

const args = process.argv.slice(2);
if (args.length > 0) {
  const codes: number[] = [];
  for (const arg of args) {
    const code = parseCode(arg);
    if (code === undefined) console.log(`(skipping "${arg}": not a teletext character or &hex code)`);
    else codes.push(code);
  }
  show(codes);
  for (const code of codes) {
    const rows = Array.from({ length: GLYPH_ROWS }, (_, line) => `&${hex8(glyphRow(code, line))}`);
    console.log(`&${hex8(code)} ${teletextCharacter(code)}: ${rows.join(' ')}   (bit 4 = leftmost dot)`);
  }
} else {
  console.log('SAA5050 character set (English), from the data sheet Fig. 11. · marks the gap column and line.\n');
  for (let base = 0x20; base < 0x80; base += 8) show(Array.from({ length: 8 }, (_, i) => base + i));
}
