import { IRQ_VECTOR, RESET_VECTOR } from '../cpu/cpu6502';
import { describeHardwareWrite } from '../devices/hardware-log';
import { Via6522 } from '../devices/via6522';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { DOORBELL, Doorbell } from '../playground/doorbell';
import { MosRunner } from '../mos/mos-runner';
import { mode7StartAddress, mode7Text } from '../video/mode7-text';
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

describe('BbcModelB: the System VIA\'s pins, the IC32 latch and the keyboard (Stage 28)', () => {
  it('at power-on PB0-PB3 float high (&F: address 7, data 1), so latch bit 7 is set before any instruction runs', () => {
    const m = new BbcModelB();
    m.powerOn();
    expect(m.latch.value).toBe(0x80);
  });

  it('DDRB = &0F, then ORB = &0B on &FE40: the pins carry address 3, data 1, and latch bit 3 is set', () => {
    const m = machineWith(JMP_LOOP);
    m.map.write(0xfe42, 0x0f); // the lines become outputs driving ORB (&00): bit 0 := 0
    m.map.write(0xfe40, 0x0b);
    expect(m.latch.bit(3)).toBe(1);
    expect(m.latch.value).toBe(0x88); // bit 7 from power-on, bit 3 now
  });

  it('a DDRB write alone moves the latch: PB0-PB3 go from floating &F to ORB\'s &0, so bit 0 (sound write enable) goes low', () => {
    const m = machineWith(JMP_LOOP);
    m.hardwareLog.clear();
    m.map.write(0xfe42, 0x0f);
    expect(m.hardwareLog.recent().map(describeHardwareWrite)).toEqual(['latch: sound WE on (bit 0 = 0)']);
  });

  it('the keyboard answers on PA7: with the link on column 9 closed and autoscan off, key &09 reads &89', () => {
    const m = machineWith(JMP_LOOP);
    m.keyboard.links = 0xfe;
    m.map.write(0xfe42, 0x0f);
    m.map.write(0xfe40, 0x03); // latch bit 3 := 0: autoscan off
    m.map.write(0xfe43, 0x7f); // DDRA: PA7 an input
    m.map.write(0xfe4f, 0x09);
    expect(m.map.read(0xfe4f)).toBe(0x89);
    m.map.write(0xfe4f, 0x08); // the link on column 8 is open
    expect(m.map.read(0xfe4f)).toBe(0x08);
  });

  it('no real key is down: SHIFT (&00) and CTRL (&01) read with PA7 low, where Stage 27 read them "down"', () => {
    const m = machineWith(JMP_LOOP);
    m.map.write(0xfe42, 0x0f);
    m.map.write(0xfe40, 0x03);
    m.map.write(0xfe43, 0x7f);
    m.map.write(0xfe4f, 0x00);
    expect(m.map.read(0xfe4f)).toBe(0x00);
    m.map.write(0xfe4f, 0x01);
    expect(m.map.read(0xfe4f)).toBe(0x01);
  });

  it('with autoscan on (&0B: latch bit 3 = 1) the keyboard isn\'t answering the CPU: even a closed link reads PA7 low', () => {
    const m = machineWith(JMP_LOOP);
    m.keyboard.links = 0xfe;
    m.map.write(0xfe42, 0x0f);
    m.map.write(0xfe43, 0x7f);
    m.map.write(0xfe4f, 0x09);
    m.map.write(0xfe40, 0x0b);
    expect(m.map.read(0xfe4f)).toBe(0x09);
    m.map.write(0xfe40, 0x03); // autoscan off: now it answers
    expect(m.map.read(0xfe4f)).toBe(0x89);
  });

  it('the keyboard drives only PA7: a line someone else pulls low (a VIA panel button) stays low', () => {
    const m = machineWith(JMP_LOOP);
    m.systemVia.setOutside('a', 0xfe); // PA0 pulled low
    m.map.write(0xfe43, 0x00);
    expect(m.systemVia.outside('a')).toBe(0x7e); // PA0 still pulled; PA7 low from the keyboard
  });

  it('the CRTC and Video ULA slots hold the stubs: &FE00/&FE01 and &FE20/&FE21 writes are kept and logged with the cycle count', () => {
    const m = machineWith([0xa9, 0x00, 0x8d, 0x00, 0xfe, 0xa9, 0x3f, 0x8d, 0x01, 0xfe, 0xa9, 0x4b, 0x8d, 0x20, 0xfe, ...JMP_LOOP.map((b, i) => (i === 1 ? 0x0f : b))]);
    // LDA #0 : STA &FE00 : LDA #&3F : STA &FE01 : LDA #&4B : STA &FE20 : JMP &040F
    m.hardwareLog.clear();
    const start = m.cycles;
    for (let i = 0; i < 6; i++) m.step();
    expect(m.map.devices.crtc).toBe(m.crtc);
    expect(m.map.devices.videoUla).toBe(m.videoUla);
    expect(m.crtc.register(0)).toBe(0x3f);
    expect(m.videoUla.control).toBe(0x4b);
    expect(m.hardwareLog.recent().map((w) => [w.cycles - start, describeHardwareWrite(w)])).toEqual([
      [8, 'CRTC R0=&3F (horizontal total)'], // LDA 2 + STA 4 + LDA 2: the STA &FE01 starts at cycle 8
      [14, 'ULA ctrl=&4B'],
    ]);
  });

  it('the Video ULA is write-only: reading &FE20 sees the floating bus', () => {
    const m = machineWith([0xad, 0x20, 0xfe, ...JMP_LOOP.map((b, i) => (i === 1 ? 0x03 : b))]); // LDA &FE20
    m.step();
    expect(m.registers.a).toBe(0xfe); // the operand's high byte, the last thing on the bus
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

  withRoms('roms/os12.rom')('sees a power-on (IER read &80), measures 32K, and sets the System VIA up: ACR &60, PCR &04, IER &F2 then &F3', () => {
    const m = booted(25);
    expect(m.peek(0x028d)).toBe(1); // last BREAK type: power-on
    expect(m.peek(0x028e)).toBe(0x80); // 32K
    // &F2 at &DA82; then the keyboard code at &EEE2 finds no key down and adds CA2 (a keypress wakes it): &F3.
    expect([m.peek(SYSTEM_VIA_IER), m.peek(0xfe4b), m.peek(0xfe4c)]).toEqual([0xf3, 0x60, 0x04]);
  });

  withRoms('roms/os12.rom')('reads the keyboard links into &028F: all open (the stub\'s default) is &FF, so MODE 7', () => {
    const m = booted(40);
    expect(m.peek(0x028f)).toBe(0xff);
    expect(m.peek(0x0355)).toBe(7); // the current MODE
  });

  withRoms('roms/os12.rom')('closing the links on columns 9 and 8 (links &FC) makes the MOS start in MODE 4', () => {
    const m = booted(40, (machine) => {
      machine.keyboard.links = 0xfc;
    });
    expect(m.peek(0x028f)).toBe(0xfc);
    expect(m.peek(0x0355)).toBe(4);
  });

  withRoms('roms/os12.rom')('sets MODE 7 up on the stubs: Video ULA control &4B (or &4A: bit 0 flashes with vsync), CRTC R0 = &3F (64 characters a line), R1 = &28 (40 shown), start address &2800', () => {
    const m = booted(40);
    expect(m.videoUla.control & 0xfe).toBe(0x4a);
    expect(m.crtc.registers().slice(0, 2)).toEqual([0x3f, 0x28]);
    expect([m.crtc.register(12), m.crtc.register(13)]).toEqual([0x28, 0x00]);
  });

  withRoms('roms/os12.rom')('names it all in the hardware log, starting with the latch bit 7 that PB3-PB0 floating high set at power-on', () => {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    m.hardwareLog.clear();
    m.powerOn();
    for (let i = 0; i < 40; i++) m.runFrame();
    const text = m.hardwareLog.recent().map(describeHardwareWrite);
    expect(text[0]).toBe('latch: Shift Lock LED off (bit 7 = 1)');
    expect(text).toContain('ULA ctrl=&4B');
    expect(text).toContain('CRTC R0=&3F (horizontal total)');
    expect(text).toContain('latch: keyboard autoscan on (bit 3 = 1)');
  });

  withRoms('roms/os12.rom')('leaves the latch as the MOS wants it: &AF, sound off, autoscan on, Caps Lock LED on, MODE 7\'s screen size', () => {
    const m = booted(40);
    expect(m.latch.value).toBe(0xaf);
  });

  withRoms('roms/os12.rom')('a BREAK after that is not a power-on (the VIAs kept their IER), and with CTRL not held it\'s a soft BREAK', () => {
    const m = booted(25);
    m.reset();
    for (let i = 0; i < 25; i++) m.runFrame();
    expect(m.peek(0x028d)).toBe(0); // soft BREAK (Stage 27, with PA7 floating, saw 2: CTRL+BREAK)
  });

  withRoms('roms/os12.rom', 'roms/basic2.rom')('boots to the BASIC prompt: "BBC Computer 32K", "BASIC" and ">" in MODE 7 screen memory at &7C00', () => {
    const m = booted(50);
    const screen = mode7Text((a) => m.peek(a)).map((row) => row.trimEnd());
    expect(screen.slice(0, 7)).toEqual(['', 'BBC Computer 32K', '', 'BASIC', '', '>', '']);
  });

  withRoms('roms/os12.rom', 'roms/basic2.rom')('ends up waiting for a key: no IRQ storm, nobody holding /IRQ between interrupts', () => {
    const m = booted(50);
    const runner = new MosRunner(m);
    runner.clear();
    const result = runner.runUntilStall(200 * CYCLES_PER_FRAME);
    expect(result.kind).toBe('stall');
    expect(result.loop).toContain(0xdee6); // rdchWait
    // Most of the time is spent in BASIC's wait, not the handler: well under 1 IRQ per 100 steps.
    const entries = m.trace.recent(m.trace.length);
    expect(entries.filter((e) => e.kind === 'irq').length).toBeLessThan(entries.length / 100);
  });

  withRoms('roms/os12.rom')('the MOS asks the ACIA first on every IRQ, gets status &02 (bit 7 = 0), and sets its control to &56: both ACIA interrupts off', () => {
    const m = booted(25);
    expect(m.acia.control).toBe(0x56);
    expect(m.map.ioLog.recent().some((a) => a.address === 0xfe08 && !a.write && a.value === 0x02)).toBe(true);
  });

  withRoms('roms/os12.rom')('vsync: every falling edge on CA1 is counted down at &0240, 50 a second', () => {
    const m = booted(25);
    const before = m.peek(0x0240);
    const pulses = m.vsync.pulses;
    for (let i = 0; i < 10; i++) m.runFrame();
    expect(m.vsync.pulses - pulses).toBe(10);
    expect((before - m.peek(0x0240)) & 0xff).toBe(10);
  });

  withRoms('roms/os12.rom')('without vsync the boot still finishes (the clock is Timer 1), but &0240 never moves', () => {
    const m = booted(25, (machine) => {
      machine.vsync.enabled = false;
    });
    const before = m.peek(0x0240);
    for (let i = 0; i < 10; i++) m.runFrame();
    expect(m.peek(0x0240)).toBe(before);
    expect(m.peek(0x0355)).toBe(7);
  });

  /** Runs *FX19 (OSBYTE &13: wait for vsync) from &0900, then INC &70 and loop. Returns &70 after `frames`. */
  function fx19(m: BbcModelB, frames: number): number {
    // LDA #&13 : JSR OSBYTE : INC &70 : JMP &0907
    [0xa9, 0x13, 0x20, 0xf4, 0xff, 0xe6, 0x70, 0x4c, 0x07, 0x09].forEach((b, i) => {
      m.poke(0x0900 + i, b);
    });
    m.poke(0x70, 0);
    m.cpu.regs.pc = 0x0900;
    for (let i = 0; i < frames; i++) m.runFrame();
    return m.peek(0x70);
  }

  withRoms('roms/os12.rom')('*FX19 (OSBYTE &13, wait for vsync) returns within a frame when vsync is there', () => {
    expect(fx19(booted(25), 2)).toBe(1);
  });

  withRoms('roms/os12.rom')('*FX19 never returns without vsync: the MOS loops at &E9B9-&E9BE waiting for &0240 to change', () => {
    const m = booted(25, (machine) => {
      machine.vsync.enabled = false;
    });
    expect(fx19(m, 50)).toBe(0);
    const loop = m.trace.recent(m.trace.length).map((e) => e.pc).filter((pc) => pc >= 0xe9b6 && pc <= 0xe9be);
    expect(loop.length).toBeGreaterThan(0);
  });

  withRoms('roms/os12.rom')('flashing: every 25 vsyncs the MOS flips the Video ULA\'s flash bit (control bit 0), &4B ↔ &4A', () => {
    const m = booted(25);
    m.hardwareLog.clear();
    for (let i = 0; i < 100; i++) m.runFrame();
    const flashes = m.hardwareLog.recent().filter((w) => w.device === 'ulaControl').map((w) => w.value);
    expect(flashes).toHaveLength(4);
    expect(new Set(flashes)).toEqual(new Set([0x4a, 0x4b]));
  });
  withRoms('roms/os12.rom', 'roms/basic2.rom')('scrolling MODE 7 moves the CRTC start address, not the bytes: R12/R13 then agree with the MOS\'s own screen top at &350/&351 (Stage 30)', () => {
    const m = booted(50);
    // LDX #n / loop: LDA #10 / JSR OSWRCH / DEX / BNE loop / spin: JMP spin. n line feeds.
    const lineFeeds = (n: number): void => {
      [0xa2, n, 0xa9, 0x0a, 0x20, 0xee, 0xff, 0xca, 0xd0, 0xf8, 0x4c, 0x0a, 0x09].forEach((b, i) => {
        m.poke(0x0900 + i, b);
      });
      m.cpu.regs.pc = 0x0900;
      for (let i = 0; i < 25; i++) m.runFrame();
    };
    const screenTop = (): number => m.peek(0x0350) | (m.peek(0x0351) << 8);
    const start = (): number => mode7StartAddress(m.crtc.register(12), m.crtc.register(13));

    // The cursor is on the ">" row (5). 20 line feeds take it to "row 25": one scroll, of 40 bytes.
    lineFeeds(20);
    expect(start()).toBe(0x7c28);
    expect(start()).toBe(screenTop());
    // Followed properly, everything has moved up a row: the banner is now on row 0.
    expect(mode7Text((a) => m.peek(a), start()).slice(0, 5).map((row) => row.trimEnd())).toEqual(['BBC Computer 32K', '', 'BASIC', '', '>']);
    // The bytes didn't move: read from &7C00, as Stage 29 did, and the banner seems still to be on row 1.
    expect(mode7Text((a) => m.peek(a))[1]?.trimEnd()).toBe('BBC Computer 32K');

    // Ten more: the start keeps moving on, and the MOS agrees (&7C00 + 11 × 40 = &7DB8).
    lineFeeds(10);
    expect(start()).toBe(0x7db8);
    expect(start()).toBe(screenTop());
  });
});
