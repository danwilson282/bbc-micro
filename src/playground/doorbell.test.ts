import { BbcMemoryMap } from '../memory/bbc-memory-map';
import { DOORBELL, DOORBELL_NAME, DOORBELL_REGISTER, DOORBELL_RINGING, Doorbell } from './doorbell';

/** A data bus stand-in: whatever was last on the wires. */
const floating = { dataBus: 0xfc };

describe('the doorbell: a 1 MHz bus card at &FC00 (a stand-in IRQ device)', () => {
  it('lives at &FC00, in FRED: the page the Model B sets aside for 1 MHz bus cards', () => {
    expect(DOORBELL).toBe(0xfc00);
    expect(DOORBELL_REGISTER).toBe(0x00);
    expect(DOORBELL_RINGING).toBe(0x80);
    expect(new Doorbell(floating).name).toBe(DOORBELL_NAME);
  });

  it('is quiet until rung, then holds its IRQ output until answered', () => {
    const bell = new Doorbell(floating);
    expect([bell.ringing, bell.irq]).toEqual([false, false]);
    bell.ring();
    expect([bell.ringing, bell.irq]).toEqual([true, true]);
    bell.ring(); // ringing twice is still one request
    expect(bell.irq).toBe(true);
  });

  it('reads &80 at register 0 while ringing and &00 when quiet: bit 7, like a VIA IFR', () => {
    const bell = new Doorbell(floating);
    expect(bell.read(DOORBELL_REGISTER)).toBe(0x00);
    bell.ring();
    expect(bell.read(DOORBELL_REGISTER)).toBe(0x80);
    expect(bell.peek(DOORBELL_REGISTER)).toBe(0x80);
    expect(bell.ringing).toBe(true); // reading doesn't answer it
  });

  it('is answered by a write of any value to register 0, which releases the line', () => {
    const bell = new Doorbell(floating);
    bell.ring();
    bell.write(DOORBELL_REGISTER); // the value doesn't matter, so the doorbell doesn't take one
    expect(bell.irq).toBe(false);
    expect(bell.read(DOORBELL_REGISTER)).toBe(0x00);
  });

  it('drives nothing at the rest of FRED: those reads float, and writes there don\'t answer it', () => {
    const bell = new Doorbell(floating);
    bell.ring();
    expect(bell.read(0x01)).toBe(0xfc);
    expect(bell.peek(0xff)).toBe(0xfc);
    bell.write(0x01);
    expect(bell.ringing).toBe(true);
  });

  it('is quiet again after reset() (/RST on the 1 MHz bus)', () => {
    const bell = new Doorbell(floating);
    bell.ring();
    bell.reset();
    expect(bell.ringing).toBe(false);
  });

  it('plugged into a memory map, &FC00 reaches it through FRED and lands in the I/O log', () => {
    const map = new BbcMemoryMap();
    const bell = new Doorbell(map);
    map.plugFred(bell);
    bell.ring();
    expect(map.read(DOORBELL)).toBe(0x80);
    map.write(DOORBELL, 0x00);
    expect(bell.ringing).toBe(false);
    expect(map.ioLog.recent(2).map((a) => [a.address, a.write, a.value])).toEqual([
      [DOORBELL, false, 0x80],
      [DOORBELL, true, 0x00],
    ]);
  });
});
