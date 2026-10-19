// A BBC BASIC II tokeniser (Stage 51): program text in, the bytes BASIC
// itself keeps at PAGE out, so that a program can go on a disc we make and
// CHAIN can run it.
//
// A tokenised line (BASIC II, as read from memory at PAGE):
//
//   &0D  line high  line low  length  text...
//
// The line number is high byte first, and the length counts the whole line,
// these four bytes too. A program ends with &0D &FF. Keywords are one byte
// from &80 up; everything else stays ASCII. The rules that decide what is a
// keyword are in the Stage 51 doc, and every one was checked against the real
// BASIC II ROM (tokenise.test.ts holds what it made; tokenise-rom.test.ts asks
// it again when the ROMs are there).
//
// Not handled: abbreviations (P. for PRINT; our programs spell keywords out),
// and BASIC's quirk of encoding numbers as line numbers when a line's text
// starts with a digit (`10 1AND2`).

export interface BasicKeyword {
  readonly word: string;
  readonly token: number;
  /** Not a keyword if a letter, digit or _ follows: TIMEQ is a variable. */
  readonly conditional: boolean;
  /** PTR, PAGE, TIME, LOMEM, HIMEM: the token at the start of a statement (being assigned to). */
  readonly statementToken: number | undefined;
  /** Numbers after it are line numbers: &8D and three bytes. */
  readonly lineNumbers: boolean;
  /** REM and DATA: the rest of the line is kept as it is. */
  readonly restVerbatim: boolean;
  /** FN and PROC: a name follows, kept as it is. */
  readonly name: boolean;
}

/** The token for an encoded line number (after GOTO and friends). */
export const LINE_NUMBER_TOKEN = 0x8d;
/** Every line starts with a CR. */
export const LINE_START = 0x0d;
/** &0D &FF ends a program: no line number's high byte is &FF. */
export const PROGRAM_END = 0xff;
/** The highest line number BASIC II allows. */
export const MAX_LINE_NUMBER = 32767;
/** The length byte counts the whole line. */
const MAX_LINE_LENGTH = 255;
/** &0D, high, low, length. */
const LINE_HEADER = 4;

type Flag = 'c' | 'l' | 'r' | 'n';

/**
 * [word, token, flags]. Flags: c conditional, l line numbers follow, r rest
 * of line verbatim, n a name follows, s starts a statement. The five
 * pseudo-variables' statement tokens are token + &40 (&CF-&D3).
 * Token values and flags as BASIC II behaves (probed in Stage 51).
 */
