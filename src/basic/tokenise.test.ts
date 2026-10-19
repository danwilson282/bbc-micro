// Every expected byte here is what BASIC II itself made of the same line,
// read from memory at PAGE in the emulator (Stage 51's probes; the ROM
// comparison is repeated live in tokenise-rom.test.ts when the ROMs are there).

import { BASIC_KEYWORDS, encodeLineNumber, tokeniseLine, tokeniseProgram } from './tokenise';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

describe('a tokenised line: &0D, line number high then low, the whole line\'s length, the text', () => {
  it('10 PRINT "HI" is 0D 00 0A 0B, then space, PRINT (&F1), space and the string as ASCII', () => {
    expect(hex(tokeniseLine('10 PRINT "HI"'))).toBe('0D 00 0A 0B 20 F1 20 22 48 49 22');
  });

  it('the line number is high byte first, unlike the 6502: line 260 is 01 04', () => {
    expect(hex(tokeniseLine('260 PRINT')).slice(0, 11)).toBe('0D 01 04 06');
  });

  it('the spaces after the line number are kept, as typed', () => {
    expect(hex(tokeniseLine('210   PRINT'))).toBe('0D 00 D2 08 20 20 20 F1');
  });

  it('a program ends with 0D FF, which no line can start with (the highest line is 32767, &7FFF)', () => {
    expect(hex(tokeniseProgram('10 PRINT "HI"\n20 GOTO 10\n'))).toBe('0D 00 0A 0B 20 F1 20 22 48 49 22 0D 00 14 0B 20 E5 20 8D 54 4A 40 0D FF');
  });

  it('an empty program is just the end marker', () => {
    expect(hex(tokeniseProgram(''))).toBe('0D FF');
  });

  it('refuses line numbers past 32767, a line with no number, and a line over 255 bytes', () => {
    expect(() => tokeniseLine('32768 PRINT')).toThrow(RangeError);
    expect(() => tokeniseLine('PRINT')).toThrow(RangeError);
    expect(() => tokeniseLine(`10 REM ${'X'.repeat(250)}`)).toThrow(RangeError);
  });
});

describe('keywords become one byte from &80 up', () => {
  it('has the 121 keywords of BASIC II, with PTR, PAGE, TIME, LOMEM and HIMEM\'s second token &40 higher', () => {
    expect(BASIC_KEYWORDS).toHaveLength(121);
    const time = BASIC_KEYWORDS.find((k) => k.word === 'TIME');
    expect(time).toEqual({ word: 'TIME', token: 0x91, conditional: true, statementToken: 0xd1, lineNumbers: false, restVerbatim: false, name: false });
  });

  it.each([
    ['X=TOP', '58 3D B8 50'], // TO isn't conditional: TOP is TO (&B8) and P
    ['FOR I=1TO9', 'E3 20 49 3D 31 B8 39'],
    ['A%=1:B=A%AND3', '41 25 3D 31 3A 42 3D 41 25 80 33'],
    ['PRINT TAB(3)', 'F1 20 8A 33 29'], // TAB( includes its bracket
    ['A$="X":CLS', '41 24 3D 22 58 22 3A DB'],
    ['PRINTER=1', 'F1 45 52 3D 31'], // PRINT isn't conditional: PRINT ER=1
  ])('%s', (text, bytes) => {
    expect(hex(tokeniseLine(`10 ${text}`).subarray(5))).toBe(bytes);
  });
});

