import { assemble } from '../asm/assembler';
import { ENCODINGS, isMnemonic } from '../asm/encodings';
import { TestBus } from '../memory/test-bus';
import { MODES } from './addressing';
import { disassemble, disassembleRange, type Peek } from './disassembler';
import { OPCODES } from './opcodes';

/** A peek over bytes placed at address; everything else reads &00. */
function memory(address: number, bytes: readonly number[]): Peek {
  const bus = new TestBus();
  bus.load(address, bytes);
  return (a) => bus.read(a);
}

/** Disassembles bytes placed at address (default &0400) and returns the text. */
function text(bytes: readonly number[], address = 0x0400): string {
  return disassemble(memory(address, bytes), address).text;
}

describe('disassembling one instruction of each addressing mode', () => {
  it.each([
    ['implied', [0xe8], 'INX'],
    ['accumulator', [0x0a], 'ASL A'],
    ['immediate', [0xa9, 0x41], 'LDA #&41'],
    ['zero page', [0xa5, 0x70], 'LDA &70'],
    ['zero page,X', [0xb5, 0x70], 'LDA &70,X'],
    ['zero page,Y', [0xb6, 0x70], 'LDX &70,Y'],
    ['absolute (low byte first: 00 7C is &7C00)', [0xad, 0x00, 0x7c], 'LDA &7C00'],
    ['absolute,X', [0xbd, 0x00, 0x7c], 'LDA &7C00,X'],
    ['absolute,Y', [0xb9, 0x00, 0x7c], 'LDA &7C00,Y'],
    ['indirect (JMP only)', [0x6c, 0xff, 0x30], 'JMP (&30FF)'],
    ['(indirect,X)', [0xa1, 0x70], 'LDA (&70,X)'],
    ['(indirect),Y', [0xb1, 0x70], 'LDA (&70),Y'],
  ])('%s: %j → %s', (_mode, bytes, expected) => {
    expect(text(bytes)).toBe(expected);
  });

  it('relative: prints the branch target, counted from the next instruction (BNE &FB at &0410 → &040D)', () => {
    expect(text([0xd0, 0xfb], 0x0410)).toBe('BNE &040D');
  });

  it('relative: a forward branch (BEQ &05 at &0410 → &0417)', () => {
    expect(text([0xf0, 0x05], 0x0410)).toBe('BEQ &0417');
  });

  it('relative: the target wraps round the 64K address space (BCC &10 at &FFF8 → &000A)', () => {
    expect(text([0x90, 0x10], 0xfff8)).toBe('BCC &000A');
  });

  it('absolute operands always get 4 hex digits, even below &0100 (AD 70 00 → LDA &0070)', () => {
    expect(text([0xad, 0x70, 0x00])).toBe('LDA &0070');
  });

  it('reads an instruction that runs off the end of memory from &0000 onwards', () => {
    const bus = new TestBus();
    bus.load(0xffff, [0xad, 0x34, 0x12]); // the 34 12 land at &0000 and &0001
    const instruction = disassemble((a) => bus.read(a), 0xffff);
    expect(instruction.text).toBe('LDA &1234');
    expect(instruction.next).toBe(0x0002);
  });
});

describe('what disassemble() returns besides the text', () => {
  it('gives the address, bytes, mnemonic, mode, operand and the next instruction address', () => {
    const instruction = disassemble(memory(0x0409, [0x8d, 0x28, 0x7c]), 0x0409);
    expect(instruction).toEqual({
      address: 0x0409,
      bytes: [0x8d, 0x28, 0x7c],
      mnemonic: 'STA',
      mode: 'absolute',
      operand: '&7C28',
      text: 'STA &7C28',
      target: 0x7c28,
      next: 0x040c,
    });
  });

  it('gives no target for immediate (the operand is data, not an address)', () => {
    expect(disassemble(memory(0x0400, [0xa9, 0x41]), 0x0400).target).toBeUndefined();
  });

  it('gives no target for implied and accumulator instructions', () => {
    expect(disassemble(memory(0x0400, [0xe8]), 0x0400).target).toBeUndefined();
    expect(disassemble(memory(0x0400, [0x0a]), 0x0400).target).toBeUndefined();
  });

  it("gives the pointer as the target for indirect modes (where the address is kept, not the address it holds)", () => {
    expect(disassemble(memory(0x0400, [0xb1, 0x70]), 0x0400).target).toBe(0x70);
    expect(disassemble(memory(0x0400, [0x6c, 0xff, 0x30]), 0x0400).target).toBe(0x30ff);
  });
});

describe('opcodes the CPU does not run', () => {
  it('prints an undocumented opcode as one byte of data: &02 → .byte &02', () => {
    const instruction = disassemble(memory(0x0400, [0x02, 0xa9, 0x41]), 0x0400);
    expect(instruction).toMatchObject({ mnemonic: '.byte', mode: undefined, text: '.byte &02', bytes: [0x02], next: 0x0401 });
  });

  it('covers all 105 undocumented byte values, each 1 byte long', () => {
    let count = 0;
    for (let opcode = 0; opcode < 256; opcode++) {
      if (OPCODES[opcode] !== undefined) continue;
      count++;
      const instruction = disassemble(memory(0x0400, [opcode]), 0x0400);
      expect(instruction.mnemonic).toBe('.byte');
      expect(instruction.bytes).toHaveLength(1);
    }
    expect(count).toBe(105);
  });
});

