import type { IoDevice } from '../../memory/io-device';
import { HardwareLog } from '../hardware-log';
import { CRTC_ADDRESS, CRTC_DATA, CRTC_REGISTER_COUNT, CrtcStub } from './crtc-stub';

describe('CrtcStub (storage only: the real 6845 is Stage 37)', () => {
  it('&FE00 picks the register and &FE01 stores into it: R0 := &3F', () => {
    const crtc = new CrtcStub();
    crtc.write(CRTC_ADDRESS, 0);
    crtc.write(CRTC_DATA, 0x3f);
    expect(crtc.register(0)).toBe(0x3f);
  });

  it('keeps every register\'s value: the MOS\'s MODE 7 table goes in, R0-R11, and stays', () => {
    const mode7 = [0x3f, 0x28, 0x33, 0x24, 0x1e, 0x02, 0x19, 0x1b, 0x93, 0x12, 0x72, 0x13];
    const crtc = new CrtcStub();
    mode7.forEach((value, r) => {
      crtc.write(CRTC_ADDRESS, r);
      crtc.write(CRTC_DATA, value);
    });
    expect(crtc.registers().slice(0, 12)).toEqual(mode7);
    expect(crtc.registers()).toHaveLength(CRTC_REGISTER_COUNT);
  });

  it('the address register holds: two data writes in a row both go to the same register', () => {
    const crtc = new CrtcStub();
    crtc.write(CRTC_ADDRESS, 12);
    crtc.write(CRTC_DATA, 0x20);
    crtc.write(CRTC_DATA, 0x28);
    expect(crtc.register(12)).toBe(0x28);
    expect(crtc.addressRegister).toBe(12);
  });

  it('the address register is 5 bits: &21 picks R1', () => {
    const crtc = new CrtcStub();
    crtc.write(CRTC_ADDRESS, 0x21);
    crtc.write(CRTC_DATA, 0x50);
    expect(crtc.register(1)).toBe(0x50);
  });

  it('R18-R31 don\'t exist: a write there changes nothing', () => {
    const crtc = new CrtcStub();
    const before = crtc.registers();
    crtc.write(CRTC_ADDRESS, 20);
    crtc.write(CRTC_DATA, 0xff);
    expect(crtc.registers()).toEqual(before);
  });

  it('reads give &00 for now, with no side effects (the real read rules are Stage 37\'s)', () => {
    const crtc: IoDevice = new CrtcStub(); // as the memory map sees it
    crtc.write(CRTC_ADDRESS, 14);
    crtc.write(CRTC_DATA, 0x12);
    expect([crtc.read(CRTC_ADDRESS), crtc.read(CRTC_DATA), crtc.peek(CRTC_DATA)]).toEqual([0, 0, 0]);
  });

  it('reports each data write to the hardware log as (register, value); an address write alone isn\'t one', () => {
    const log = new HardwareLog({ cycles: 0 });
    const crtc = new CrtcStub(log);
    crtc.write(CRTC_ADDRESS, 7);
    crtc.write(CRTC_DATA, 0x1b);
    expect(log.recent().map((w) => [w.device, w.register, w.value])).toEqual([['crtc', 7, 0x1b]]);
  });
});
