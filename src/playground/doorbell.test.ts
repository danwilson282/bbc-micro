import { TestBus } from '../memory/test-bus';
import { DOORBELL, DOORBELL_RINGING, Doorbell } from './doorbell';

describe('the playground doorbell at &FC00 (a stand-in IRQ device)', () => {
  it('lives at &FC00, in FRED: the page the Model B sets aside for add-on hardware', () => {
    expect(DOORBELL).toBe(0xfc00);
    expect(DOORBELL_RINGING).toBe(0x80);
  });

  it('is quiet until rung, then holds its IRQ line until answered', () => {
    const bell = new Doorbell(new TestBus());
    expect(bell.ringing).toBe(false);
    bell.ring();
    expect(bell.ringing).toBe(true);
    bell.ring(); // ringing twice is still one request
    expect(bell.ringing).toBe(true);
  });

  it('reads &80 at &FC00 while ringing and &00 when quiet: bit 7, like a VIA IFR', () => {
    const bell = new Doorbell(new TestBus());
    expect(bell.read(0xfc00)).toBe(0x00);
    bell.ring();
    expect(bell.read(0xfc00)).toBe(0x80);
    expect(bell.ringing).toBe(true); // reading doesn't answer it
  });

  it('is answered by a write of any value to &FC00, which releases the line', () => {
    const bell = new Doorbell(new TestBus());
    bell.ring();
    bell.write(0xfc00, 0x00);
    expect(bell.ringing).toBe(false);
    expect(bell.read(0xfc00)).toBe(0x00);
  });

  it('passes every other address through to the bus behind it', () => {
    const bus = new TestBus();
    const bell = new Doorbell(bus);
    bell.write(0xfc01, 0x42);
    expect(bus.read(0xfc01)).toBe(0x42);
    bus.write(0x0400, 0xea);
    expect(bell.read(0x0400)).toBe(0xea);
    expect(bell.read(0x1fc00)).toBe(0x00); // addresses are masked to 16 bits
  });

  it('is quiet again after reset()', () => {
    const bell = new Doorbell(new TestBus());
    bell.ring();
    bell.reset();
    expect(bell.ringing).toBe(false);
  });
});