describe('the rules that make it more than find-and-replace', () => {
  it.each([
    ['nothing inside a string', 'PRINT"AND"', 'F1 22 41 4E 44 22'],
    ['nothing after REM', 'PROCPRINT:REM PRINT', 'F2 50 52 49 4E 54 3A F4 20 50 52 49 4E 54'],
    ['nothing after DATA', 'DATA AND,OR', 'DC 20 41 4E 44 2C 4F 52'],
    ['nothing in a * command', '*RUN HELLO', '2A 52 55 4E 20 48 45 4C 4C 4F'],
    ['nothing in a * command after a colon', 'X=1:*CAT', '58 3D 31 3A 2A 43 41 54'],
    ['nothing in a hex number', 'A=&DEF', '41 3D 26 44 45 46'],
    ['nothing in a variable name', 'ZPRINT', '5A 50 52 49 4E 54'],
    ['nothing in an FN name', 'X=FNAND', '58 3D A4 41 4E 44'],
    ['nothing in a PROC name', 'DEFPROCOR', 'DD F2 4F 52'],
    ['_ belongs to a name', 'A_B=1', '41 5F 42 3D 31'],
    ['nothing in lowercase', 'print', '70 72 69 6E 74'],
  ])('%s', (_, text, bytes) => {
    expect(hex(tokeniseLine(`10 ${text}`).subarray(5))).toBe(bytes);
  });

  it.each([
    ['TIMEQ', '54 49 4D 45 51'],
    ['X=TIME2', '58 3D 54 49 4D 45 32'],
    ['ENDPROCQ', '45 4E 44 50 52 4F 43 51'],
  ])('a conditional keyword followed by a letter or digit is a variable: %s', (text, bytes) => {
    expect(hex(tokeniseLine(`10 ${text}`).subarray(5))).toBe(bytes);
  });

  it.each([
    ['at the start of a line', 'LOMEM=X', 'D2 3D 58'],
    ['after a colon', 'A=1:TIME=2', '41 3D 31 3A D1 3D 32'],
    ['after THEN', 'IF A THEN TIME=3', 'E7 20 41 20 8C 20 D1 3D 33'],
    ['after ELSE', 'ELSE TIME=1', '8B 20 D1 3D 31'],
    ['after REPEAT', 'REPEAT TIME=1', 'F5 20 D1 3D 31'],
    ['after a colon and spaces', 'X=1:  TIME=1', '58 3D 31 3A 20 20 D1 3D 31'],
  ])('a pseudo-variable at the start of a statement gets its &40-higher token: %s', (_, text, bytes) => {
    expect(hex(tokeniseLine(`10 ${text}`).subarray(5))).toBe(bytes);
  });

  it('but not in an expression: A=TIME is &91', () => {
    expect(hex(tokeniseLine('10 A=TIME').subarray(5))).toBe('41 3D 91');
  });
});

describe('line numbers after GOTO, GOSUB, THEN, ELSE and RESTORE: &8D and three scrambled bytes', () => {
  it.each([
    [10, '54 4A 40'],
    [20, '54 54 40'],
    [100, '44 64 40'],
    [1000, '64 68 43'],
    [32767, '60 7F 7F'],
  ])('line %i', (n, bytes) => {
    expect(hex(encodeLineNumber(n))).toBe(`8D ${bytes}`);
  });

  it.each([
    ['IF X THEN 1000 ELSE 300', 'E7 20 58 20 8C 20 8D 64 68 43 20 8B 20 8D 54 6C 41'],
    ['ON X GOTO 10,20', 'EE 20 58 20 E5 20 8D 54 4A 40 2C 8D 54 54 40'],
    ['RESTORE 100', 'F7 20 8D 44 64 40'],
    ['PRINT 1:ELSE 20', 'F1 20 31 3A 8B 20 8D 54 54 40'],
    ['ON ERROR GOTO 10', 'EE 20 85 20 E5 20 8D 54 4A 40'],
    ['GOTO 10 20', 'E5 20 8D 54 4A 40 20 8D 54 54 40'], // spaces don't end it
    ['TRACE 100', 'FC 20 8D 44 64 40'],
    ['LIST 100', 'C9 20 8D 44 64 40'],
    ['DELETE 10,20', 'C7 20 8D 54 4A 40 2C 8D 54 54 40'],
    ['RENUMBER 10', 'CC 20 8D 54 4A 40'],
    ['AUTO 10', 'C6 20 8D 54 4A 40'],
  ])('%s', (text, bytes) => {
    expect(hex(tokeniseLine(`10 ${text}`).subarray(5))).toBe(bytes);
  });

  it.each([
    ['GOTO X', 'E5 20 58'],
    ['THENX', '8C 58'],
    ['GOTO (10)', 'E5 20 28 31 30 29'],
  ])('a variable after them is just a variable: %s', (text, bytes) => {
    expect(hex(tokeniseLine(`10 ${text}`).subarray(5))).toBe(bytes);
  });
});
