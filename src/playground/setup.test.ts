import { TestBus } from '../memory/test-bus';
import { installProgram } from './setup';

describe('installProgram', () => {
  const lines = [{ address: 0x0400, bytes: [0xa9, 0x41], source: 'LDA #&41', comment: '' }];

  it('loads the program over a page of NOPs, with BRK (&00) waiting at &0500', () => {
    const bus = new TestBus();
    installProgram(bus, lines, 0x0400);
    expect([0x0400, 0x0401, 0x0402, 0x04ff, 0x0500].map((a) => bus.read(a))).toEqual([0xa9, 0x41, 0xea, 0xea, 0x00]);
  });

  it('points the reset vector at the entry address, low byte first', () => {
    const bus = new TestBus();
    installProgram(bus, lines, 0x0412);
    expect([bus.read(0xfffc), bus.read(0xfffd)]).toEqual([0x12, 0x04]);
  });

  it('starts from clean memory, with the playground data and explorer pointers back in place', () => {
    const bus = new TestBus();
    bus.write(0x2000, 0x99);
    bus.write(0x7c00, 0x00);
    installProgram(bus, lines, 0x0400);
    expect(bus.read(0x2000)).toBe(0x00);
    expect(bus.read(0x7c00)).toBe(0x48); // "H"
    expect([bus.read(0x70), bus.read(0x71)]).toEqual([0x00, 0x7c]);
    expect([bus.read(0x30ff), bus.read(0x3000)]).toEqual([0x00, 0x04]);
  });
});
