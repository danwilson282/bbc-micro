import { assemble } from '../../asm/assembler';
import { TestBus } from '../../memory/test-bus';
import { TRACE_SOURCE } from '../../playground/examples';
import { installProgram } from '../../playground/setup';
import { playgroundTarget } from './debug-target';
import { DISASSEMBLY_NEXT_ROWS, DISASSEMBLY_RAN_ROWS, buildDisassemblyView, labelsFromSymbols } from './disassembly-view-model';

/** The Stage 18 example, installed and reset, as the playground does it. */
function traceExample(): { target: ReturnType<typeof playgroundTarget>; labels: ReadonlyMap<number, string> } {
  const result = assemble(TRACE_SOURCE);
  if (!result.ok) throw new Error('example should assemble');
  const bus = new TestBus();
  installProgram(bus, result.lines, 0x0400);
  const target = playgroundTarget(bus);
  target.reset();
  return { target, labels: labelsFromSymbols(result.symbols) };
}

function steps(target: ReturnType<typeof playgroundTarget>, count: number): void {
  for (let i = 0; i < count; i++) target.step();
}

describe('labelsFromSymbols', () => {
  it('turns name → address into address → name, keeping the first name for an address', () => {
    expect(labelsFromSymbols(new Map([['a', 0x10], ['b', 0x20], ['c', 0x10]]))).toEqual(new Map([[0x10, 'a'], [0x20, 'b']]));
  });
});

describe('coming up: disassembled from memory', () => {
  it(`follows PC: ${String(DISASSEMBLY_NEXT_ROWS)} instructions from PC, the first marked current`, () => {
    const { target, labels } = traceExample();
    const view = buildDisassemblyView(target, { labels });
    expect(view.next).toHaveLength(DISASSEMBLY_NEXT_ROWS);
    expect(view.next.map((row) => row.current)).toEqual([true, ...new Array<boolean>(DISASSEMBLY_NEXT_ROWS - 1).fill(false)]);
    expect(view.next.slice(0, 3).map((row) => [row.label, row.addressHex, row.bytes, row.text])).toEqual([
      ['start', '&0400', 'A2 FF', 'LDX #&FF'],
      ['', '&0402', '9A', 'TXS'],
      ['', '&0403', '20 17 04', 'JSR one'],
    ]);
  });

  it('decodes "one" with the BIT that hides "two": LDA #&01, BIT &02A9, STA result, RTS', () => {
    const { target, labels } = traceExample();
    steps(target, 3); // LDX, TXS, JSR one
    expect(buildDisassemblyView(target, { labels }).next.slice(0, 4).map((row) => row.text)).toEqual(['LDA #&01', 'BIT &02A9', 'STA result', 'RTS']);
  });

  it('from a chosen start, marks PC only if a decoded line lands on it', () => {
    const { target, labels } = traceExample();
    const fromInside = buildDisassemblyView(target, { labels, start: 0x0401 });
    expect(fromInside.next[0]).toMatchObject({ addressHex: '&0401', text: '.byte &FF' });
    expect(fromInside.next.some((row) => row.current)).toBe(false);
    expect(buildDisassemblyView(target, { labels, start: 0x0400 }).next[0]?.current).toBe(true);
  });

  it('says where it is decoding from', () => {
    const { target, labels } = traceExample();
    expect(buildDisassemblyView(target, { labels }).heading).toBe('Coming up: disassembled from memory, following PC (&0400)');
    expect(buildDisassemblyView(target, { labels, start: 0x0418 }).heading).toBe('From &0418: disassembled from memory (not following PC)');
  });
});

describe('just ran: from the trace', () => {
  it('is empty after a reset', () => {
    const { target, labels } = traceExample();
    expect(buildDisassemblyView(target, { labels }).ran).toEqual([]);
  });

  it(`lists the last ${String(DISASSEMBLY_RAN_ROWS)} steps, oldest first, with the cycle each started on`, () => {
    const { target, labels } = traceExample();
    steps(target, 8); // LDX TXS JSR LDA BIT STA RTS JSR
    const ran = buildDisassemblyView(target, { labels }).ran;
    expect(ran.map((row) => row.text)).toEqual(['JSR one', 'LDA #&01', 'BIT &02A9', 'STA result', 'RTS', 'JSR two']);
    expect(ran.map((row) => row.cycle)).toEqual(['cycle 11', 'cycle 17', 'cycle 19', 'cycle 23', 'cycle 26', 'cycle 32']);
  });

  it('shows the bytes as they were when the instruction ran, and flags lines memory has changed under', () => {
    const { target, labels } = traceExample();
    steps(target, 19); // into the loop: STA, INC, DEY, BNE, STA, INC
    const stores = buildDisassemblyView(target, { labels }).ran.filter((row) => row.addressHex === '&040D');
    expect(stores.map((row) => [row.bytes, row.text, row.changedSince])).toEqual([
      ['8D 28 7C', 'STA screen', true],
      ['8D 29 7C', 'STA &7C29', true],
    ]);
  });

  it('shows an interrupt step as the interrupt, at the address it struck', () => {
    const { target, labels } = traceExample();
    target.cpu.regs.i = false;
    target.ringIrq();
    target.step();
    expect(buildDisassemblyView(target, { labels }).ran).toEqual([
      { addressHex: '&0400', label: 'start', bytes: '', text: 'IRQ (via &FFFE)', cycle: 'cycle 7', changedSince: false },
    ]);
  });
});

describe('the interrupt note', () => {
  it("is empty when the next step is the ▶ instruction", () => {
    const { target, labels } = traceExample();
    expect(buildDisassemblyView(target, { labels }).interrupt).toBeUndefined();
  });

  it('warns when the next step is an IRQ or NMI instead', () => {
    const { target, labels } = traceExample();
    target.pulseNmi();
    expect(buildDisassemblyView(target, { labels }).interrupt).toBe('Next step is an NMI (via &FFFA), not the ▶ line: it runs after the handler returns.');
  });
});
