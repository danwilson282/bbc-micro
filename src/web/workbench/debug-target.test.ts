import { TestBus } from '../../memory/test-bus';
import { playgroundTarget } from './debug-target';

const NOP = 0xea;

/** The playground with NOPs at &0400, handlers at &0600 (NMI) and &0700 (IRQ), reset with I clear. */
function playground(): { target: ReturnType<typeof playgroundTarget>; bus: TestBus } {
  const bus = new TestBus();
  bus.load(0xfffa, [0x00, 0x06, 0x00, 0x04, 0x00, 0x07]);
  bus.load(0x0400, [NOP, NOP, NOP]);
  const target = playgroundTarget(bus);
  target.reset();
  target.cpu.regs.i = false;
  return { target, bus };
}

describe('the playground target: interrupt buttons', () => {
  it('IRQ rings the doorbell, which holds the CPU IRQ line, so the next step enters the handler', () => {
    const { target } = playground();
    expect(target.irqLine).toBe(false);
    target.ringIrq();
    expect(target.irqLine).toBe(true);
    expect(target.pendingInterrupt).toBe('irq');
    expect(target.step()).toBe(7);
    expect(target.registers.pc).toBe(0x0700);
  });

  it('the line stays held until the CPU writes to &FC00, and drops straight after that step', () => {
    const { target, bus } = playground();
    bus.load(0x0700, [0x8d, 0x00, 0xfc]); // STA &FC00: answer the doorbell
    target.ringIrq();
    target.step(); // into the handler
    expect(target.irqLine).toBe(true);
    target.step(); // STA &FC00
    expect(target.irqLine).toBe(false);
    expect(target.writes.recorded()).toContainEqual({ address: 0xfc00, value: 0x00 });
  });

  it('a debugger poke to &FC00 goes past the doorbell to memory, and does not answer it', () => {
    const { target } = playground();
    target.ringIrq();
    target.poke(0xfc00, 0x00);
    target.step();
    expect(target.irqLine).toBe(true);
  });

  it('NMI is one pulse: the latch is set, the line is released, and one NMI is taken', () => {
    const { target } = playground();
    target.pulseNmi();
    expect(target.nmiPending).toBe(true);
    expect(target.pendingInterrupt).toBe('nmi');
    expect(target.step()).toBe(7);
    expect(target.registers.pc).toBe(0x0600);
    expect(target.nmiPending).toBe(false);
  });

  it('reset quiets the doorbell and clears a latched NMI', () => {
    const { target } = playground();
    target.ringIrq();
    target.pulseNmi();
    target.reset();
    expect(target.irqLine).toBe(false);
    expect(target.nmiPending).toBe(false);
    expect(target.pendingInterrupt).toBeUndefined();
  });
});

describe('the playground target: trace', () => {
  it('records every step before it runs, through peek, so the trace lists what ran in order', () => {
    const { target } = playground();
    target.step();
    target.step();
    expect(target.trace.recent(10).map((e) => [e.kind, e.pc])).toEqual([
      ['instruction', 0x0400],
      ['instruction', 0x0401],
    ]);
  });

  it('records an interrupt step as an interrupt', () => {
    const { target } = playground();
    target.ringIrq();
    target.step();
    expect(target.trace.recent(1)[0]).toMatchObject({ kind: 'irq', pc: 0x0400 });
  });

  it('reset starts a fresh trace', () => {
    const { target } = playground();
    target.step();
    target.reset();
    expect(target.trace.recorded).toBe(0);
  });
});
