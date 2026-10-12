import { IRQ_VECTOR, RESET_VECTOR } from '../cpu/cpu6502';
import { Via6522 } from '../devices/via6522';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { DOORBELL, Doorbell } from '../playground/doorbell';
import { BbcModelB, CYCLES_PER_FRAME } from './bbc-model-b';

const SYSTEM_VIA_IER = 0xfe4e;
const SYSTEM_VIA_IFR = 0xfe4d;
const USER_VIA_IER = 0xfe6e;
const USER_VIA_IFR = 0xfe6d;

/** A machine with `bytes` at &0400 and the reset vector pointing there (poked into the MOS image). */
function machineWith(bytes: readonly number[], entry = 0x0400): BbcModelB {
  const m = new BbcModelB();
  bytes.forEach((b, i) => {
    m.poke(entry + i, b);
  });
  m.poke(RESET_VECTOR, entry & 0xff);
  m.poke(RESET_VECTOR + 1, entry >> 8);
  m.powerOn();
  return m;
}

/** JMP &0400: a 3-cycle loop. */
const JMP_LOOP = [0x4c, 0x00, 0x04];

/** A falling edge on a VIA's CA1 (PCR's default: negative edge) with CA1 enabled in IER: that VIA holds /IRQ. */
function raiseCa1(m: BbcModelB, via: Via6522, ier: number): void {
  m.map.write(ier, 0x82); // set bit 1: CA1
  via.setControlLine('ca1', 0);
}

describe('BbcModelB: what it is made of', () => {
  it('has a System VIA at &FE40 and a User VIA at &FE60 on its memory map', () => {
    const m = new BbcModelB();
    expect(m.map.devices.systemVia).toBe(m.systemVia);
    expect(m.map.devices.userVia).toBe(m.userVia);
    m.map.write(0xfe43, 0x7f); // System VIA DDRA
    expect(m.systemVia.dataDirection('a')).toBe(0x7f);
  });

  it('is self-contained: two machines share nothing', () => {
    const a = new BbcModelB();
    const b = new BbcModelB();
    a.poke(0x1234, 0x56);
    expect(b.peek(0x1234)).toBe(0x00);
    expect(a.systemVia).not.toBe(b.systemVia);
  });

  it('runs at 2 MHz with 50 frames a second: 40,000 cycles a frame', () => {
    expect(CYCLES_PER_FRAME).toBe(2_000_000 / 50);
  });
});

describe('BbcModelB: power-on and BREAK', () => {
  it('power-on resets both VIAs (IER reads &80) and runs the CPU reset: 7 cycles, PC from &FFFC', () => {
    const m = machineWith(JMP_LOOP);
    m.map.write(SYSTEM_VIA_IER, 0xf2);
    m.map.write(USER_VIA_IER, 0xc0);
    m.step();
    expect(m.powerOn()).toBe(7);
    expect(m.registers.pc).toBe(0x0400);
    expect(m.registers.i).toBe(true);
    expect([m.peek(SYSTEM_VIA_IER), m.peek(USER_VIA_IER)]).toEqual([0x80, 0x80]);
  });

  it('BREAK (reset) resets only the CPU: the VIAs keep IER, so the MOS can tell it from a power-on', () => {
    const m = machineWith(JMP_LOOP);
    m.map.write(SYSTEM_VIA_IER, 0xf2);
    m.step();
    expect(m.reset()).toBe(7);
    expect(m.registers.pc).toBe(0x0400);
    expect(m.peek(SYSTEM_VIA_IER)).toBe(0xf2);
  });

  it('both leave RAM alone: clearing it is the MOS\'s job', () => {
    const m = machineWith(JMP_LOOP);
    m.poke(0x2000, 0x99);
    m.powerOn();
    m.reset();
    expect(m.peek(0x2000)).toBe(0x99);
  });

  it('both reset the 1 MHz bus cards (the doorbell goes quiet), and start the trace again', () => {
    const m = machineWith(JMP_LOOP);
    const bell = new Doorbell(m.map);
    m.plugIn(bell);
    bell.ring();
    m.step();
    m.reset();
    expect(bell.ringing).toBe(false);
    expect(m.trace.recorded).toBe(0);
    bell.ring();
    m.powerOn();
    expect(bell.ringing).toBe(false);
  });

  it('the reset sequence\'s 7 cycles pass for the VIAs too', () => {
    const m = new BbcModelB();
    const lone = new Via6522();
    for (const via of [m.systemVia, lone]) {
      via.write(0x4, 0x00); // T1C-L: &1000
      via.write(0x5, 0x10); // T1C-H: loads the counter, starts T1
    }
    m.reset();
    lone.tick(7);
    expect(m.systemVia.timers().t1.counter).toBe(lone.timers().t1.counter);
  });
});

