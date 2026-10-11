import {
  ACR_T1_FREE_RUN,
  ACR_T1_PB7_OUTPUT,
  ACR_T2_PULSE_COUNT,
  CPU_CYCLES_PER_VIA_CYCLE,
  IFR_T1,
  IFR_T2,
  VIA_ACR,
  VIA_DDRB,
  VIA_IFR,
  VIA_ORB,
  VIA_T1C_H,
  VIA_T1C_L,
  VIA_T1L_H,
  VIA_T1L_L,
  VIA_T2C_H,
  VIA_T2C_L,
  Via6522,
} from './via6522';

/** Advances the VIA by n of its own (1 MHz) cycles: 2n CPU cycles. */
function viaCycles(via: Via6522, n: number): void {
  via.tick(n * CPU_CYCLES_PER_VIA_CYCLE);
}

function t1Counter(via: Via6522): number {
  return (via.peek(VIA_T1C_H) << 8) | via.peek(VIA_T1C_L);
}

function t2Counter(via: Via6522): number {
  return (via.peek(VIA_T2C_H) << 8) | via.peek(VIA_T2C_L);
}

/**
 * Loads T1 the way a program does (low latch, then the high byte, which
 * starts it) and runs the load cycle: afterwards the counter holds N, as in
 * cycle 1 of the datasheet's timing diagram.
 */
function startT1(via: Via6522, n: number, acr: number): void {
  via.write(VIA_ACR, acr);
  via.write(VIA_T1C_L, n & 0xff);
  via.write(VIA_T1C_H, n >> 8);
  viaCycles(via, 1);
}

/** The same for T2: after this the counter holds N. */
function startT2(via: Via6522, n: number): void {
  via.write(VIA_T2C_L, n & 0xff);
  via.write(VIA_T2C_H, n >> 8);
  viaCycles(via, 1);
}

describe('Via6522 Timer 1: latches and counter', () => {
  it('writing T1C-L (reg 4) sets the low latch only: the counter is untouched', () => {
    const via = new Via6522();
    via.write(VIA_T1C_L, 0x0e);
    expect(via.read(VIA_T1L_L)).toBe(0x0e);
    expect(t1Counter(via)).toBe(0x0000);
  });

  it('writing T1C-H (reg 5) sets the high latch and copies both latches into the counter in the next cycle', () => {
    const via = new Via6522(); // power-on: counter &0000
    via.write(VIA_T1L_L, 0x0e);
    via.write(VIA_T1C_H, 0x27);
    expect(via.read(VIA_T1L_H)).toBe(0x27);
    expect(t1Counter(via)).toBe(0x0000); // the write cycle: not loaded yet
    viaCycles(via, 1);
    expect(t1Counter(via)).toBe(0x270e); // cycle 1: N
  });

  it('writing T1L-H (reg 7) sets the high latch with no transfer to the counter', () => {
    const via = new Via6522();
    via.write(VIA_T1L_L, 0x34);
    via.write(VIA_T1L_H, 0x12);
    expect(t1Counter(via)).toBe(0x0000);
    expect((via.read(VIA_T1L_H) << 8) | via.read(VIA_T1L_L)).toBe(0x1234);
  });

  it('counts down once per VIA cycle, which is every 2 CPU cycles on the 1 MHz bus; an odd CPU cycle is carried over', () => {
    const via = new Via6522();
    startT1(via, 0x1000, ACR_T1_FREE_RUN);
    via.tick(1);
    expect(t1Counter(via)).toBe(0x1000);
    via.tick(1);
    expect(t1Counter(via)).toBe(0x0fff);
    via.tick(7); // 3 VIA cycles, and 1 CPU cycle left over
    expect(t1Counter(via)).toBe(0x0ffc);
    via.tick(1);
    expect(t1Counter(via)).toBe(0x0ffb);
  });

  it('the counter never stops: with nothing armed it still rolls over and reloads, but sets no flag', () => {
    const via = new Via6522(); // power-on: counter &0000
    via.write(VIA_T1L_L, 0x34);
    via.write(VIA_T1L_H, 0x12); // latch only: T1 isn't started
    viaCycles(via, 1);
    expect(t1Counter(via)).toBe(0xffff);
    viaCycles(via, 2);
    expect(t1Counter(via)).toBe(0x1233); // reloaded &1234, then counted
    expect(via.peek(VIA_IFR)).toBe(0x00);
  });
});

