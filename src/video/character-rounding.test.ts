import { HALF_DOTS_PER_CELL, HALF_LINES_PER_CELL, doubleDots, roundLine, roundedGlyphLine } from './character-rounding';
import { glyphRow } from './saa5050-font';

/** A 6-dot mask from a picture like '..#...' (dot 0 on the left). */
function dots(picture: string): number {
  return parseInt(picture.replace(/\./g, '0').replace(/#/g, '1'), 2);
}

/** A 12-half-dot mask as a picture, half-dot 0 on the left. */
function halfDots(mask: number): string {
  return mask.toString(2).padStart(HALF_DOTS_PER_CELL, '0').replace(/0/g, '.').replace(/1/g, '#');
}

/** A character's 20 half-lines as pictures. */
function roundedPicture(code: number): string[] {
  return Array.from({ length: HALF_LINES_PER_CELL }, (_, h) => halfDots(roundedGlyphLine(code, h)));
}

describe('doubleDots: each 6 MHz dot is two half-dots', () => {
  test('dot 0 is half-dots 0-1, dot 5 is half-dots 10-11', () => {
    expect(halfDots(doubleDots(dots('#.....')))).toBe('##..........');
    expect(halfDots(doubleDots(dots('.....#')))).toBe('..........##');
    expect(halfDots(doubleDots(dots('.#.#.#')))).toBe('..##..##..##');
  });
});

describe('roundLine: the second-field line between matrix lines L and L + 1', () => {
  test('a diagonal going down-left adds the half-dot to the left of line L\'s dot', () => {
    // / : dot 4 on line L, dot 3 on line L + 1.
    expect(halfDots(roundLine(dots('....#.'), dots('...#..')))).toBe('.......###..');
  });

  test('a diagonal going down-right adds the half-dot to the right of line L\'s dot', () => {
    // \ : dot 1 on line L, dot 2 on line L + 1.
    expect(halfDots(roundLine(dots('.#....'), dots('..#...')))).toBe('..###.......');
  });

  test('a dot with diagonals both ways (the top of an A) gets a half-dot on each side', () => {
    expect(halfDots(roundLine(dots('...#..'), dots('..#.#.')))).toBe('.....####...');
  });

  test('no rounding where a corner is already filled: an L shape stays square', () => {
    // Line L has dots 1 and 2, line L + 1 has dot 1: the 2-to-1 step down-left is filled by line L's own dot 1.
    expect(halfDots(roundLine(dots('.##...'), dots('.#....')))).toBe('..####......');
    // Line L + 1 has dot 2 under line L's dot 2: no gap to fill.
    expect(halfDots(roundLine(dots('.#....'), dots('.##...')))).toBe('..##........');
  });

  test('vertical strokes and horizontal bars are unchanged', () => {
    expect(halfDots(roundLine(dots('.#...#'), dots('.#...#')))).toBe('..##......##');
    expect(halfDots(roundLine(dots('.#####'), dots('......')))).toBe('..##########');
  });
});

describe('roundedGlyphLine: the font at half-dot, half-line resolution', () => {
  test('a cell is 12 half-dots by 20 half-lines', () => {
    expect(HALF_DOTS_PER_CELL).toBe(12);
    expect(HALF_LINES_PER_CELL).toBe(20);
  });

  test('half-lines 0 and 1 are the gap line: always blank', () => {
    for (let code = 0x20; code < 0x80; code++) {
      expect(roundedGlyphLine(code, 0)).toBe(0);
      expect(roundedGlyphLine(code, 1)).toBe(0);
    }
  });

  test('even half-lines (the first field) are the font exactly, each dot doubled', () => {
    for (let code = 0x20; code < 0x80; code++) {
      for (let line = 0; line < 9; line++) expect(roundedGlyphLine(code, 2 * line + 2)).toBe(doubleDots(glyphRow(code, line)));
    }
  });

  test('odd half-lines (the second field) contain line L and only add to it', () => {
    for (let code = 0x20; code < 0x80; code++) {
      for (let line = 0; line < 9; line++) {
        const plain = doubleDots(glyphRow(code, line));
        expect(roundedGlyphLine(code, 2 * line + 3) & plain).toBe(plain);
      }
    }
  });

  test('the last matrix line has nothing below it, so its second-field line is plain', () => {
    expect(roundedGlyphLine(0x67, 19)).toBe(roundedGlyphLine(0x67, 18)); // g's descender
  });

  test('control codes have no shape', () => {
    for (let h = 0; h < 20; h++) expect(roundedGlyphLine(0x0d, h)).toBe(0);
  });

  test('A, rounded: its sloping sides step by half a dot each TV line', () => {
    expect(roundedPicture(0x41)).toEqual([
      '............',
      '............',
      '......##....', // ..#..
      '.....####...', //   rounded towards .#.#.
      '....##..##..', // .#.#.
      '...###..###.', //   rounded towards #...#
      '..##......##', // #...#
      '..##......##',
      '..##......##',
      '..##......##',
      '..##########',
      '..##########',
      '..##......##',
      '..##......##',
      '..##......##',
      '..##......##',
      '............',
      '............',
      '............',
      '............',
    ]);
  });

  test('bit 7 is ignored: &C1 rounds the same as &41', () => {
    for (let h = 0; h < 20; h++) expect(roundedGlyphLine(0xc1, h)).toBe(roundedGlyphLine(0x41, h));
  });
});
