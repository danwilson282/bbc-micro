import { assemble, formatError, type Assembly } from './assembler';

/** Assembles and returns all the bytes in order, failing the test on errors. */
function bytesOf(source: string): number[] {
  const result = assemble(source);
  if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
  return result.lines.flatMap((line) => [...line.bytes]);
}

/** Assembles a program that must fail, and returns its error lines. */
function errorsOf(source: string): string[] {
  const result = assemble(source);
  if (result.ok) throw new Error('expected errors, but it assembled');
  return result.errors.map(formatError);
}

function ok(result: Assembly): Extract<Assembly, { ok: true }> {
  if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
  return result;
}

const lines = (...text: string[]): string => text.join('\n');

describe('encoding: mnemonic + mode → opcode, then operand bytes low first', () => {
  it('encodes all 13 addressing modes', () => {
    const source = lines(
      '*= &1000',
      'NOP', //           implied
      'ASL A', //         accumulator
      'LDA #&41', //      immediate
      'LDA &70', //       zero page
      'LDA &70,X', //     zero page,X
      'LDX &70,Y', //     zero page,Y
      'LDA &7C00', //     absolute
      'LDA &7C00,X', //   absolute,X
      'LDA &7C00,Y', //   absolute,Y
      'JMP (&30FF)', //   indirect
      'LDA (&70,X)', //   (indirect,X)
      'LDA (&70),Y', //   (indirect),Y
      'BNE &1000', //     relative: from &101C back to &1000 is -28 = &E4
    );
    expect(bytesOf(source)).toEqual([
      0xea,
      0x0a,
      0xa9, 0x41,
      0xa5, 0x70,
      0xb5, 0x70,
      0xb6, 0x70,
      0xad, 0x00, 0x7c,
      0xbd, 0x00, 0x7c,
      0xb9, 0x00, 0x7c,
      0x6c, 0xff, 0x30,
      0xa1, 0x70,
      0xb1, 0x70,
      0xd0, 0xe4,
    ]);
  });

  it('lists each line at its address with its bytes, source and comment', () => {
    const result = ok(assemble(lines('*= &0400', 'LDA #&41   ; "A"', 'STA &7C00')));
    expect(result.lines).toEqual([
      { lineNumber: 2, address: 0x0400, bytes: [0xa9, 0x41], source: 'LDA #&41', comment: '"A"' },
      { lineNumber: 3, address: 0x0402, bytes: [0x8d, 0x00, 0x7c], source: 'STA &7C00', comment: '' },
    ]);
    expect(result.entry).toBe(0x0400);
  });

  it('accepts lower case, $ hex, % binary and decimal', () => {
    expect(bytesOf(lines('*= $0400', 'lda #%01000001', 'sta 124'))).toEqual([0xa9, 0x41, 0x85, 0x7c]);
  });

  it('uses Accumulator mode for a shift with no operand, as well as with "A"', () => {
    expect(bytesOf(lines('*= &0400', 'ASL', 'ROR A', 'LSR a'))).toEqual([0x0a, 0x6a, 0x4a]);
  });

  it('encodes BRK as one byte, &00', () => {
    expect(bytesOf(lines('*= &0400', 'BRK'))).toEqual([0x00]);
  });
});

describe('choosing zero page or absolute', () => {
  it('goes by the value, not the digits typed: LDA &0070 is zero page', () => {
    expect(bytesOf(lines('*= &0400', 'LDA &0070'))).toEqual([0xa5, 0x70]);
  });

  it('uses absolute when the value needs two bytes', () => {
    expect(bytesOf(lines('*= &0400', 'LDA &0100'))).toEqual([0xad, 0x00, 0x01]);
  });

  it('falls back to absolute,Y for LDA &70,Y, because LDA has no zero page,Y', () => {
    expect(bytesOf(lines('*= &0400', 'LDA &70,Y'))).toEqual([0xb9, 0x70, 0x00]);
  });

  it('JMP and JSR are always absolute, even to a zero-page address', () => {
    expect(bytesOf(lines('*= &0400', 'JMP &0070', 'JSR &70'))).toEqual([0x4c, 0x70, 0x00, 0x20, 0x70, 0x00]);
  });

  it('a constant defined BEFORE use gets zero page', () => {
    expect(bytesOf(lines('ptr = &70', '*= &0400', 'LDA ptr'))).toEqual([0xa5, 0x70]);
  });

  it('a forward reference stays absolute, because pass 1 had to assume 2 bytes', () => {
    const result = ok(assemble(lines('*= &0400', 'LDA ptr', 'RTS', 'ptr = &70')));
    expect(result.lines.flatMap((l) => [...l.bytes])).toEqual([0xad, 0x70, 0x00, 0x60]);
    // RTS is where pass 1 put it: one size decision per line, never revisited.
    expect(result.lines[1]?.address).toBe(0x0403);
  });
});