describe('every documented opcode', () => {
  /** A sample operand for each mode: zero page &70, absolute &1234, branch +&05. */
  function sampleBytes(opcode: number): number[] {
    const entry = OPCODES[opcode];
    if (entry === undefined) throw new Error('no such opcode');
    if (entry.mode === 'relative') return [opcode, 0x05];
    if (entry.bytes === 2) return [opcode, 0x70];
    if (entry.bytes === 3) return [opcode, 0x34, 0x12];
    return [opcode];
  }
  const documented = OPCODES.flatMap((entry, opcode) => (entry === undefined ? [] : [opcode]));

  it('decodes to the mnemonic and mode the assembler encodes it from (two independent tables agree)', () => {
    expect(documented).toHaveLength(151);
    for (const opcode of documented) {
      const instruction = disassemble(memory(0x0400, sampleBytes(opcode)), 0x0400);
      const { mnemonic, mode } = instruction;
      if (!isMnemonic(mnemonic) || mode === undefined) throw new Error(`&${opcode.toString(16)}: ${mnemonic}`);
      const modes: Partial<Record<string, number>> = ENCODINGS[mnemonic];
      expect(modes[mode]).toBe(opcode);
    }
  });

  it("takes 1 + the mode's operand bytes, so the next instruction starts in the right place", () => {
    for (const opcode of documented) {
      const instruction = disassemble(memory(0x0400, sampleBytes(opcode)), 0x0400);
      const mode = instruction.mode;
      if (mode === undefined) throw new Error('documented opcode with no mode');
      expect(instruction.bytes).toHaveLength(1 + MODES[mode].operandBytes);
      expect(instruction.next).toBe(0x0400 + instruction.bytes.length);
    }
  });

  it('round-trips: disassemble, assemble the text at the same address, get the same bytes back', () => {
    for (const opcode of documented) {
      const bytes = sampleBytes(opcode);
      const instruction = disassemble(memory(0x0400, bytes), 0x0400);
      const result = assemble(`*= &0400\n ${instruction.text}`);
      if (!result.ok) throw new Error(`${instruction.text}: ${result.errors[0]?.message ?? ''}`);
      expect({ text: instruction.text, bytes: result.lines[0]?.bytes }).toEqual({ text: instruction.text, bytes });
    }
  });

  it("doesn't round-trip a non-canonical encoding: AD 70 00 → LDA &0070 → our assembler picks zero page, A5 70", () => {
    const result = assemble(`*= &0400\n ${text([0xad, 0x70, 0x00])}`);
    if (!result.ok) throw new Error('should assemble');
    expect(result.lines[0]?.bytes).toEqual([0xa5, 0x70]);
  });
});

describe('assemble → disassemble round trips', () => {
  it('a whole program comes back line for line, branches and indirection included', () => {
    const source = [
      '*= &0400',
      'LDX #&FF',
      'TXS',
      'LDY #&00',
      'LDA (&70),Y',
      'STA &7C28,Y',
      'INY',
      'CPY #&10',
      'BNE &0405',
      'JSR &0420',
      'JMP (&30FF)',
      'ASL A',
      'RTS',
    ];
    const result = assemble(source.join('\n'));
    if (!result.ok) throw new Error('should assemble');
    const bus = new TestBus();
    for (const line of result.lines) bus.load(line.address, line.bytes);
    const lines = disassembleRange((a) => bus.read(a), 0x0400, source.length - 1);
    expect(lines.map((line) => line.text)).toEqual(source.slice(1));
  });
});

describe('decoding depends on where you start', () => {
  // A9 01 2C A9 02: "LDA #1" then a BIT that swallows "LDA #2" (the two-entry-point trick).
  const peek = memory(0x0417, [0xa9, 0x01, 0x2c, 0xa9, 0x02]);

  it('from &0417: LDA #&01, then BIT &02A9 hides the second LDA in its operand', () => {
    expect(disassembleRange(peek, 0x0417, 2).map((i) => i.text)).toEqual(['LDA #&01', 'BIT &02A9']);
  });

  it('from &041A: the same bytes are LDA #&02', () => {
    expect(disassemble(peek, 0x041a).text).toBe('LDA #&02');
  });

  it('from &0418, mid-instruction: nonsense (ORA (&2C,X)) that happens to resynchronise at &041A', () => {
    expect(disassembleRange(peek, 0x0418, 2).map((i) => `&${i.address.toString(16)} ${i.text}`)).toEqual(['&418 ORA (&2C,X)', '&41a LDA #&02']);
  });
});

describe('labels', () => {
  const labels = new Map([
    [0x0417, 'one'],
    [0x0080, 'result'],
    [0x7c28, 'screen'],
  ]);

  it('replaces an operand address that has a name: 20 17 04 → JSR one', () => {
    expect(disassemble(memory(0x0400, [0x20, 0x17, 0x04]), 0x0400, labels).text).toBe('JSR one');
  });

  it('keeps the mode syntax around the name: STA screen,Y and LDA (result),Y', () => {
    expect(disassemble(memory(0x0400, [0x99, 0x28, 0x7c]), 0x0400, labels).text).toBe('STA screen,Y');
    expect(disassemble(memory(0x0400, [0xb1, 0x80]), 0x0400, labels).text).toBe('LDA (result),Y');
  });

  it('names a branch target', () => {
    expect(disassemble(memory(0x0415, [0xd0, 0x00]), 0x0415, new Map([[0x0417, 'one']])).text).toBe('BNE one');
  });

  it('never names an immediate value: LDA #&80 stays LDA #&80 even though &80 is "result"', () => {
    expect(disassemble(memory(0x0400, [0xa9, 0x80]), 0x0400, labels).text).toBe('LDA #&80');
  });

  it('round-trips with the same labels defined in the source', () => {
    const instruction = disassemble(memory(0x0400, [0x99, 0x28, 0x7c]), 0x0400, labels);
    const result = assemble(`screen = &7C28\n*= &0400\n ${instruction.text}`);
    if (!result.ok) throw new Error('should assemble');
    expect(result.lines[0]?.bytes).toEqual([0x99, 0x28, 0x7c]);
  });
});
