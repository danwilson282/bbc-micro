import { AddressableLatch, LATCH_KEYBOARD_ENABLE, LATCH_SHIFT_LOCK_LED, LATCH_SOUND_WRITE_ENABLE } from './addressable-latch';
import { HardwareLog } from './hardware-log';

describe('AddressableLatch (IC32, a 74LS259)', () => {
  it('&0B on PB0-PB3 sets bit 3 (address 011) to 1 (data PB3 = 1), and only bit 3', () => {
    const latch = new AddressableLatch();
    latch.drive(0x0b);
    expect(latch.value).toBe(0x08);
    expect(latch.bit(LATCH_KEYBOARD_ENABLE)).toBe(1);
  });

  it('&03 clears bit 3 again and leaves the other bits as they were', () => {
    const latch = new AddressableLatch();
    latch.drive(0x0e); // bit 6 := 1
    latch.drive(0x0b); // bit 3 := 1
    latch.drive(0x03); // bit 3 := 0
    expect(latch.value).toBe(0x40);
  });

  it('decodes every address: PB0-PB2 = n with PB3 = 1 sets bit n', () => {
    for (let n = 0; n < 8; n++) {
      const latch = new AddressableLatch();
      latch.drive(0x08 | n);
      expect(latch.value).toBe(1 << n);
    }
  });

  it('ignores PB4-PB7: only four lines reach it', () => {
    const latch = new AddressableLatch();
    latch.drive(0xf0); // address 0, data 0
    expect(latch.value).toBe(0x00);
    latch.drive(0xf8); // address 0, data 1
    expect(latch.value).toBe(0x01);
  });

  it('the MOS\'s start-up walk (&0E down to &08) sets bits 6-0 and leaves bit 7 alone', () => {
    const latch = new AddressableLatch();
    for (let x = 0x0e; x >= 0x08; x--) latch.drive(x);
    expect(latch.value).toBe(0x7f);
    expect(latch.bit(LATCH_SHIFT_LOCK_LED)).toBe(0);
  });

  it('a sound write is a pulse on bit 0: &00 (write enable on), then &08 (off)', () => {
    const latch = new AddressableLatch();
    latch.drive(0x08);
    latch.drive(0x00);
    expect(latch.bit(LATCH_SOUND_WRITE_ENABLE)).toBe(0);
    latch.drive(0x08);
    expect(latch.bit(LATCH_SOUND_WRITE_ENABLE)).toBe(1);
  });

  it('reports every bit it sets to the hardware log, as (bit, value)', () => {
    const log = new HardwareLog({ cycles: 0 });
    const latch = new AddressableLatch(log);
    latch.drive(0x0b);
    latch.drive(0x00);
    expect(log.recent().map((w) => [w.device, w.register, w.value])).toEqual([
      ['latch', 3, 1],
      ['latch', 0, 0],
    ]);
  });

  it('reset() clears all eight bits', () => {
    const latch = new AddressableLatch();
    latch.drive(0x0f);
    latch.reset();
    expect(latch.value).toBe(0x00);
  });
});