describe('BbcModelB: one step', () => {
  it('ticks both VIAs by the cycles the instruction took, so T1 counts down as a lone VIA ticked the same way would', () => {
    // LDA #1 (2), INC &70 (5), NOP (2), JMP &0400 (3): odd and even lengths, so the 1 MHz half-cycles matter.
    const m = machineWith([0xa9, 0x01, 0xe6, 0x70, 0xea, ...JMP_LOOP]);
    const lone = new Via6522();
    lone.tick(7); // the machine's VIAs have seen the reset's 7 cycles: half a 1 MHz cycle is carried
    for (const via of [m.systemVia, m.userVia, lone]) {
      via.write(0x4, 0xff);
      via.write(0x5, 0xff);
    }
    for (let i = 0; i < 25; i++) lone.tick(m.step());
    expect(m.systemVia.timers().t1.counter).toBe(lone.timers().t1.counter);
    expect(m.userVia.timers().t1.counter).toBe(lone.timers().t1.counter);
    expect(lone.timers().t1.counter).toBeLessThan(0xffff - 30);
  });

  it('records each step in the trace before it runs, and notes the CPU\'s writes', () => {
    const m = machineWith([0xa9, 0x42, 0x85, 0x70, ...JMP_LOOP]); // LDA #&42 : STA &70
    m.step();
    m.step();
    expect(m.trace.recent(2).map((e) => e.pc)).toEqual([0x0400, 0x0402]);
    expect(m.writes.recorded()).toEqual([{ address: 0x70, value: 0x42 }]);
  });

  it('peek has no side effects: peeking T1C-L at &FE44 leaves IFR bit 6 set', () => {
    const m = new BbcModelB();
    m.map.write(0xfe44, 0x01);
    m.map.write(0xfe45, 0x00);
    for (let i = 0; i < 10; i++) m.systemVia.tick(2);
    expect(m.peek(SYSTEM_VIA_IFR) & 0x40).toBe(0x40);
    m.peek(0xfe44);
    expect(m.peek(SYSTEM_VIA_IFR) & 0x40).toBe(0x40);
  });
});

describe('BbcModelB: the /IRQ line is a wire-OR', () => {
  it('is released (high) while no device holds it', () => {
    const m = machineWith(JMP_LOOP);
    expect(m.irqLine).toBe(false);
    expect(m.irqHolders).toEqual([]);
  });

  it('is held low by the System VIA alone, the User VIA alone, a 1 MHz bus card alone, or any mix', () => {
    const m = machineWith(JMP_LOOP);
    const bell = new Doorbell(m.map);
    m.plugIn(bell);
    raiseCa1(m, m.systemVia, SYSTEM_VIA_IER);
    expect([m.irqLine, m.irqHolders]).toEqual([true, ['System VIA']]);
    raiseCa1(m, m.userVia, USER_VIA_IER);
    bell.ring();
    expect([m.irqLine, m.irqHolders]).toEqual([true, ['System VIA', 'User VIA', 'the doorbell']]);
  });

  it('acknowledging one VIA doesn\'t release the line while the other still holds it', () => {
    const m = machineWith(JMP_LOOP);
    raiseCa1(m, m.systemVia, SYSTEM_VIA_IER);
    raiseCa1(m, m.userVia, USER_VIA_IER);
    m.map.write(SYSTEM_VIA_IFR, 0x02); // acknowledge the System VIA's CA1
    expect([m.irqLine, m.irqHolders]).toEqual([true, ['User VIA']]);
    m.map.write(USER_VIA_IFR, 0x02);
    expect([m.irqLine, m.irqHolders]).toEqual([false, []]);
  });

  it('is copied to the CPU\'s /IRQ pin around every step, so an IRQ is taken via &FFFE once I = 0', () => {
    const m = machineWith([0x58, 0xea, ...JMP_LOOP]); // CLI, NOP, JMP
    m.poke(IRQ_VECTOR, 0x00);
    m.poke(IRQ_VECTOR + 1, 0x05);
    raiseCa1(m, m.systemVia, SYSTEM_VIA_IER);
    expect(m.pendingInterrupt).toBeUndefined(); // I = 1 after reset
    m.step(); // CLI
    expect(m.pendingInterrupt).toBe('irq');
    expect(m.step()).toBe(7);
    expect(m.registers.pc).toBe(0x0500);
  });

  it('follows a device that lets go during a step: the doorbell answered by STA &FC00', () => {
    const m = machineWith([0x8d, DOORBELL & 0xff, DOORBELL >> 8, ...JMP_LOOP]); // STA &FC00
    const bell = new Doorbell(m.map);
    m.plugIn(bell);
    bell.ring();
    expect(m.irqLine).toBe(true);
    m.step();
    expect(m.cpu.irq).toBe(false);
  });
});