describe('labels', () => {
  it('names the address of the next byte, backwards and forwards', () => {
    const result = ok(
      assemble(
        lines(
          '        *= &0400',
          'start:  LDA message', //  forward: absolute
          '        JMP start', //    backward
          'message:', //             a label on its own line names the next line's address
          '        .byte &48',
        ),
      ),
    );
    expect(result.symbols).toEqual(new Map([['start', 0x0400], ['message', 0x0406]]));
    expect(result.lines.flatMap((l) => [...l.bytes])).toEqual([0xad, 0x06, 0x04, 0x4c, 0x00, 0x04, 0x48]);
  });

  it('shows the label in the listing source, even when it was on a line of its own', () => {
    const result = ok(assemble(lines('*= &0400', 'here:', 'NOP', 'there: NOP')));
    expect(result.lines.map((l) => l.source)).toEqual(['here: NOP', 'there: NOP']);
  });

  it('are case-sensitive: Loop and loop are different', () => {
    expect(errorsOf(lines('*= &0400', 'Loop: NOP', 'JMP loop'))).toEqual(['line 3: unknown label "loop"']);
  });

  it('can be used with + and -, e.g. the high byte of a pointer', () => {
    expect(bytesOf(lines('ptr = &70', '*= &0400', 'STA ptr+1', 'LDA table-1', 'table: .byte 1'))).toEqual([
      0x85, 0x71, 0xad, 0x04, 0x04, 0x01,
    ]);
  });

  it('constants can refer to later constants and labels', () => {
    expect(bytesOf(lines('row2 = screen + 80', 'screen = &7C00', '*= &0400', 'STA row2'))).toEqual([0x8d, 0x50, 0x7c]);
  });
});

describe('branches: target address → signed offset from the next instruction', () => {
  it('backwards: &0410 BNE &0406 is offset -12 = &F4', () => {
    const source = lines('*= &0406', 'loop: .byte 0,0,0,0,0,0,0,0,0,0', 'BNE loop');
    expect(bytesOf(source).slice(-2)).toEqual([0xd0, 0xf4]);
  });

  it('forwards, to a label not seen yet', () => {
    expect(bytesOf(lines('*= &0400', 'BEQ done', 'NOP', 'NOP', 'done: RTS'))).toEqual([0xf0, 0x02, 0xea, 0xea, 0x60]);
  });

  it('reaches exactly +127 and -128', () => {
    const forward = lines('*= &0400', 'BCC far', `.byte ${new Array(127).fill('0').join(',')}`, 'far: RTS');
    expect(bytesOf(forward).slice(0, 2)).toEqual([0x90, 0x7f]);
    const backward = lines('*= &0400', `near: .byte ${new Array(126).fill('0').join(',')}`, 'BCS near');
    expect(bytesOf(backward).slice(-2)).toEqual([0xb0, 0x80]);
  });

  it('is an error one byte further, either way', () => {
    const forward = lines('*= &0400', 'BCC far', `.byte ${new Array(128).fill('0').join(',')}`, 'far: RTS');
    expect(errorsOf(forward)).toEqual(['line 2: BCC target &0482 is 128 bytes away; a branch reaches -128..+127']);
    const backward = lines('*= &0400', `near: .byte ${new Array(127).fill('0').join(',')}`, 'BCS near');
    expect(errorsOf(backward)).toEqual(['line 3: BCS target &0400 is -129 bytes away; a branch reaches -128..+127']);
  });

  it('rejects an indexed branch', () => {
    expect(errorsOf(lines('*= &0400', 'BNE &0400,X'))).toEqual(['line 2: BNE only has Relative mode: give it a target address']);
  });
});

