import { Via6522 } from '../via6522';
import { FakeVsync, VSYNC_PERIOD_CYCLES, VSYNC_WIDTH_CYCLES } from './fake-vsync';

const IFR = 0x0d;
const IER = 0x0e;
const PCR = 0x0c;
const IFR_CA1 = 0x02;

/** A System VIA set up as the MOS leaves it: PCR &04 (CA1 on a falling edge), CA1 enabled. */
function systemVia(): Via6522 {
  const via = new Via6522();
  via.write(PCR, 0x04);
  via.write(IER, 0x82);
  return via;
}

describe('FakeVsync (a stand-in for the CRTC\'s VSYNC on System VIA CA1, until Stage 38)', () => {
  it('one frame is 40,000 cycles (50 Hz at 2 MHz) and the pulse is 256 cycles (2 lines of 64 µs)', () => {
    expect(VSYNC_PERIOD_CYCLES).toBe(2_000_000 / 50);
    expect(VSYNC_WIDTH_CYCLES).toBe(2 * 64 * 2);
  });

  it('starts just after a pulse: CA1 high, and the first falling edge 39,744 cycles later', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    expect(via.controlLine('ca1')).toBe(1);
    vsync.tick(VSYNC_PERIOD_CYCLES - VSYNC_WIDTH_CYCLES - 1);
    expect(via.controlLine('ca1')).toBe(1);
    expect(vsync.pulses).toBe(0);
    vsync.tick(1);
    expect(via.controlLine('ca1')).toBe(0);
    expect(vsync.pulses).toBe(1);
  });

  it('the falling edge sets IFR bit 1 (CA1) and the VIA pulls /IRQ low', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    vsync.tick(VSYNC_PERIOD_CYCLES);
    expect(via.read(IFR) & IFR_CA1).toBe(IFR_CA1);
    expect(via.irq).toBe(true);
  });

  it('CA1 goes high again 256 cycles after it fell', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    vsync.tick(VSYNC_PERIOD_CYCLES - VSYNC_WIDTH_CYCLES);
    vsync.tick(VSYNC_WIDTH_CYCLES - 1);
    expect(via.controlLine('ca1')).toBe(0);
    vsync.tick(1);
    expect(via.controlLine('ca1')).toBe(1);
  });

  it('ticked an instruction at a time (7 cycles), it pulses 50 times in 2,000,000 cycles', () => {
    const vsync = new FakeVsync(systemVia());
    for (let c = 0; c < 2_000_000; c += 8) vsync.tick(8); // 8 divides 40,000 and 256
    expect(vsync.pulses).toBe(50);
  });

  it('one big tick that spans several frames still makes every pulse', () => {
    const vsync = new FakeVsync(systemVia());
    vsync.tick(10 * VSYNC_PERIOD_CYCLES);
    expect(vsync.pulses).toBe(10);
  });

  it('the handler acknowledges (writes &02 to IFR); the next frame sets the flag again', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    vsync.tick(VSYNC_PERIOD_CYCLES);
    via.write(IFR, IFR_CA1);
    expect(via.irq).toBe(false);
    vsync.tick(VSYNC_PERIOD_CYCLES);
    expect(via.irq).toBe(true);
  });

  it('with PCR bit 0 = 1 (rising edge), the interrupt comes at the END of the pulse instead', () => {
    const via = systemVia();
    via.write(PCR, 0x05);
    const vsync = new FakeVsync(via);
    vsync.tick(VSYNC_PERIOD_CYCLES - VSYNC_WIDTH_CYCLES);
    expect(via.irq).toBe(false);
    vsync.tick(VSYNC_WIDTH_CYCLES);
    expect(via.irq).toBe(true);
  });

  it('disabled: CA1 stays high and nothing is counted', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    vsync.enabled = false;
    vsync.tick(5 * VSYNC_PERIOD_CYCLES);
    expect(vsync.pulses).toBe(0);
    expect(via.controlLine('ca1')).toBe(1);
    expect(via.irq).toBe(false);
  });

  it('disabled in the middle of a pulse: CA1 goes back high at once', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    vsync.tick(VSYNC_PERIOD_CYCLES - VSYNC_WIDTH_CYCLES);
    expect(via.controlLine('ca1')).toBe(0);
    vsync.enabled = false;
    expect(via.controlLine('ca1')).toBe(1);
  });

  it('reset(): CA1 high, the count back to 0, and the next edge a whole frame (less the pulse) away', () => {
    const via = systemVia();
    const vsync = new FakeVsync(via);
    vsync.tick(VSYNC_PERIOD_CYCLES + 10);
    vsync.reset();
    expect(vsync.pulses).toBe(0);
    expect(via.controlLine('ca1')).toBe(1);
    vsync.tick(VSYNC_PERIOD_CYCLES - VSYNC_WIDTH_CYCLES);
    expect(vsync.pulses).toBe(1);
  });
});
