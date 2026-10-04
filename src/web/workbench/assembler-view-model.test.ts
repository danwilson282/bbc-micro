import { assemble } from '../../asm/assembler';
import { describeAssembly } from './assembler-view-model';

describe('describeAssembly', () => {
  it('summarises a successful assembly: bytes, lines that made bytes, and where it runs from', () => {
    const view = describeAssembly(assemble(['ptr = &80', '*= &0400', 'start: LDA #1', 'STA ptr', 'table: .word &7C00'].join('\n')));
    expect(view).toEqual({
      status: 'Assembled 6 bytes from 3 lines. Runs from &0400.',
      isError: false,
      errors: [],
      symbols: 'ptr = &80, start = &0400, table = &0404',
    });
  });

  it('lists every error with its line number, and says nothing was loaded', () => {
    const view = describeAssembly(assemble(['*= &0400', 'LDQ #1', 'JMP nowhere'].join('\n')));
    expect(view).toEqual({
      status: '2 errors: nothing was loaded.',
      isError: true,
      errors: ['line 2: unknown mnemonic "LDQ"', 'line 3: unknown label "nowhere"'],
      symbols: '',
    });
  });

  it('uses the singular for one byte, one line, one error', () => {
    expect(describeAssembly(assemble('*= &0400\nNOP')).status).toBe('Assembled 1 byte from 1 line. Runs from &0400.');
    expect(describeAssembly(assemble('NOP')).status).toBe('1 error: nothing was loaded.');
  });

  it('treats a program with no bytes as nothing to run', () => {
    expect(describeAssembly(assemble('screen = &7C00'))).toMatchObject({
      status: 'Nothing to run: the program has no instructions or data.',
      isError: true,
      symbols: 'screen = &7C00',
    });
  });
});
