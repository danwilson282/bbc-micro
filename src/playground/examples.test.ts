import { assemble, formatError } from '../asm/assembler';
import { Cpu6502, UnimplementedOpcodeError } from '../cpu/cpu6502';
import { TestBus } from '../memory/test-bus';
import { EXAMPLES, LABELS_SOURCE, findExample } from './examples';
import { LOADS_PROGRAM } from './loads-program';
import { installProgram } from './setup';
import { STORES_PROGRAM } from './stores-program';

function assembled(source: string): Extract<ReturnType<typeof assemble>, { ok: true }> {
  const result = assemble(source);
  if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
  return result;
}

describe('the assembler agrees with our hand assembly', () => {
  it.each([
    ['stores', STORES_PROGRAM],
    ['loads', LOADS_PROGRAM],
  ] as const)('the Stage %s program assembles to the same addresses, bytes, source and comments', (id, listing) => {
    const result = assembled(findExample(id).source);
    expect(result.lines.map(({ address, bytes, source, comment }) => ({ address, bytes, source, comment }))).toEqual(
      listing.map(({ address, bytes, source, comment }) => ({ address, bytes, source, comment })),
    );
  });
});

describe('the Stage 08 labels example', () => {
  it('lays out code at &0400 and data straight after it', () => {
    const result = assembled(LABELS_SOURCE);
    expect(result.symbols).toEqual(
      new Map([
        ['screen', 0x7c00],
        ['row2', 0x7c50],
        ['ptr', 0x80],
        ['start', 0x0400],
        ['target', 0x041f],
        ['message', 0x0421],
      ]),
    );
    expect(result.entry).toBe(0x0400);
  });

  it('assembles the forward reference as absolute and the known constant as zero page', () => {
    const { lines } = assembled(LABELS_SOURCE);
    expect(lines.at(0)?.bytes).toEqual([0xad, 0x1f, 0x04]);
    expect(lines.at(1)?.bytes).toEqual([0x85, 0x80]);
  });

  it('stores .word row2 low byte first', () => {
    const target = assembled(LABELS_SOURCE).lines.find((line) => line.source.startsWith('target:'));
    expect(target?.bytes).toEqual([0x50, 0x7c]);
  });

  it('runs: writes "BBC" to row 2 of the screen, then stops at the data (&50 is not implemented)', () => {
    const bus = new TestBus();
    const result = assembled(LABELS_SOURCE);
    installProgram(bus, result.lines, 0x0400);
    const cpu = new Cpu6502(bus);
    cpu.reset();
    let error: unknown;
    for (let i = 0; i < 20 && error === undefined; i++) {
      try {
        cpu.step();
      } catch (e) {
        error = e;
      }
    }
    expect(error).toBeInstanceOf(UnimplementedOpcodeError);
    expect(cpu.regs.pc).toBe(0x041f);
    expect([0x7c50, 0x7c51, 0x7c52].map((a) => bus.read(a))).toEqual([0x42, 0x42, 0x43]);
  });
});

describe('the examples', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s assembles without errors', (_id, example) => {
    expect(assemble(example.source).ok).toBe(true);
  });

  it('falls back to the first example for an unknown or missing id', () => {
    expect(findExample('nope').id).toBe('labels');
    expect(findExample(null).id).toBe('labels');
  });
});
