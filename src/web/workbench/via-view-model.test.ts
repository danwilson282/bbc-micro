import { VIA_DDRA, VIA_DDRB, VIA_ORA, VIA_ORB, Via6522 } from '../../devices/via6522';
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
    expect(status.slice(0, 4)).toEqual(['built', 'built', 'built', 'built']);
    expect(status[15]).toBe('built');
    expect(status[4]).toBe('stub until Stage 25');
    expect(status[11]).toBe('stub until Stage 25');
    expect(status[13]).toBe('stub until Stage 26');
    expect(status[10]).toBe('stub (shift register not planned)');
    expect(view.registers.filter((r) => r.isStub)).toHaveLength(11);
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
