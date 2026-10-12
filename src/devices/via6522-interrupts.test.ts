import {
  ACR_PA_LATCH,
  ACR_PB_LATCH,
  ACR_T1_FREE_RUN,
  CPU_CYCLES_PER_VIA_CYCLE,
  IFR_CA1,
  IFR_CA2,
  IFR_CB1,
  IFR_CB2,
  IFR_IRQ,
  IFR_T1,
  IFR_T2,
  VIA_ACR,
  VIA_DDRB,
  VIA_IER,
  VIA_IFR,
  VIA_ORA,
  VIA_ORA_NO_HANDSHAKE,
  VIA_ORB,
  VIA_PCR,
  VIA_T1C_H,
  VIA_T1C_L,
  VIA_T2C_H,
  VIA_T2C_L,
  Via6522,
} from './via6522';

/** Advances the VIA by n of its own (1 MHz) cycles. */
function viaCycles(via: Via6522, n: number): void {
  via.tick(n * CPU_CYCLES_PER_VIA_CYCLE);
}

/** A falling edge on a control line: high, then low. */
function fall(via: Via6522, line: 'ca1' | 'ca2' | 'cb1' | 'cb2'): void {
  via.setControlLine(line, 1);
  via.setControlLine(line, 0);
}

/** A rising edge: low, then high. */
function rise(via: Via6522, line: 'ca1' | 'ca2' | 'cb1' | 'cb2'): void {
  via.setControlLine(line, 0);
  via.setControlLine(line, 1);
}

/** Runs T1 one-shot with a latch of 2 until it times out. */
function timeOutT1(via: Via6522): void {
  via.write(VIA_T1C_L, 2);
  via.write(VIA_T1C_H, 0);
  viaCycles(via, 5);
}

describe('Via6522 IER (register &E)', () => {
  it('reads &80 after reset: every enable clear, and bit 7 always reads 1', () => {
    const via = new Via6522();
    expect(via.read(VIA_IER)).toBe(0x80);
  });

  it('a write with bit 7 = 1 SETS the bits written as 1 and leaves the others alone', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0x82); // set CA1
    via.write(VIA_IER, 0xc0); // set T1
    expect(via.read(VIA_IER)).toBe(0xc2);
  });

  it('a write with bit 7 = 0 CLEARS the bits written as 1 and leaves the others alone', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0xff);
    via.write(VIA_IER, 0x02); // clear CA1
    expect(via.read(VIA_IER)).toBe(0xfd);
    via.write(VIA_IER, 0x7f); // clear everything: the MOS's first write
    expect(via.read(VIA_IER)).toBe(0x80);
  });

  it("the MOS's &F2 enables T1, T2, CB1 and CA1 (os12.rom &DA82)", () => {
    const via = new Via6522();
    via.write(VIA_IER, 0xf2);
    expect(via.read(VIA_IER)).toBe(0xf2);
  });

  it('/RES clears it, so the MOS sees power-on: LDA &FE4E, ASL A gives &00', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0xf2);
    via.reset();
    expect((via.read(VIA_IER) << 1) & 0xff).toBe(0x00);
  });
});

