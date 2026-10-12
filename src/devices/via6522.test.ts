import { BbcMemoryMap } from '../memory/bbc-memory-map';
import {
  VIA_ACR,
  VIA_DDRA,
  VIA_DDRB,
  VIA_IER,
  VIA_ORA,
  VIA_ORA_NO_HANDSHAKE,
  VIA_ORB,
  VIA_PCR,
  VIA_SR,
  VIA_T1L_H,
  VIA_T1L_L,
  VIA_T2C_L,
  Via6522,
} from './via6522';

describe('Via6522 after reset', () => {
  it('has every DDR bit at 0, so all 16 lines are inputs', () => {
    const via = new Via6522();
    expect(via.read(VIA_DDRA)).toBe(0x00);
    expect(via.read(VIA_DDRB)).toBe(0x00);
  });

  it('reads &FF from both ports when nothing outside pulls a line low (inputs float high)', () => {
    const via = new Via6522();
    expect(via.read(VIA_ORB)).toBe(0xff);
    expect(via.read(VIA_ORA)).toBe(0xff);
    expect(via.pins('a')).toBe(0xff);
    expect(via.pins('b')).toBe(0xff);
  });

  it('/RES clears ORA, ORB, DDRA, DDRB, ACR, PCR and IER but keeps the timer latches and SR (6522 datasheet, RES)', () => {
    const via = new Via6522();
    for (const reg of [VIA_ORB, VIA_ORA, VIA_DDRB, VIA_DDRA, VIA_ACR, VIA_PCR, VIA_IER, VIA_T1L_L, VIA_T1L_H, VIA_T2C_L, VIA_SR]) via.write(reg, 0x5a);
    via.reset();
    expect(via.outputRegister('a')).toBe(0x00);
    expect(via.outputRegister('b')).toBe(0x00);
    expect(via.dataDirection('a')).toBe(0x00);
    expect(via.dataDirection('b')).toBe(0x00);
    // IER's bit 7 always reads 1 (Stage 26), so a cleared IER reads &80.
    expect([VIA_ACR, VIA_PCR, VIA_IER].map((r) => via.read(r))).toEqual([0x00, 0x00, 0x80]);
    expect([VIA_T1L_L, VIA_T1L_H, VIA_SR].map((r) => via.read(r))).toEqual([0x5a, 0x5a, 0x5a]);
  });

  it('/RES does not change what the outside world is doing to the pins', () => {
    const via = new Via6522();
    via.setOutside('b', 0xef);
    via.reset();
    expect(via.outside('b')).toBe(0xef);
    expect(via.read(VIA_ORB)).toBe(0xef);
  });
});

describe('Via6522 data direction registers', () => {
  it('DDRA and DDRB read back exactly what was written', () => {
    const via = new Via6522();
    via.write(VIA_DDRA, 0xf0);
    via.write(VIA_DDRB, 0x0f);
    expect(via.read(VIA_DDRA)).toBe(0xf0);
    expect(via.read(VIA_DDRB)).toBe(0x0f);
  });

  it('a 1 in DDRB makes that line an output driven by ORB; a 0 leaves it an input: DDRB=&0F, ORB=&A5 puts &F5 on the pins', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0xa5);
    expect(via.pins('b')).toBe(0xf5);
    expect(via.read(VIA_ORB)).toBe(0xf5);
  });

  it('ORB keeps bits written while a line is an input; they reach the pin when DDRB turns it into an output', () => {
    const via = new Via6522();
    via.write(VIA_ORB, 0x00); // all inputs: nothing driven, the lines float high
    expect(via.pins('b')).toBe(0xff);
    expect(via.outputRegister('b')).toBe(0x00);
    via.write(VIA_DDRB, 0xff);
    expect(via.pins('b')).toBe(0x00);
  });

  it('a line switched from output back to input lets go of it: the outside decides again', () => {
    const via = new Via6522();
    via.write(VIA_ORA, 0x00);
    via.write(VIA_DDRA, 0xff);
    expect(via.pins('a')).toBe(0x00);
    via.write(VIA_DDRA, 0x00);
    expect(via.pins('a')).toBe(0xff);
  });
});

