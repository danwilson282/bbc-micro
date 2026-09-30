import { word } from '../util/bits';
import type { Bus } from './bus';
import { TestBus } from './test-bus';

describe('TestBus (flat 64K: every address is RAM)', () => {
  it('can be used anywhere a Bus is expected', () => {
    const bus: Bus = new TestBus();
    bus.write(0x7c00, 0x48);
    expect(bus.read(0x7c00)).toBe(0x48);
  });

  it('has 65,536 separate bytes, &0000-&FFFF', () => {
    const bus = new TestBus();
    for (let a = 0; a <= 0xffff; a++) bus.write(a, (a ^ (a >> 8)) & 0xff);
    for (let a = 0; a <= 0xffff; a++) expect(bus.read(a)).toBe((a ^ (a >> 8)) & 0xff);
  });

  it('masks the address to 16 lines: &10000 is &0000, &17C00 is &7C00, -1 is &FFFF', () => {
    const bus = new TestBus();
    bus.write(0x10000, 0x11);
    bus.write(0x17c00, 0x22);
    bus.write(-1, 0x33);
    expect(bus.read(0x0000)).toBe(0x11);
    expect(bus.read(0x7c00)).toBe(0x22);
    expect(bus.read(0xffff)).toBe(0x33);
    expect(bus.read(0x1ffff)).toBe(0x33);
  });

  it('masks the value to 8 data lines: &148 is stored as &48', () => {
    const bus = new TestBus();
    bus.write(0x0000, 0x148);
    bus.write(0x0001, -1);
    expect(bus.read(0x0000)).toBe(0x48);
    expect(bus.read(0x0001)).toBe(0xff);
  });

  it('holds a little-endian vector: CD D9 at &FFFC reads back as &D9CD', () => {
    const bus = new TestBus();
    bus.load(0xfffa, [0x00, 0x0d, 0xcd, 0xd9, 0x1c, 0xdc]); // MOS 1.20 vectors
    expect(word(bus.read(0xfffa), bus.read(0xfffb))).toBe(0x0d00); // NMI
    expect(word(bus.read(0xfffc), bus.read(0xfffd))).toBe(0xd9cd); // RESET
    expect(word(bus.read(0xfffe), bus.read(0xffff))).toBe(0xdc1c); // IRQ/BRK
  });

  it('load() wraps from &FFFF to &0000, as the address bus would', () => {
    const bus = new TestBus();
    bus.load(0xffff, [0xaa, 0xbb]);
    expect(bus.read(0xffff)).toBe(0xaa);
    expect(bus.read(0x0000)).toBe(0xbb);
  });

  it('two buses are independent machines, with no shared state', () => {
    const a = new TestBus();
    const b = new TestBus();
    a.write(0x1234, 0x56);
    expect(b.read(0x1234)).toBe(0x00);
  });
});
