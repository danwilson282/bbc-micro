import { TestBus } from '../../memory/test-bus';
import { playgroundTarget } from './debug-target';
import { buildInterruptsView } from './interrupts-view-model';

/** A playground with vectors NMI → &0430, RESET → &0400, IRQ/BRK → &040F, reset (so I = 1). */
function playground(): ReturnType<typeof playgroundTarget> {
  const bus = new TestBus();
  bus.load(0xfffa, [0x30, 0x04, 0x00, 0x04, 0x0f, 0x04]);
  bus.load(0x0400, [0xea]);
  const target = playgroundTarget(bus);
  target.reset();
  return target;
}

describe('buildInterruptsView', () => {
  it('lists the three vectors at the top of memory, and where each points', () => {
    expect(buildInterruptsView(playground()).vectors).toEqual([
      { address: '&FFFA', name: 'NMI', handler: '&0430' },
      { address: '&FFFC', name: 'RESET', handler: '&0400' },
      { address: '&FFFE', name: 'IRQ/BRK', handler: '&040F' },
    ]);
  });

  it('with nothing asking: the IRQ line released, the NMI latch clear, and the next step is an instruction', () => {
    const view = buildInterruptsView(playground());
    expect(view.lines).toEqual([
      { name: 'IRQ line', value: 'released', active: false },
      { name: 'I flag', value: '1: IRQs held off', active: true },
      { name: 'NMI latch', value: 'clear', active: false },
    ]);
    expect(view.verdict).toBe('Next step: an instruction. Nothing is asking.');
  });

  it('an IRQ with I set waits: nothing is lost, it is taken when I clears', () => {
    const target = playground();
    target.ringIrq();
    const view = buildInterruptsView(target);
    expect(view.lines[0]).toEqual({ name: 'IRQ line', value: 'held by the doorbell at &FC00', active: true });
    expect(view.verdict).toBe('IRQ waiting: I = 1 holds it off until CLI or RTI clears I.');
  });

  it('an IRQ with I clear is the next step', () => {
    const target = playground();
    target.cpu.regs.i = false;
    target.ringIrq();
    const view = buildInterruptsView(target);
    expect(view.lines[1]).toEqual({ name: 'I flag', value: '0: IRQs allowed', active: false });
    expect(view.verdict).toBe('Next step: IRQ → &040F. The handler must answer the doorbell, or it will be back.');
  });

  it('a latched NMI is the next step whatever I says, and wins over an IRQ', () => {
    const target = playground();
    target.ringIrq();
    target.pulseNmi();
    const view = buildInterruptsView(target);
    expect(view.lines[2]).toEqual({ name: 'NMI latch', value: 'set: an edge was seen', active: true });
    expect(view.verdict).toBe('Next step: NMI → &0430. I can’t hold it off.');
  });
});
