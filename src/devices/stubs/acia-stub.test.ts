import { ACIA_CONTROL, ACIA_DATA, ACIA_IDLE_STATUS, ACIA_STATUS, ACIA_STATUS_IRQ, AciaStub } from './acia-stub';

describe('AciaStub (an idle 6850: serial and cassette are out of scope)', () => {
  it('status bit 7 (IRQ) is 0: the MOS\'s "was it you?" at &DCA2 gets "no" and moves on to the System VIA', () => {
    const acia = new AciaStub();
    expect(acia.read(ACIA_STATUS) & ACIA_STATUS_IRQ).toBe(0);
  });

  it('status reads &02: transmitter empty (TDRE), nothing received, no errors', () => {
    expect(new AciaStub().read(ACIA_STATUS)).toBe(ACIA_IDLE_STATUS);
    expect(ACIA_IDLE_STATUS).toBe(0x02);
  });

  it('status stays &02 whatever the control register says, even with interrupts enabled', () => {
    const acia = new AciaStub();
    acia.write(ACIA_CONTROL, 0x03); // master reset
    acia.write(ACIA_CONTROL, 0xb5); // receive and transmit interrupts on
    expect(acia.read(ACIA_STATUS)).toBe(0x02);
  });

  it('keeps the last control byte: the MOS\'s &56 is 8N1, divide by 64, both interrupts off', () => {
    const acia = new AciaStub();
    acia.write(ACIA_CONTROL, 0x03);
    acia.write(ACIA_CONTROL, 0x56);
    expect(acia.control).toBe(0x56);
  });

  it('a transmit-data write goes nowhere and leaves the control register alone', () => {
    const acia = new AciaStub();
    acia.write(ACIA_CONTROL, 0x56);
    acia.write(ACIA_DATA, 0x41);
    expect(acia.control).toBe(0x56);
    expect(acia.read(ACIA_STATUS)).toBe(0x02);
  });

  it('receive data reads &00: nothing has arrived', () => {
    expect(new AciaStub().read(ACIA_DATA)).toBe(0x00);
  });

  it('only register-select bit 0 counts: offset 2 is the status again (the slot mirrors)', () => {
    const acia = new AciaStub();
    expect(acia.read(2)).toBe(0x02);
    expect(acia.read(3)).toBe(0x00);
  });

  it('peek sees what read sees', () => {
    const acia = new AciaStub();
    expect(acia.peek(ACIA_STATUS)).toBe(acia.read(ACIA_STATUS));
    expect(acia.peek(ACIA_DATA)).toBe(acia.read(ACIA_DATA));
  });
});