const TABLE: readonly (readonly [string, number, string])[] = [
  ['AND', 0x80, ''], ['DIV', 0x81, ''], ['EOR', 0x82, ''], ['MOD', 0x83, ''],
  ['OR', 0x84, ''], ['ERROR', 0x85, ''], ['LINE', 0x86, ''], ['OFF', 0x87, ''],
  ['STEP', 0x88, ''], ['SPC', 0x89, ''], ['TAB(', 0x8a, ''], ['ELSE', 0x8b, 'ls'],
  ['THEN', 0x8c, 'ls'], ['OPENIN', 0x8e, ''], ['PTR', 0x8f, 'c'],
  ['PAGE', 0x90, 'c'], ['TIME', 0x91, 'c'], ['LOMEM', 0x92, 'c'], ['HIMEM', 0x93, 'c'],
  ['ABS', 0x94, ''], ['ACS', 0x95, ''], ['ADVAL', 0x96, ''], ['ASC', 0x97, ''],
  ['ASN', 0x98, ''], ['ATN', 0x99, ''], ['BGET', 0x9a, 'c'], ['COS', 0x9b, ''],
  ['COUNT', 0x9c, 'c'], ['DEG', 0x9d, ''], ['ERL', 0x9e, 'c'], ['ERR', 0x9f, 'c'],
  ['EVAL', 0xa0, ''], ['EXP', 0xa1, ''], ['EXT', 0xa2, 'c'], ['FALSE', 0xa3, 'c'],
  ['FN', 0xa4, 'n'], ['GET', 0xa5, ''], ['INKEY', 0xa6, ''], ['INSTR(', 0xa7, ''],
  ['INT', 0xa8, ''], ['LEN', 0xa9, ''], ['LN', 0xaa, ''], ['LOG', 0xab, ''],
  ['NOT', 0xac, ''], ['OPENUP', 0xad, ''], ['OPENOUT', 0xae, ''], ['PI', 0xaf, 'c'],
  ['POINT(', 0xb0, ''], ['POS', 0xb1, 'c'], ['RAD', 0xb2, ''], ['RND', 0xb3, 'c'],
  ['SGN', 0xb4, ''], ['SIN', 0xb5, ''], ['SQR', 0xb6, ''], ['TAN', 0xb7, ''],
  ['TO', 0xb8, ''], ['TRUE', 0xb9, 'c'], ['USR', 0xba, ''], ['VAL', 0xbb, ''],
  ['VPOS', 0xbc, 'c'], ['CHR$', 0xbd, ''], ['GET$', 0xbe, ''], ['INKEY$', 0xbf, ''],
  ['LEFT$(', 0xc0, ''], ['MID$(', 0xc1, ''], ['RIGHT$(', 0xc2, ''], ['STR$', 0xc3, ''],
  ['STRING$(', 0xc4, ''], ['EOF', 0xc5, 'c'], ['AUTO', 0xc6, 'l'], ['DELETE', 0xc7, 'l'],
  ['LOAD', 0xc8, ''], ['LIST', 0xc9, 'l'], ['NEW', 0xca, 'c'], ['OLD', 0xcb, 'c'],
  ['RENUMBER', 0xcc, 'l'], ['SAVE', 0xcd, ''],
  ['SOUND', 0xd4, ''], ['BPUT', 0xd5, 'c'], ['CALL', 0xd6, ''], ['CHAIN', 0xd7, ''],
  ['CLEAR', 0xd8, 'c'], ['CLOSE', 0xd9, 'c'], ['CLG', 0xda, 'c'], ['CLS', 0xdb, 'c'],
  ['DATA', 0xdc, 'r'], ['DEF', 0xdd, ''], ['DIM', 0xde, ''], ['DRAW', 0xdf, ''],
  ['END', 0xe0, 'c'], ['ENDPROC', 0xe1, 'c'], ['ENVELOPE', 0xe2, ''], ['FOR', 0xe3, ''],
  ['GOSUB', 0xe4, 'l'], ['GOTO', 0xe5, 'l'], ['GCOL', 0xe6, ''], ['IF', 0xe7, ''],
  ['INPUT', 0xe8, ''], ['LET', 0xe9, ''], ['LOCAL', 0xea, ''], ['MODE', 0xeb, ''],
  ['MOVE', 0xec, ''], ['NEXT', 0xed, ''], ['ON', 0xee, ''], ['VDU', 0xef, ''],
  ['PLOT', 0xf0, ''], ['PRINT', 0xf1, ''], ['PROC', 0xf2, 'n'], ['READ', 0xf3, ''],
  ['REM', 0xf4, 'r'], ['REPEAT', 0xf5, 's'], ['REPORT', 0xf6, 'c'], ['RESTORE', 0xf7, 'l'],
  ['RETURN', 0xf8, 'c'], ['RUN', 0xf9, 'c'], ['STOP', 0xfa, 'c'], ['COLOUR', 0xfb, ''],
  ['TRACE', 0xfc, 'l'], ['UNTIL', 0xfd, ''], ['WIDTH', 0xfe, ''], ['OSCLI', 0xff, ''],
];

/** The pseudo-variables: assigned to at the start of a statement, with a token &40 higher. */
const PSEUDO_VARIABLES: ReadonlySet<string> = new Set(['PTR', 'PAGE', 'TIME', 'LOMEM', 'HIMEM']);
const PSEUDO_VARIABLE_OFFSET = 0x40;

/** A new statement starts after these, as after a colon (THEN, ELSE, REPEAT). */
const STATEMENT_STARTERS: ReadonlySet<string> = new Set(TABLE.filter(([, , flags]) => flags.includes('s')).map(([word]) => word));

/** BASIC II's keywords, &80-&FF. */
export const BASIC_KEYWORDS: readonly BasicKeyword[] = TABLE.map(([word, token, flags]) => {
  const has = (f: Flag): boolean => flags.includes(f);
  return {
    word,
    token,
    conditional: has('c'),
    statementToken: PSEUDO_VARIABLES.has(word) ? token + PSEUDO_VARIABLE_OFFSET : undefined,
    lineNumbers: has('l'),
    restVerbatim: has('r'),
    name: has('n'),
  };
});

/** Longest first, so ENDPROC wins over END and INKEY$ over INKEY. */
const BY_LENGTH: readonly BasicKeyword[] = [...BASIC_KEYWORDS].sort((a, b) => b.word.length - a.word.length);

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isUpper = (c: string): boolean => c >= 'A' && c <= 'Z';
/** A character that can carry on a name (and so stops a conditional keyword). */
const isNameChar = (c: string): boolean => isUpper(c) || (c >= 'a' && c <= 'z') || isDigit(c) || c === '_' || c === '`';
const isHexDigit = (c: string): boolean => isDigit(c) || (c >= 'A' && c <= 'F');

/** &8D and three bytes, scrambled so none is a control code (the Stage 51 doc has the formula). */
export function encodeLineNumber(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > MAX_LINE_NUMBER) throw new RangeError(`line number ${String(n)} isn't 0-${String(MAX_LINE_NUMBER)}`);
  const lo = n & 0xff;
  const hi = (n >> 8) & 0xff;
  return Uint8Array.of(
    LINE_NUMBER_TOKEN,
    (((lo & 0xc0) >> 2) | ((hi & 0xc0) >> 4)) ^ 0x54,
    (lo & 0x3f) | 0x40,
    (hi & 0x3f) | 0x40,
  );
}

