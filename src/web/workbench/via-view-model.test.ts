import { ACR_T1_FREE_RUN, ACR_T1_PB7_OUTPUT, ACR_T2_PULSE_COUNT, VIA_ACR, VIA_DDRA, VIA_DDRB, VIA_ORA, VIA_ORB, VIA_T1C_H, VIA_T1C_L, VIA_T2C_H, VIA_T2C_L, Via6522 } from '../../devices/via6522';
import { USER_VIA_BASE, buildViaView, toggleOutsideBit } from './via-view-model';

function userVia(): Via6522 {
  return new Via6522();
}

describe('buildViaView: registers', () => {
  it('lists all 16 registers with their User VIA addresses and datasheet names', () => {
    const view = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via: userVia() });
    expect(view.range).toBe('&FE60-&FE6F');
    expect(view.registers).toHaveLength(16);
    expect(view.registers.map((r) => r.address)).toEqual(Array.from({ length: 16 }, (_, i) => `&FE6${i.toString(16).toUpperCase()}`));
    expect(view.registers[2]).toMatchObject({ number: 2, name: 'DDRB', value: '&00', binary: '0000 0000' });
    expect(view.registers[15]?.name).toBe('ORA/IRA, no handshake');
  });

  it('shows what a CPU read would return now: IRB, not ORB', () => {
    const via = userVia();
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0xa5);
    const view = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via });
    expect(view.registers[0]).toMatchObject({ value: '&F5', binary: '1111 0101' });
  });

  it('says which registers are built and which are stubs, and for which stage', () => {
    const view = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via: userVia() });
    const status = view.registers.map((r) => r.status);
    expect(status.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 'built'));
    expect(status[15]).toBe('built');
    expect(status[11]).toBe('bits 7-5 built; input latching in Stage 26');
    expect(status[13]).toBe('timer bits 6 and 5 built; the rest in Stage 26');
    expect(status[12]).toBe('stub until Stage 26');
    expect(status[14]).toBe('stub until Stage 26');
    expect(status[10]).toBe('stub (shift register not planned)');
    expect(view.registers.filter((r) => r.isStub).map((r) => r.number)).toEqual([10, 12, 14]);
  });
});

describe('buildViaView: timers', () => {
  it('shows T1 free-running from the latch, with its counter in hex and decimal', () => {
    const via = userVia();
    via.write(VIA_ACR, ACR_T1_FREE_RUN);
    via.write(VIA_T1C_L, 0x0e);
    via.write(VIA_T1C_H, 0x27);
    via.tick(2 * (1 + 0x070e)); // the load cycle, then 1,806 counts: &270E → &2000
    const t1 = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).timers[0];
    expect(t1).toMatchObject({ name: 'T1', counter: '&2000', decimal: '8,192', latch: '&270E', mode: 'free-running', armed: true, flag: false, flagBit: 6 });
    expect(t1.fraction).toBeCloseTo(0x2000 / 0x270e);
  });

  it('shows T1 one-shot, its flag once it has run out, and what it does to PB7', () => {
    const via = userVia();
    via.write(VIA_ACR, ACR_T1_PB7_OUTPUT);
    via.write(VIA_T1C_L, 0x02);
    via.write(VIA_T1C_H, 0x00);
    via.tick(2); // the load cycle
    let t1 = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).timers[0];
    expect(t1).toMatchObject({ mode: 'one-shot', armed: true, flag: false, pb7: 'PB7 = 0 (low until it runs out)' });
    via.tick(6);
    t1 = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).timers[0];
    expect(t1).toMatchObject({ counter: '&FFFF', armed: false, flag: true, pb7: 'PB7 = 1 (low until it runs out)' });
  });

  it('shows T2 with its one latch byte, and pulse-counting mode as not built', () => {
    const via = userVia();
    via.write(VIA_T2C_L, 0x34);
    via.write(VIA_T2C_H, 0x12);
    via.tick(2); // the load cycle
    let t2 = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).timers[1];
    expect(t2).toMatchObject({ name: 'T2', counter: '&1234', latch: '&xx34', mode: 'one-shot', armed: true, flagBit: 5, pb7: '' });
    via.write(VIA_ACR, ACR_T2_PULSE_COUNT);
    t2 = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).timers[1];
    expect(t2.mode).toBe('counts PB6 pulses (not built: holds)');
  });

  it('marks PB7 in the port B grid as driven by T1, an output whatever DDRB says', () => {
    const via = userVia();
    via.write(VIA_ACR, ACR_T1_PB7_OUTPUT);
    via.write(VIA_T1C_H, 0x10);
    const pb7 = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).ports[1].lines[0];
    expect(pb7).toMatchObject({ name: 'PB7', isOutput: true, timer1: true, or: 0, pin: 0, read: 0 });
  });
});

describe('buildViaView: port bit grids', () => {
  it('shows each port line from bit 7 down to bit 0, with its direction', () => {
    const via = userVia();
    via.write(VIA_DDRB, 0x0f);
    const port = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).ports[1];
    expect(port.label).toBe('Port B');
    expect(port.lines.map((l) => l.name)).toEqual(['PB7', 'PB6', 'PB5', 'PB4', 'PB3', 'PB2', 'PB1', 'PB0']);
    expect(port.lines.map((l) => l.isOutput)).toEqual([false, false, false, false, true, true, true, true]);
  });

  it('port B reads the register bit on an output line and the pin on an input line', () => {
    const via = userVia();
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0xff);
    via.setOutside('b', 0x0e);
    const port = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).ports[1];
    expect(port.readName).toBe('IRB');
    expect(port.hex).toEqual({ ddr: '&0F', or: '&FF', outside: '&0E', pins: '&0E', read: '&0F' });
    const pb0 = port.lines[7];
    expect(pb0).toMatchObject({ name: 'PB0', isOutput: true, or: 1, outside: 0, pin: 0, read: 1, readFrom: 'register' });
    expect(port.lines[0]).toMatchObject({ name: 'PB7', isOutput: false, pin: 0, read: 0, readFrom: 'pin' });
  });

  it('port A reads the pin on every line', () => {
    const via = userVia();
    via.write(VIA_DDRA, 0xff);
    via.write(VIA_ORA, 0x81);
    via.setOutside('a', 0x7f);
    const port = buildViaView({ name: 'User VIA', base: USER_VIA_BASE, via }).ports[0];
    expect(port.readName).toBe('IRA');
    expect(port.hex.read).toBe('&01');
    expect(port.lines[0]).toMatchObject({ name: 'PA7', isOutput: true, or: 1, pin: 0, read: 0, readFrom: 'pin' });
  });
});

describe('toggleOutsideBit', () => {
  it('pulls a line low, then lets it go again', () => {
    const via = userVia();
    toggleOutsideBit(via, 'b', 4);
    expect(via.outside('b')).toBe(0xef);
    expect(via.read(VIA_ORB)).toBe(0xef);
    toggleOutsideBit(via, 'b', 4);
    expect(via.outside('b')).toBe(0xff);
  });
});