describe('Via6522 IFR bit 7 and the /IRQ output', () => {
  it('a flag that is set but not enabled leaves IRQ high and IFR bit 7 clear (Stage 25 polling)', () => {
    const via = new Via6522();
    timeOutT1(via);
    expect(via.read(VIA_IFR)).toBe(IFR_T1);
    expect(via.irq).toBe(false);
  });

  it('enabling a flag that is already set pulls IRQ low at once and sets IFR bit 7', () => {
    const via = new Via6522();
    timeOutT1(via);
    via.write(VIA_IER, 0x80 | IFR_T1);
    expect(via.irq).toBe(true);
    expect(via.read(VIA_IFR)).toBe(IFR_IRQ | IFR_T1);
  });

  it('only enabled flags count: T1 enabled, CA1 flagged, gives no IRQ', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0x80 | IFR_T1);
    fall(via, 'ca1');
    expect(via.read(VIA_IFR)).toBe(IFR_CA1);
    expect(via.irq).toBe(false);
  });

  it('a free-running T1 with IER bit 6 raises IRQ at the timeout, and reading T1C-L releases it', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0x80 | IFR_T1);
    via.write(VIA_ACR, ACR_T1_FREE_RUN);
    via.write(VIA_T1C_L, 3);
    via.write(VIA_T1C_H, 0);
    viaCycles(via, 4); // load 3, then 2, 1, 0
    expect(via.irq).toBe(false);
    viaCycles(via, 1); // 0 → &FFFF: timeout
    expect(via.irq).toBe(true);
    via.read(VIA_T1C_L);
    expect(via.irq).toBe(false);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('T2 raises IRQ through IER bit 5', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0x80 | IFR_T2);
    via.write(VIA_T2C_L, 1);
    via.write(VIA_T2C_H, 0);
    viaCycles(via, 3);
    expect(via.irq).toBe(true);
    expect(via.read(VIA_IFR)).toBe(IFR_IRQ | IFR_T2);
  });

  it('writing a 1 to a flag clears it and releases IRQ; writing bit 7 does nothing', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0xff);
    fall(via, 'ca1');
    via.write(VIA_IFR, 0x80);
    expect(via.irq).toBe(true);
    via.write(VIA_IFR, IFR_CA1); // the MOS's LDA #&02 : STA &FE4D
    expect(via.irq).toBe(false);
  });

  it('disabling the source releases IRQ but leaves the flag set', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0x80 | IFR_CA1);
    fall(via, 'ca1');
    via.write(VIA_IER, IFR_CA1);
    expect(via.irq).toBe(false);
    expect(via.read(VIA_IFR)).toBe(IFR_CA1);
  });

  it('/RES clears every flag and enable: IRQ released', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0xff);
    fall(via, 'cb1');
    via.reset();
    expect(via.irq).toBe(false);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });
});

