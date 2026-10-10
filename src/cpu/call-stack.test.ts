import { assemble } from '../asm/assembler';
import { TestBus } from '../memory/test-bus';
import { CallStack } from './call-stack';
import { Cpu6502 } from './cpu6502';

interface Rig {
  readonly cpu: Cpu6502;
  readonly bus: TestBus;
  readonly calls: CallStack;
  readonly symbols: ReadonlyMap<string, number>;
}

function rigWith(source: string): Rig {
  const assembly = assemble(source);
  if (!assembly.ok) throw new Error(assembly.errors.map((e) => e.message).join('\n'));
  const bus = new TestBus();
  for (const line of assembly.lines) bus.load(line.address, line.bytes);
  const cpu = new Cpu6502(bus);
  cpu.regs.pc = assembly.entry ?? 0;
  return { cpu, bus, calls: new CallStack((a) => bus.peek(a)), symbols: assembly.symbols };
}

/** Steps with the call stack watching, until PC reaches `stop`. */
function runTo(rig: Rig, stop: string): void {
  const target = rig.symbols.get(stop);
  if (target === undefined) throw new Error(`no label ${stop}`);
  for (let i = 0; i < 1000 && rig.cpu.regs.pc !== target; i++) {
    rig.calls.before(rig.cpu);
    rig.cpu.step();
    rig.calls.after(rig.cpu);
  }
  if (rig.cpu.regs.pc !== target) throw new Error(`never reached ${stop}`);
}

const NESTED = `
        *= &0400
        LDX #&FF
        TXS
        JSR outer       ; &0403
done:   JMP done        ; &0406
outer:  JSR inner       ; &0409
back:   RTS             ; &040C
inner:  NOP             ; &040D
        RTS
`;

describe('CallStack', () => {
  test('each JSR pushes a frame: where it was called from, where it went, and S after the push', () => {
    const rig = rigWith(NESTED);
    runTo(rig, 'inner');
    expect(rig.calls.frames()).toEqual([
      { kind: 'jsr', from: 0x0403, to: 0x0409, s: 0xfd },
      { kind: 'jsr', from: 0x0409, to: 0x040d, s: 0xfb },
    ]);
  });

  test('RTS pops the frame: S rises above the value saved with it', () => {
    const rig = rigWith(NESTED);
    runTo(rig, 'back');
    expect(rig.calls.frames().map((f) => f.to)).toEqual([0x0409]);
    runTo(rig, 'done');
    expect(rig.calls.frames()).toEqual([]);
  });

  test('PLA PLA throws a return address away, and its frame goes with it', () => {
    const rig = rigWith(`
        *= &0400
        LDX #&FF
        TXS
        JSR sub
        NOP
        BRK
sub:    PLA             ; drop our own return address ...
        PLA
        JMP away        ; ... and leave by JMP instead of RTS
away:   NOP
`);
    runTo(rig, 'sub');
    expect(rig.calls.depth).toBe(1);
    runTo(rig, 'away');
    expect(rig.calls.depth).toBe(0);
  });

  test('TXS resetting the stack pops every frame', () => {
    const rig = rigWith(`
        *= &0400
        LDX #&FF
        TXS
        JSR one
one:    JSR two
two:    LDX #&FF
        TXS
reset:  NOP
`);
    runTo(rig, 'two');
    expect(rig.calls.depth).toBe(2);
    runTo(rig, 'reset');
    expect(rig.calls.depth).toBe(0);
  });

  test('an IRQ pushes a frame of kind irq (3 bytes pushed), and RTI pops it', () => {
    const rig = rigWith(`
        *= &0400
        LDX #&FF
        TXS
        CLI
strike: NOP             ; &0404: the IRQ is taken before this runs
after:  NOP
        *= &0500
handler: RTI
        *= &FFFE
        .word handler
`);
    runTo(rig, 'strike');
    rig.cpu.irq = true;
    runTo(rig, 'handler');
    expect(rig.calls.frames()).toEqual([{ kind: 'irq', from: 0x0404, to: 0x0500, s: 0xfc }]);
    rig.cpu.irq = false; // the device has been serviced
    runTo(rig, 'after');
    expect(rig.calls.depth).toBe(0);
  });

  test('BRK pushes a frame of kind brk', () => {
    const rig = rigWith(`
        *= &0400
        LDX #&FF
        TXS
        BRK
        *= &0500
handler: NOP
        *= &FFFE
        .word handler
`);
    runTo(rig, 'handler');
    expect(rig.calls.frames()).toEqual([{ kind: 'brk', from: 0x0403, to: 0x0500, s: 0xfc }]);
  });

  test('a stack overflow (S wrapping past &00) looks like S rising: the frames are lost and counting starts again', () => {
    const rig = rigWith(`
        *= &0400
        LDX #&FF
        TXS
again:  JSR again
`);
    // 127 JSRs take S from &FF down to &01. The 128th wraps it to &FF.
    for (let i = 0; i < 2 + 130; i++) {
      rig.calls.before(rig.cpu);
      rig.cpu.step();
      rig.calls.after(rig.cpu);
    }
    expect(rig.cpu.regs.s).toBe(0xfb);
    expect(rig.calls.depth).toBe(3); // JSRs 128, 129 and 130
  });

  test('clear() empties it', () => {
    const rig = rigWith(NESTED);
    runTo(rig, 'inner');
    rig.calls.clear();
    expect(rig.calls.frames()).toEqual([]);
  });
});