describe('Via6522 Timer 1: one-shot mode (ACR bit 6 = 0)', () => {
  it('sets IFR bit 6 when the counter rolls over from &0000 to &FFFF: N+1 cycles after it first holds N (the datasheet\'s N+1.5 after the write)', () => {
    const via = new Via6522();
    startT1(via, 5, 0x00);
    viaCycles(via, 5);
    expect(t1Counter(via)).toBe(0x0000);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
    viaCycles(via, 1);
    expect(t1Counter(via)).toBe(0xffff);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
  });

  it('sets the flag only once per write of T1C-H; the counter reloads from the latch and keeps counting', () => {
    const via = new Via6522();
    startT1(via, 3, 0x00);
    viaCycles(via, 4); // 3, 2, 1, 0, &FFFF: timeout
    expect(via.read(VIA_T1C_L)).toBe(0xff); // read T1C-L: clears the flag
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
    viaCycles(via, 1);
    expect(t1Counter(via)).toBe(0x0003); // reloaded
    viaCycles(via, 4); // down to &FFFF again
    expect(t1Counter(via)).toBe(0xffff);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0); // no second flag
  });

  it('writing T1C-H again re-arms it', () => {
    const via = new Via6522();
    startT1(via, 3, 0x00);
    viaCycles(via, 4);
    via.read(VIA_T1C_L);
    via.write(VIA_T1C_H, 0x00);
    viaCycles(via, 5); // load, 3, 2, 1, 0 ... then &FFFF
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
  });
});

describe('Via6522 Timer 1: free-running mode (ACR bit 6 = 1)', () => {
  it('runs N, N-1 … 0, &FFFF, then reloads N: a period of N+2 cycles', () => {
    const via = new Via6522();
    startT1(via, 3, ACR_T1_FREE_RUN);
    const seen: number[] = [t1Counter(via)];
    for (let i = 0; i < 11; i++) {
      viaCycles(via, 1);
      seen.push(t1Counter(via));
    }
    expect(seen).toEqual([3, 2, 1, 0, 0xffff, 3, 2, 1, 0, 0xffff, 3, 2]);
  });

  it('sets IFR bit 6 at every roll-over, once the program has cleared it', () => {
    const via = new Via6522();
    startT1(via, 3, ACR_T1_FREE_RUN);
    viaCycles(via, 4);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
    via.read(VIA_T1C_L);
    viaCycles(via, 4);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
    viaCycles(via, 1);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
  });

  it("the MOS's latch &270E (9,998) gives one timeout every 10,000 µs = 20,000 CPU cycles: 100 Hz", () => {
    const via = new Via6522();
    startT1(via, 0x270e, ACR_T1_FREE_RUN);
    const timeouts: number[] = [];
    for (let cpu = 2; cpu <= 2_000_000; cpu += 2) {
      via.tick(2);
      if (via.peek(VIA_IFR) & IFR_T1) {
        timeouts.push(cpu);
        via.read(VIA_T1C_L);
      }
    }
    expect(timeouts).toHaveLength(100);
    expect(timeouts[0]).toBe((0x270e + 1) * 2); // N+1 VIA cycles from the first N to the first flag (N+2 from the write)
    expect(timeouts[1]).toBe((timeouts[0] ?? 0) + 20_000);
    expect(timeouts[99]).toBe((timeouts[0] ?? 0) + 99 * 20_000);
  });

  it('writing the latches while it runs changes the next period, not the current one', () => {
    const via = new Via6522();
    startT1(via, 5, ACR_T1_FREE_RUN);
    viaCycles(via, 2);
    via.write(VIA_T1L_L, 9);
    via.write(VIA_T1L_H, 0);
    expect(t1Counter(via)).toBe(3); // still on the old count
    viaCycles(via, 5); // 2, 1, 0, &FFFF, reload
    expect(t1Counter(via)).toBe(9);
  });
});

describe('Via6522 Timer 1: clearing IFR bit 6', () => {
  function timedOut(): Via6522 {
    const via = new Via6522();
    startT1(via, 1, 0x00);
    viaCycles(via, 2);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
    return via;
  }

  it('reading T1C-L clears it; peek (the debugger) does not', () => {
    const via = timedOut();
    via.peek(VIA_T1C_L);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
    via.read(VIA_T1C_L);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
  });

  it('reading T1C-H or the latches does not clear it', () => {
    const via = timedOut();
    via.read(VIA_T1C_H);
    via.read(VIA_T1L_L);
    via.read(VIA_T1L_H);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
  });

  it('writing T1C-H clears it', () => {
    const via = timedOut();
    via.write(VIA_T1C_H, 0x10);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
  });

  it('writing T1L-H clears it too', () => {
    const via = timedOut();
    via.write(VIA_T1L_H, 0x10);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
  });

  it('writing a 1 to IFR bit 6 clears it; writing 0s leaves it alone', () => {
    const via = timedOut();
    via.write(VIA_IFR, 0x00);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(IFR_T1);
    via.write(VIA_IFR, IFR_T1);
    expect(via.peek(VIA_IFR) & IFR_T1).toBe(0);
  });
});