describe('Via6522 CA1 and CB1: edge-detecting inputs', () => {
  it('with PCR bit 0 = 0, a falling edge on CA1 sets IFR bit 1; staying low sets nothing more', () => {
    const via = new Via6522();
    via.setControlLine('ca1', 0);
    expect(via.read(VIA_IFR)).toBe(IFR_CA1);
    via.write(VIA_IFR, IFR_CA1);
    via.setControlLine('ca1', 0); // still low: no edge
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('with PCR bit 0 = 0, a rising edge on CA1 sets nothing', () => {
    const via = new Via6522();
    via.setControlLine('ca1', 0);
    via.write(VIA_IFR, 0x7f);
    via.setControlLine('ca1', 1);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('with PCR bit 0 = 1, CA1 flags the rising edge instead', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x01);
    via.setControlLine('ca1', 0);
    expect(via.read(VIA_IFR)).toBe(0x00);
    via.setControlLine('ca1', 1);
    expect(via.read(VIA_IFR)).toBe(IFR_CA1);
  });

  it('CB1 follows PCR bit 4 and sets IFR bit 4', () => {
    const via = new Via6522();
    fall(via, 'cb1');
    expect(via.read(VIA_IFR)).toBe(IFR_CB1);
    via.write(VIA_IFR, 0x7f);
    via.write(VIA_PCR, 0x10);
    rise(via, 'cb1');
    expect(via.read(VIA_IFR)).toBe(IFR_CB1);
  });

  it('reading or writing ORA (register 1) clears the CA1 flag', () => {
    const via = new Via6522();
    fall(via, 'ca1');
    via.read(VIA_ORA);
    expect(via.read(VIA_IFR)).toBe(0x00);
    fall(via, 'ca1');
    via.write(VIA_ORA, 0x00);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('register 15 (ORA, no handshake) leaves the CA1 flag alone', () => {
    const via = new Via6522();
    fall(via, 'ca1');
    via.read(VIA_ORA_NO_HANDSHAKE);
    via.write(VIA_ORA_NO_HANDSHAKE, 0x00);
    expect(via.read(VIA_IFR)).toBe(IFR_CA1);
  });

  it('reading or writing ORB (register 0) clears the CB1 flag', () => {
    const via = new Via6522();
    fall(via, 'cb1');
    via.read(VIA_ORB);
    expect(via.read(VIA_IFR)).toBe(0x00);
    fall(via, 'cb1');
    via.write(VIA_ORB, 0x00);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('peek (the debugger) reads ORA without clearing anything', () => {
    const via = new Via6522();
    fall(via, 'ca1');
    via.peek(VIA_ORA);
    expect(via.peek(VIA_IFR)).toBe(IFR_CA1);
  });

  it('control lines start high (nothing pulling) and reset leaves the outside alone', () => {
    const via = new Via6522();
    expect(via.controlLine('ca1')).toBe(1);
    via.setControlLine('ca1', 0);
    via.reset();
    expect(via.controlLine('ca1')).toBe(0);
  });
});

describe('Via6522 CA2 and CB2 as inputs (PCR bits 3-1 and 7-5 = 0xx)', () => {
  it('CA2 mode 000: falling edge sets IFR bit 0, and reading ORA clears it', () => {
    const via = new Via6522();
    fall(via, 'ca2');
    expect(via.read(VIA_IFR)).toBe(IFR_CA2);
    via.read(VIA_ORA);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it("CA2 mode 010 (the MOS's keyboard, PCR &04): the rising edge sets it", () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x04);
    via.setControlLine('ca2', 0);
    expect(via.read(VIA_IFR)).toBe(0x00);
    via.setControlLine('ca2', 1);
    expect(via.read(VIA_IFR)).toBe(IFR_CA2);
  });

  it('CA2 mode 001 (independent): reading or writing ORA does NOT clear it, writing IFR does', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x02);
    fall(via, 'ca2');
    via.read(VIA_ORA);
    via.write(VIA_ORA, 0);
    expect(via.read(VIA_IFR)).toBe(IFR_CA2);
    via.write(VIA_IFR, IFR_CA2);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('CA2 mode 011: independent, rising edge', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x06);
    rise(via, 'ca2');
    via.read(VIA_ORA);
    expect(via.read(VIA_IFR)).toBe(IFR_CA2);
  });

  it('CB2 mode 000 sets IFR bit 3 and ORB clears it; mode 001 (PCR &20) does not clear on ORB', () => {
    const via = new Via6522();
    fall(via, 'cb2');
    expect(via.read(VIA_IFR)).toBe(IFR_CB2);
    via.write(VIA_ORB, 0);
    expect(via.read(VIA_IFR)).toBe(0x00);
    via.write(VIA_PCR, 0x20);
    fall(via, 'cb2');
    via.read(VIA_ORB);
    expect(via.read(VIA_IFR)).toBe(IFR_CB2);
  });

  it('CB2 mode 010 (PCR &40): rising edge', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x40);
    rise(via, 'cb2');
    expect(via.read(VIA_IFR)).toBe(IFR_CB2);
  });
});

describe('Via6522 CA2 and CB2 as outputs (PCR bits 3-1 and 7-5 = 1xx)', () => {
  it('mode 110 drives the line low and 111 drives it high (the MOS strobes the printer this way, os12.rom &E153)', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x0c);
    expect(via.controlLine('ca2')).toBe(0);
    via.write(VIA_PCR, 0x0e);
    expect(via.controlLine('ca2')).toBe(1);
    via.write(VIA_PCR, 0xc0);
    expect(via.controlLine('cb2')).toBe(0);
    via.write(VIA_PCR, 0xe0);
    expect(via.controlLine('cb2')).toBe(1);
  });

  it('an output line ignores the outside, and sets no flag', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x0e);
    fall(via, 'ca2');
    expect(via.controlLine('ca2')).toBe(1);
    expect(via.read(VIA_IFR)).toBe(0x00);
  });

  it('mode 100 (handshake): CA2 goes low on a read or write of ORA, and high again on the active CA1 edge', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x08);
    expect(via.controlLine('ca2')).toBe(1);
    via.write(VIA_ORA, 0x41); // "data ready"
    expect(via.controlLine('ca2')).toBe(0);
    fall(via, 'ca1'); // "got it"
    expect(via.controlLine('ca2')).toBe(1);
    expect(via.read(VIA_IFR)).toBe(IFR_CA1);
    via.read(VIA_ORA); // input devices handshake on reads too
    expect(via.controlLine('ca2')).toBe(0);
  });

  it('mode 101 (pulse): CA2 goes low for one VIA cycle after an ORA access', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x0a);
    via.write(VIA_ORA, 0x41);
    expect(via.controlLine('ca2')).toBe(0);
    viaCycles(via, 1);
    expect(via.controlLine('ca2')).toBe(1);
  });

  it('register 15 does no handshake', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x08);
    via.write(VIA_ORA_NO_HANDSHAKE, 0x41);
    expect(via.controlLine('ca2')).toBe(1);
  });

  it('CB2 handshakes on WRITES of ORB only, and CB1 ends it', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0x80);
    via.read(VIA_ORB);
    expect(via.controlLine('cb2')).toBe(1);
    via.write(VIA_ORB, 0x41);
    expect(via.controlLine('cb2')).toBe(0);
    fall(via, 'cb1');
    expect(via.controlLine('cb2')).toBe(1);
  });

  it('CB2 pulse mode (PCR &A0): low for one cycle after a write of ORB', () => {
    const via = new Via6522();
    via.write(VIA_PCR, 0xa0);
    via.write(VIA_ORB, 0x41);
    expect(via.controlLine('cb2')).toBe(0);
    viaCycles(via, 1);
    expect(via.controlLine('cb2')).toBe(1);
  });
});