describe('BbcModelB: the frame budget', () => {
  it('runFrame() runs whole instructions until 40,000 cycles are used: the last one may overshoot', () => {
    const m = machineWith(JMP_LOOP);
    const ran = m.runFrame();
    expect(ran).toBeGreaterThanOrEqual(CYCLES_PER_FRAME);
    expect(ran).toBeLessThan(CYCLES_PER_FRAME + 3);
    expect(ran % 3).toBe(0);
  });

  it('carries the overshoot into the next call: runCycles(1) runs a 3-cycle JMP, then runCycles(1) runs nothing', () => {
    const m = machineWith(JMP_LOOP);
    expect(m.runCycles(1)).toBe(3);
    expect(m.runCycles(1)).toBe(0); // budget was -2, now -1
    expect(m.runCycles(1)).toBe(0); // now 0
    expect(m.runCycles(1)).toBe(3);
  });

  it('never drifts: after n frames of mixed 2- to 7-cycle instructions, the total is n × 40,000 plus at most 6', () => {
    // LDA &70 (3), INC &71 (5), LDA (&72),Y (5), ROL &1234,X (7), NOP (2), JMP &0400 (3)
    const m = machineWith([0xa5, 0x70, 0xe6, 0x71, 0xb1, 0x72, 0x3e, 0x34, 0x12, 0xea, ...JMP_LOOP]);
    let total = 0;
    for (let frame = 1; frame <= 50; frame++) {
      total += m.runFrame();
      const over = total - frame * CYCLES_PER_FRAME;
      expect(over).toBeGreaterThanOrEqual(0);
      expect(over).toBeLessThanOrEqual(6);
    }
    expect(m.cycles - 7).toBe(total); // the reset's 7 aren't in any frame
  });

  it('a reset starts the budget afresh: a leftover overshoot isn\'t charged to the new run', () => {
    const m = machineWith(JMP_LOOP);
    m.runCycles(1); // budget now -2
    m.reset();
    expect(m.runCycles(1)).toBe(3);
  });
});

describe('BbcModelB: with MOS 1.20', () => {
  /** A powered-on machine with the ROMs from roms/, run for some frames. */
  function booted(frames: number, setUp: (m: BbcModelB) => void = () => undefined): BbcModelB {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    setUp(m);
    m.powerOn();
    for (let i = 0; i < frames; i++) m.runFrame();
    return m;
  }

  withRoms('roms/os12.rom')('sees a power-on (IER read &80), measures 32K, and sets the System VIA up: IER &F2, ACR &60, PCR &04', () => {
    const m = booted(25);
    expect(m.peek(0x028d)).toBe(1); // last BREAK type: power-on
    expect(m.peek(0x028e)).toBe(0x80); // 32K
    expect([m.peek(SYSTEM_VIA_IER), m.peek(0xfe4b), m.peek(0xfe4c)]).toEqual([0xf2, 0x60, 0x04]);
  });

  withRoms('roms/os12.rom')('then waits with I = 1 while the System VIA\'s T1 holds /IRQ: the 100 Hz tick, unanswered', () => {
    const m = booted(75);
    expect(m.irqHolders).toEqual(['System VIA']);
    expect(m.peek(SYSTEM_VIA_IFR) & 0xc0).toBe(0xc0);
    expect(m.registers.i).toBe(true);
  });

  withRoms('roms/os12.rom')('a BREAK after that is not a power-on (the VIAs kept IER &F2); with PA7 floating, "CTRL held" makes it CTRL+BREAK', () => {
    const m = booted(25);
    m.reset();
    for (let i = 0; i < 25; i++) m.runFrame();
    expect(m.peek(0x028d)).toBe(2); // hard BREAK
  });

  withRoms('roms/os12.rom')('with PA7 held low (no key down), the same BREAK is a soft BREAK', () => {
    const m = booted(25, (machine) => {
      machine.systemVia.setOutside('a', 0x7f);
    });
    m.reset();
    for (let i = 0; i < 25; i++) m.runFrame();
    expect(m.peek(0x028d)).toBe(0); // soft BREAK
  });

  withRoms('roms/os12.rom', 'roms/basic2.rom')('experiment: with PA7 held low (no key down), it prints the banner and then storms on the floating ACIA', () => {
    const m = booted(100, (machine) => {
      machine.systemVia.setOutside('a', 0x7f);
    });
    const row = (n: number): string => {
      let text = '';
      for (let col = 0; col < 40; col++) text += String.fromCharCode(m.peek(0x7c00 + n * 40 + col) & 0x7f);
      return text.trimEnd();
    };
    expect([row(1), row(3)]).toEqual(['BBC Computer 32K', 'BASIC']);
    // The storm: every step now is inside the IRQ handler, and the System VIA still holds the line.
    expect(m.irqHolders).toEqual(['System VIA']);
    const irqs = m.trace.recent(m.trace.length).filter((e) => e.kind === 'irq').length;
    expect(irqs).toBeGreaterThan(10);
  });
});