describe('Via6522 reading port B (IRB)', () => {
  it('an input line reads 0 when the outside pulls it low (a joystick button on PB4)', () => {
    const via = new Via6522();
    via.setOutside('b', 0xef);
    expect(via.read(VIA_ORB)).toBe(0xef);
  });

  it('an output line reads its ORB bit, even if the outside drags the pin low', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0xff);
    via.write(VIA_ORB, 0x81);
    via.setOutside('b', 0x7f);
    expect(via.pins('b')).toBe(0x01); // the line really is low...
    expect(via.read(VIA_ORB)).toBe(0x81); // ...but IRB shows what ORB is driving
  });

  it('mixes the two bit by bit: ORB for outputs, pins for inputs', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0xff);
    via.setOutside('b', 0x0e); // pulls PB7-PB4 and PB0 low
    // PB7-PB4 are inputs: pins 0000. PB3-PB0 are outputs: ORB 1111, although PB0 is dragged low.
    expect(via.pins('b')).toBe(0x0e);
    expect(via.read(VIA_ORB)).toBe(0x0f);
  });
});

describe('Via6522 reading port A (IRA)', () => {
  it('every line reads its pin level, so an output dragged low reads 0', () => {
    const via = new Via6522();
    via.write(VIA_DDRA, 0xff);
    via.write(VIA_ORA, 0x81);
    via.setOutside('a', 0x7f);
    expect(via.pins('a')).toBe(0x01);
    expect(via.read(VIA_ORA)).toBe(0x01);
  });

  it('with nothing pulling, output lines read back what ORA drives', () => {
    const via = new Via6522();
    via.write(VIA_DDRA, 0xf0);
    via.write(VIA_ORA, 0x3c);
    expect(via.read(VIA_ORA)).toBe(0x3f); // PA7-PA4 drive 0011; PA3-PA0 are inputs, floating high
  });

  it('register 1 (with handshake) and register 15 (no handshake) write the same ORA and read the same pins', () => {
    const via = new Via6522();
    via.write(VIA_DDRA, 0xff);
    via.write(VIA_ORA_NO_HANDSHAKE, 0x42);
    expect(via.outputRegister('a')).toBe(0x42);
    expect(via.read(VIA_ORA)).toBe(0x42);
    via.write(VIA_ORA, 0x24);
    expect(via.read(VIA_ORA_NO_HANDSHAKE)).toBe(0x24);
  });
});

describe('Via6522 SR and PCR', () => {
  it.each([VIA_SR, VIA_PCR])('register %i stores a write and reads it back (SR is storage only: no shift register)', (reg) => {
    const via = new Via6522();
    via.write(reg, 0x3c);
    expect(via.read(reg)).toBe(0x3c);
  });

  it('writing registers &4-&E leaves the ports alone', () => {
    const via = new Via6522();
    for (let reg = 4; reg <= 14; reg++) if (reg !== VIA_ACR) via.write(reg, 0xff);
    expect(via.dataDirection('a')).toBe(0x00);
    expect(via.dataDirection('b')).toBe(0x00);
    expect(via.outputRegister('a')).toBe(0x00);
    expect(via.outputRegister('b')).toBe(0x00);
  });
});

describe('Via6522 bus widths', () => {
  it('sees only RS0-RS3: register 18 is register 2 (DDRB)', () => {
    const via = new Via6522();
    via.write(0x12, 0x0f);
    expect(via.read(VIA_DDRB)).toBe(0x0f);
    expect(via.read(0x12)).toBe(0x0f);
  });

  it('keeps 8 bits of a write and of the outside byte', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x1ff);
    via.write(VIA_ORB, 0x1a5);
    via.setOutside('a', 0x17f);
    expect(via.read(VIA_DDRB)).toBe(0xff);
    expect(via.outputRegister('b')).toBe(0xa5);
    expect(via.outside('a')).toBe(0x7f);
  });

  it('peek returns what read would, for every register', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0xa5);
    via.write(VIA_DDRA, 0xff);
    via.write(VIA_ORA, 0x81);
    via.setOutside('a', 0x7f);
    for (let reg = 0; reg < 16; reg++) expect(via.peek(reg)).toBe(via.read(reg));
  });
});

describe('Via6522 on the memory map', () => {
  it('the CPU reaches the User VIA at &FE60-&FE6F and its mirror at &FE70-&FE7F', () => {
    const userVia = new Via6522();
    const map = new BbcMemoryMap({ devices: { userVia } });
    map.write(0xfe62, 0x0f); // DDRB
    map.write(0xfe70, 0xa5); // ORB, through the mirror
    expect(userVia.dataDirection('b')).toBe(0x0f);
    expect(map.read(0xfe60)).toBe(0xf5);
    expect(map.peek(0xfe72)).toBe(0x0f);
  });

  it('the System VIA and the User VIA are separate chips', () => {
    const systemVia = new Via6522();
    const userVia = new Via6522();
    const map = new BbcMemoryMap({ devices: { systemVia, userVia } });
    map.write(0xfe43, 0xff); // System VIA DDRA
    expect(systemVia.dataDirection('a')).toBe(0xff);
    expect(userVia.dataDirection('a')).toBe(0x00);
  });
});