describe('Via6522 input latching (ACR bits 0 and 1)', () => {
  it('with ACR bit 0 set, IRA returns the pins as they were at the last active CA1 edge', () => {
    const via = new Via6522();
    via.write(VIA_ACR, ACR_PA_LATCH);
    via.setOutside('a', 0x5a);
    fall(via, 'ca1');
    via.setOutside('a', 0xff); // the device takes the data away
    expect(via.read(VIA_ORA)).toBe(0x5a);
    via.write(VIA_ACR, 0x00);
    expect(via.read(VIA_ORA)).toBe(0xff);
  });

  it('with ACR bit 1 set, IRB input bits come from the CB1 latch; output bits still read ORB', () => {
    const via = new Via6522();
    via.write(VIA_ACR, ACR_PB_LATCH);
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0x05);
    via.setOutside('b', 0x3f);
    fall(via, 'cb1');
    via.setOutside('b', 0xff);
    expect(via.read(VIA_ORB)).toBe(0x35);
  });
});

describe('Via6522 IFR: all the sources together', () => {
  it('each source has its own bit: CA2=0, CA1=1, CB2=3, CB1=4, T2=5, T1=6', () => {
    const via = new Via6522();
    fall(via, 'ca2');
    fall(via, 'ca1');
    fall(via, 'cb2');
    fall(via, 'cb1');
    via.write(VIA_T2C_L, 0);
    via.write(VIA_T2C_H, 0);
    timeOutT1(via);
    expect(via.read(VIA_IFR)).toBe(0x7b);
    via.write(VIA_IER, 0xff);
    expect(via.read(VIA_IFR)).toBe(0xfb);
  });

  it('reading T1C-L clears only T1; the other flags keep IRQ low', () => {
    const via = new Via6522();
    via.write(VIA_IER, 0xff);
    fall(via, 'ca1');
    timeOutT1(via);
    via.read(VIA_T1C_L);
    expect(via.read(VIA_IFR)).toBe(IFR_IRQ | IFR_CA1);
    expect(via.irq).toBe(true);
  });

  it('writing T1C-H and T2C-H still clears their flags (Stage 25)', () => {
    const via = new Via6522();
    timeOutT1(via);
    via.write(VIA_T1C_H, 0);
    expect(via.read(VIA_IFR) & IFR_T1).toBe(0);
  });
});