describe('directives', () => {
  it('.byte emits bytes and .word emits words low byte first', () => {
    expect(bytesOf(lines('*= &0400', '.byte &48, &49', '.word &7C50, 1'))).toEqual([0x48, 0x49, 0x50, 0x7c, 0x01, 0x00]);
  });

  it('*= can start a second block; the entry point is the first byte emitted', () => {
    const result = ok(assemble(lines('*= &0400', 'NOP', '*= &7C00', '.byte &48')));
    expect(result.lines.map((l) => l.address)).toEqual([0x0400, 0x7c00]);
    expect(result.entry).toBe(0x0400);
  });

  it('a program with no bytes assembles, with no entry point', () => {
    const result = ok(assemble('; nothing here'));
    expect(result.lines).toEqual([]);
    expect(result.entry).toBeUndefined();
  });
});

describe('errors say which line and what is wrong, and stop any bytes being produced', () => {
  it.each([
    [lines('NOP'), 'line 1: no address yet: put "*= &nnnn" before the first instruction or data'],
    [lines('start: NOP'), 'line 1: no address yet: put "*= &nnnn" before the first instruction or data'],
    [lines('*= later', 'later: NOP'), 'line 1: *= needs a value known at this point, not a forward reference ("later")'],
    [lines('*= &10000'), 'line 1: address &10000 is beyond &FFFF'],
    [lines('*= &FFFF', 'LDA &1234'), 'line 2: the program runs past &FFFF'],
    [lines('*= &0400', 'LDA #&100'), 'line 2: &100 doesn\'t fit in a byte (&00-&FF)'],
    [lines('*= &0400', 'LDA &10000'), 'line 2: &10000 doesn\'t fit in a word (&0000-&FFFF)'],
    [lines('*= &0400', '.byte 256'), 'line 2: &100 doesn\'t fit in a byte (&00-&FF)'],
    [lines('*= &0400', 'LDA (&100),Y'), 'line 2: &100 doesn\'t fit in a byte (&00-&FF)'],
    [lines('*= &0400', 'STX &1234,Y'), 'line 2: STX has no Absolute,Y mode (it has &nn, &nn,Y, &nnnn)'],
    [lines('*= &0400', 'STA #1'), 'line 2: STA has no Immediate mode (it has &nn, &nn,X, &nnnn, &nnnn,X, &nnnn,Y, (&nn,X), (&nn),Y)'],
    [lines('*= &0400', 'STY &1234,X'), 'line 2: STY has no Absolute,X mode (it has &nn, &nn,X, &nnnn)'],
    [lines('*= &0400', 'LDA (&70)'), 'line 2: LDA has no Indirect mode (it has #&nn, &nn, &nn,X, &nnnn, &nnnn,X, &nnnn,Y, (&nn,X), (&nn),Y)'],
    [lines('*= &0400', 'LDA A'), 'line 2: LDA has no Accumulator mode (it has #&nn, &nn, &nn,X, &nnnn, &nnnn,X, &nnnn,Y, (&nn,X), (&nn),Y)'],
    [lines('*= &0400', 'LDA'), 'line 2: LDA needs an operand'],
    [lines('*= &0400', 'NOP &70'), 'line 2: NOP takes no operand'],
    [lines('*= &0400', 'JMP nowhere'), 'line 2: unknown label "nowhere"'],
    [lines('*= &0400', 'x1 = x1 + 1', 'LDA x1'), 'line 2: can\'t work out "x1": it depends on itself or on an unknown label'],
    [lines('*= &0400', 'a1: NOP', 'a1: NOP'), 'line 3: "a1" is already defined on line 2'],
    [lines('*= &0400', 'LDA #-1'), 'line 2: -1 doesn\'t fit in a byte (&00-&FF)'],
  ])('%j → %s', (source, message) => {
    expect(errorsOf(source)).toEqual([message]);
  });

  it('collects every error in one go, in line order', () => {
    const source = lines('*= &0400', 'LDQ #1', 'NOP', 'JMP nowhere', 'LDA #&100');
    expect(errorsOf(source)).toEqual([
      'line 2: unknown mnemonic "LDQ"',
      'line 4: unknown label "nowhere"',
      'line 5: &100 doesn\'t fit in a byte (&00-&FF)',
    ]);
  });

  it('keeps the offending text with each error', () => {
    const result = assemble(lines('*= &0400', '   LDQ #1   ; oops'));
    expect(result.ok ? [] : result.errors).toEqual([{ lineNumber: 2, message: 'unknown mnemonic "LDQ"', text: '   LDQ #1   ; oops' }]);
  });
});
