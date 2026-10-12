import { BbcMemoryMap } from '../../memory/bbc-memory-map';
import { TestBus } from '../../memory/test-bus';
import { IFR_CA1, IFR_T1, VIA_IER, VIA_IFR, VIA_T1C_H, VIA_T1C_L, Via6522 } from '../../devices/via6522';
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

describe('the playground target: clocked devices (Stage 25)', () => {
  /** A device that adds up the CPU cycles it has been ticked by. */
  function counter(): { tick(cycles: number): void; total: number } {
    return {
      total: 0,
      tick(cycles: number) {
        this.total += cycles;
      },
    };
  }

  it('after each step, every clocked device is ticked by the cycles that step took', () => {
    const bus = new TestBus();
    bus.load(0xfffc, [0x00, 0x04]);
    bus.load(0x0400, [NOP, 0xad, 0x00, 0x20]); // NOP (2 cycles), LDA &2000 (4 cycles)
    const a = counter();
    const b = counter();
    const target = playgroundTarget(bus, 'test', [a, b]);
    target.reset();
    a.total = 0;
    b.total = 0;
    expect(target.step()).toBe(2);
    expect(target.step()).toBe(4);
    expect(a.total).toBe(6);
    expect(b.total).toBe(6);
  });

  it('reset ticks them too: its 7 cycles are real time', () => {
    const bus = new TestBus();
    const a = counter();
    const target = playgroundTarget(bus, 'test', [a]);
    expect(target.reset()).toBe(7);
    expect(a.total).toBe(7);
  });
});

describe('the playground target: VIA interrupts (Stage 26)', () => {
  /** The playground with a real VIA ticked and wired to the IRQ line, I clear. */
  function withVia(): { target: ReturnType<typeof playgroundTarget>; via: Via6522; bus: TestBus } {
    const bus = new TestBus();
    bus.load(0xfffa, [0x00, 0x06, 0x00, 0x04, 0x00, 0x07]);
    bus.load(0x0400, [NOP, NOP, NOP, NOP, NOP, NOP, NOP, NOP]);
    const via = new Via6522();
    const target = playgroundTarget(bus, 'test', [via], [{ name: 'User VIA', source: via }]);
    target.reset();
    target.cpu.regs.i = false;
    return { target, via, bus };
  }

  it('a flag that is set but not enabled does not reach the CPU', () => {
    const { target, via } = withVia();
    via.setControlLine('ca1', 0);
    expect(target.irqLine).toBe(false);
    expect(target.pendingInterrupt).toBeUndefined();
  });

  it("an enabled flag pulls the CPU's IRQ line low, and the next step enters the handler", () => {
    const { target, via } = withVia();
    via.write(VIA_IER, 0x80 | IFR_CA1);
    via.setControlLine('ca1', 0);
    expect(target.irqLine).toBe(true);
    expect(target.irqHolders).toEqual(['User VIA']);
    expect(target.pendingInterrupt).toBe('irq');
    expect(target.step()).toBe(7);
    expect(target.registers.pc).toBe(0x0700);
  });

  it('a timer that runs out during a step raises IRQ after that step', () => {
    const { target, via } = withVia();
    via.write(VIA_IER, 0x80 | IFR_T1);
    via.write(VIA_T1C_L, 0);
    via.write(VIA_T1C_H, 0); // load 0, then 0 → &FFFF: 2 VIA cycles = 4 CPU cycles
    target.step(); // NOP: 2 CPU cycles, the load
    expect(target.irqLine).toBe(false);
    target.step(); // NOP: the timeout
    expect(target.irqLine).toBe(true);
    expect(target.pendingInterrupt).toBe('irq');
  });

  it('the line is a wire-OR: it stays low while the doorbell OR the VIA holds it', () => {
    const { target, via } = withVia();
    via.write(VIA_IER, 0x80 | IFR_CA1);
    via.setControlLine('ca1', 0);
    target.ringIrq();
    expect(target.irqHolders).toEqual(['the doorbell', 'User VIA']);
    via.write(VIA_IFR, IFR_CA1); // the VIA lets go …
    expect(target.irqLine).toBe(true); // … but the doorbell still holds it
    expect(target.irqHolders).toEqual(['the doorbell']);
  });

  it('the handler acknowledges the VIA with STA &FE6D, and the line is released after that step', () => {
    const userVia = new Via6522();
    const map = new BbcMemoryMap({ devices: { userVia } });
    map.poke(0xfffe, 0x00); // IRQ vector → &0700 (poke: it's the MOS ROM's space)
    map.poke(0xffff, 0x07);
    for (const [i, byte] of [0xa9, IFR_CA1, 0x8d, 0x6d, 0xfe].entries()) map.poke(0x0700 + i, byte); // LDA #&02, STA &FE6D
    const target = playgroundTarget(map, 'test', [userVia], [{ name: 'User VIA', source: userVia }]);
    target.cpu.regs.pc = 0x0400;
    target.cpu.regs.i = false;
    userVia.write(VIA_IER, 0x80 | IFR_CA1);
    userVia.setControlLine('ca1', 0);
    target.step(); // into the handler (I = 1 now)
    target.step(); // LDA #&02
    expect(target.irqLine).toBe(true);
    target.step(); // STA &FE6D: a 1 in bit 1 clears CA1
    expect(target.irqLine).toBe(false);
    expect(target.registers.pc).toBe(0x0705);
  });
});
