import { LineError, evaluate, firstUnknown, parseExpression, parseLine, parseNumber, parseOperand } from './parse';

describe('parseNumber', () => {
  it.each([
    ['&7C', 0x7c],
    ['&7c00', 0x7c00],
    ['$7C', 0x7c],
    ['%01111100', 0x7c],
    ['124', 124],
    ['0', 0],
  ])('reads %s as %i (BBC &, 6502.org $, binary %, decimal)', (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });

  it.each(['&', '&GG', '$', '%102', '12A', 'loop', ''])('rejects %j', (text) => {
    expect(parseNumber(text)).toBeUndefined();
  });
});

describe('parseExpression and evaluate', () => {
  const symbols = new Map([
    ['screen', 0x7c00],
    ['ptr', 0x70],
  ]);

  it('adds and subtracts numbers and names, left to right', () => {
    expect(evaluate(parseExpression('screen + 80'), symbols)).toBe(0x7c50);
    expect(evaluate(parseExpression('ptr+1'), symbols)).toBe(0x71);
    expect(evaluate(parseExpression('screen - &100 + 2'), symbols)).toBe(0x7b02);
    expect(evaluate(parseExpression('-1'), symbols)).toBe(-1);
  });

  it('is undefined while a name is unknown, and names the first unknown one', () => {
    const expr = parseExpression('screen + later');
    expect(evaluate(expr, symbols)).toBeUndefined();
    expect(firstUnknown(expr, symbols)).toBe('later');
    expect(firstUnknown(parseExpression('screen'), symbols)).toBeUndefined();
  });

  it.each([
    ['', 'missing a value'],
    ['&GG', '"&GG" isn\'t a number or a label'],
    ['ptr +', 'missing a value after "+"'],
    ['2loop', '"2loop" isn\'t a number or a label'],
  ])('rejects %j: %s', (text, message) => {
    expect(() => parseExpression(text)).toThrow(new LineError(message));
  });
});

describe('parseOperand: the shape of the operand picks the family of modes', () => {
  it.each([
    ['', { kind: 'none' }],
    ['A', { kind: 'accumulator' }],
    ['a', { kind: 'accumulator' }],
    ['#&41', { kind: 'immediate' }],
    ['&70', { kind: 'direct', index: undefined }],
    ['&7C00,X', { kind: 'direct', index: 'X' }],
    ['&70 , y', { kind: 'direct', index: 'Y' }],
    ['(&30FF)', { kind: 'indirect' }],
    ['(&70,X)', { kind: 'indexedIndirectX' }],
    ['( &70 , x )', { kind: 'indexedIndirectX' }],
    ['(&70),Y', { kind: 'indirectIndexedY' }],
  ])('%j', (text, expected) => {
    expect(parseOperand(text)).toMatchObject(expected);
  });

  it.each([
    ['&70,Z', 'an index must be X or Y'],
    ['(&70,Y)', '(&nn,Y) doesn\'t exist: did you mean (&nn),Y?'],
    ['(&70),X', '(&nn),X doesn\'t exist: did you mean (&nn,X)?'],
    ['(&70', 'unmatched bracket'],
    ['#', 'missing a value'],
  ])('rejects %j: %s', (text, message) => {
    expect(() => parseOperand(text)).toThrow(new LineError(message));
  });
});

describe('parseLine', () => {
  it('splits a line into label, statement and comment', () => {
    expect(parseLine('loop:  LDA &7C00,X   ; next letter')).toMatchObject({
      label: 'loop',
      code: 'loop:  LDA &7C00,X',
      comment: 'next letter',
      statement: { kind: 'instruction', mnemonic: 'LDA', operand: { kind: 'direct', index: 'X' } },
    });
  });

  it('upper-cases mnemonics but keeps label case', () => {
    expect(parseLine('Start: lda #1')).toMatchObject({ label: 'Start', statement: { mnemonic: 'LDA' } });
  });

  it('reads blank lines, comment-only lines and label-only lines', () => {
    expect(parseLine('   ')).toMatchObject({ label: undefined, statement: { kind: 'empty' }, comment: '' });
    expect(parseLine('; just a comment')).toMatchObject({ statement: { kind: 'empty' }, comment: 'just a comment' });
    expect(parseLine('message:')).toMatchObject({ label: 'message', statement: { kind: 'empty' } });
  });

  it('reads *=, constants, .byte and .word', () => {
    expect(parseLine('*= &0400')).toMatchObject({ statement: { kind: 'origin' } });
    expect(parseLine('* = &0400')).toMatchObject({ statement: { kind: 'origin' } });
    expect(parseLine('screen = &7C00')).toMatchObject({ label: undefined, statement: { kind: 'constant', name: 'screen' } });
    expect(parseLine('.byte &48, &49')).toMatchObject({ statement: { kind: 'byte', values: [{}, {}] } });
    expect(parseLine('table: .WORD &7C00')).toMatchObject({ label: 'table', statement: { kind: 'word', values: [{}] } });
  });

  it.each([
    ['LDQ #1', 'unknown mnemonic "LDQ"'],
    ['loop LDA #1', 'unknown mnemonic "LOOP" (a label needs a colon: "loop:")'],
    ['.ascii "HI"', 'unknown directive ".ascii" (this assembler has .byte and .word)'],
    ['.byte', '.byte needs at least one value'],
    ['X: NOP', '"X" can\'t be a label: A, X and Y are register names'],
    ['a = 1', '"a" can\'t be a label: A, X and Y are register names'],
  ])('rejects %j: %s', (text, message) => {
    expect(() => parseLine(text)).toThrow(new LineError(message));
  });
});