describe('Via6522 Timer 1 on PB7 (ACR bit 7 = 1)', () => {
  it('one-shot: PB7 goes low when T1C-H is written and high when the timer runs out', () => {
    const via = new Via6522();
    startT1(via, 3, ACR_T1_PB7_OUTPUT);
    expect(via.pins('b') & 0x80).toBe(0);
    viaCycles(via, 3);
    expect(via.pins('b') & 0x80).toBe(0);
    viaCycles(via, 1);
    expect(via.pins('b') & 0x80).toBe(0x80);
    viaCycles(via, 10); // one-shot: it stays high
    expect(via.pins('b') & 0x80).toBe(0x80);
  });

  it('free-running: PB7 inverts at every timeout, a square wave with a period of 2(N+2) cycles', () => {
    const via = new Via6522();
    startT1(via, 3, ACR_T1_PB7_OUTPUT | ACR_T1_FREE_RUN);
    const levels: number[] = [];
    for (let i = 0; i < 12; i++) {
      viaCycles(via, 1);
      levels.push((via.pins('b') >> 7) & 1);
    }
    expect(levels).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('drives PB7 whatever DDRB bit 7 says, and IRB bit 7 reads it', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x00);
    startT1(via, 3, ACR_T1_PB7_OUTPUT);
    expect(via.read(VIA_ORB)).toBe(0x7f);
  });

  it('with ACR bit 7 = 0, PB7 is an ordinary port line again', () => {
    const via = new Via6522();
    startT1(via, 3, ACR_T1_PB7_OUTPUT);
    via.write(VIA_ACR, 0x00);
    expect(via.pins('b')).toBe(0xff);
  });
});

describe('Via6522 Timer 2 (one-shot, ACR bit 5 = 0)', () => {
  it('writing T2C-L sets the low latch only; writing T2C-H loads high byte and latch into the counter in the next cycle', () => {
    const via = new Via6522();
    via.write(VIA_T2C_L, 0x34);
    expect(t2Counter(via)).toBe(0x0000);
    via.write(VIA_T2C_H, 0x12);
    viaCycles(via, 1);
    expect(t2Counter(via)).toBe(0x1234);
  });

  it('sets IFR bit 5 on the roll-over to &FFFF, N+1 cycles after it first holds N', () => {
    const via = new Via6522();
    startT2(via, 4);
    viaCycles(via, 4);
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(0);
    viaCycles(via, 1);
    expect(t2Counter(via)).toBe(0xffff);
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(IFR_T2);
  });

  it("doesn't reload: it carries on down from &FFFF, so you can see how long ago it ran out", () => {
    const via = new Via6522();
    startT2(via, 2);
    viaCycles(via, 3 + 10);
    expect(t2Counter(via)).toBe(0xfff5);
  });

  it('flags once: a second wrap through zero sets nothing until T2C-H is written again', () => {
    const via = new Via6522();
    startT2(via, 0);
    viaCycles(via, 1);
    via.read(VIA_T2C_L);
    viaCycles(via, 0x10000);
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(0);
    via.write(VIA_T2C_H, 0x00);
    viaCycles(via, 2); // load &0000, then &FFFF
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(IFR_T2);
  });

  it('reading T2C-L clears IFR bit 5 (peek does not); writing T2C-H clears it too', () => {
    const via = new Via6522();
    startT2(via, 0);
    viaCycles(via, 1);
    via.peek(VIA_T2C_L);
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(IFR_T2);
    via.read(VIA_T2C_L);
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(0);
    via.write(VIA_IFR, 0x7f); // nothing set: harmless
    startT2(via, 0);
    viaCycles(via, 1);
    via.write(VIA_T2C_H, 0x10);
    expect(via.peek(VIA_IFR) & IFR_T2).toBe(0);
  });

  it('in pulse-counting mode (ACR bit 5 = 1) it does not count clock cycles', () => {
    const via = new Via6522();
    via.write(VIA_ACR, ACR_T2_PULSE_COUNT);
    startT2(via, 0x0100);
    viaCycles(via, 50);
    expect(t2Counter(via)).toBe(0x0100);
  });
});

describe('Via6522 timers and /RES', () => {
  it('reset clears IFR and ACR and disarms both timers, but the counters keep running and the latches keep their values', () => {
    const via = new Via6522();
    startT1(via, 0x0100, ACR_T1_FREE_RUN);
    startT2(via, 0x0200);
    viaCycles(via, 0x10);
    via.reset();
    expect(via.read(VIA_ACR)).toBe(0x00);
    expect(via.read(VIA_IFR)).toBe(0x00);
    expect((via.read(VIA_T1L_H) << 8) | via.read(VIA_T1L_L)).toBe(0x0100);
    expect(t1Counter(via)).toBe(0x00ef); // &0100, less startT2's load cycle and &10 more
    viaCycles(via, 0x300);
    expect(via.read(VIA_IFR)).toBe(0x00); // nothing armed: no flags
    expect(t2Counter(via)).toBe((0x0200 - 0x10 - 0x300) & 0xffff);
  });
});

describe('Via6522 IFR (the timer bits; the rest is Stage 26)', () => {
  it('bit 7 reads 0 until Stage 26 works out "any enabled flag"', () => {
    const via = new Via6522();
    startT1(via, 0, 0x00);
    startT2(via, 0);
    viaCycles(via, 1);
    expect(via.read(VIA_IFR)).toBe(IFR_T1 | IFR_T2);
  });

  it('the ACR reads back what was written', () => {
    const via = new Via6522();
    via.write(VIA_ACR, 0xe3);
    expect(via.read(VIA_ACR)).toBe(0xe3);
  });
});