/** The keyword at text[i], if BASIC would tokenise one there. */
function keywordAt(text: string, i: number): BasicKeyword | undefined {
  for (const k of BY_LENGTH) {
    if (!text.startsWith(k.word, i)) continue;
    // charAt past the end is '', which isn't a name character.
    if (k.conditional && isNameChar(text.charAt(i + k.word.length))) continue;
    return k;
  }
  return undefined;
}

function ascii(c: string, line: string): number {
  const code = c.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) throw new RangeError(`can't tokenise character &${code.toString(16).toUpperCase()} in "${line}"`);
  return code;
}

/** A line's text after its number, tokenised. */
function tokeniseText(text: string, line: string): number[] {
  const out: number[] = [];
  const copy = (from: number, to: number): void => {
    for (let j = from; j < to; j++) out.push(ascii(text.charAt(j), line));
  };
  let statementStart = true;
  let lineNumbers = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === ' ') {
      out.push(0x20);
      i++;
      continue;
    }
    if (lineNumbers && isDigit(c)) {
      let j = i;
      while (j < text.length && isDigit(text.charAt(j))) j++;
      out.push(...encodeLineNumber(Number(text.slice(i, j))));
      i = j;
      continue;
    }
    if (lineNumbers && c === ',') {
      out.push(0x2c);
      i++;
      continue;
    }
    lineNumbers = false;
    if (c === '"') {
      // A string, to its closing quote (or the end of the line).
      const close = text.indexOf('"', i + 1);
      const end = close < 0 ? text.length : close + 1;
      copy(i, end);
      i = end;
      statementStart = false;
      continue;
    }
    if (c === ':') {
      out.push(0x3a);
      i++;
      statementStart = true;
      continue;
    }
    if (c === '*' && statementStart) {
      // A star command: the MOS reads the rest, not BASIC.
      copy(i, text.length);
      break;
    }
    if (c === '&') {
      let j = i + 1;
      while (j < text.length && isHexDigit(text.charAt(j))) j++;
      copy(i, j);
      i = j;
      statementStart = false;
      continue;
    }
    const keyword = isUpper(c) ? keywordAt(text, i) : undefined;
    if (keyword !== undefined) {
      out.push(statementStart && keyword.statementToken !== undefined ? keyword.statementToken : keyword.token);
      i += keyword.word.length;
      statementStart = STATEMENT_STARTERS.has(keyword.word);
      lineNumbers = keyword.lineNumbers;
      if (keyword.restVerbatim) {
        copy(i, text.length);
        break;
      }
      if (keyword.name) {
        let j = i;
        while (j < text.length && isNameChar(text.charAt(j))) j++;
        copy(i, j);
        i = j;
      }
      continue;
    }
    if (isNameChar(c) && !isDigit(c)) {
      // A variable name: nothing inside it is a keyword.
      let j = i;
      while (j < text.length && isNameChar(text.charAt(j))) j++;
      copy(i, j);
      i = j;
      statementStart = false;
      continue;
    }
    out.push(ascii(c, line));
    i++;
    statementStart = false;
  }
  return out;
}

/** One line, "10 PRINT ..." → &0D, number high, number low, length, tokenised text. */
export function tokeniseLine(line: string): Uint8Array {
  const match = /^ *(\d+)(.*)$/.exec(line);
  const digits = match?.[1];
  const text = match?.[2];
  if (digits === undefined || text === undefined) throw new RangeError(`"${line}" doesn't start with a line number`);
  const number = Number(digits);
  if (number > MAX_LINE_NUMBER) throw new RangeError(`line number ${digits} is over ${String(MAX_LINE_NUMBER)}`);
  const body = tokeniseText(text, line);
  const length = LINE_HEADER + body.length;
  if (length > MAX_LINE_LENGTH) throw new RangeError(`line ${digits} is ${String(length)} bytes tokenised: the most is ${String(MAX_LINE_LENGTH)}`);
  return Uint8Array.of(LINE_START, (number >> 8) & 0xff, number & 0xff, length, ...body);
}

/**
 * A whole program, one line per text line (blank lines skipped), ending
 * &0D &FF: the bytes from PAGE to TOP. Line numbers must go up, as BASIC
 * keeps them.
 */
export function tokeniseProgram(source: string): Uint8Array {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
  const out: number[] = [];
  let last = -1;
  for (const line of lines) {
    const bytes = tokeniseLine(line);
    const number = (bytes[1] << 8) | bytes[2];
    if (number <= last) throw new RangeError(`line ${String(number)} comes after line ${String(last)}: line numbers must go up`);
    last = number;
    out.push(...bytes);
  }
  out.push(LINE_START, PROGRAM_END);
  return Uint8Array.from(out);
}
