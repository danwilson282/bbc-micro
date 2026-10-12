import { VIA_ACR, VIA_DDRA, VIA_DDRB, VIA_ORA, VIA_ORB, VIA_T1C_L, Via6522, type PinListener, type ViaPort } from './via6522';

/** A listener that remembers every call, as [port, pins]. */
function recorder(): PinListener & { readonly calls: [ViaPort, number][] } {
  const calls: [ViaPort, number][] = [];
  return { calls, pinsChanged: (port, pins) => calls.push([port, pins]) };
}

describe('Via6522 pin listener (Stage 28)', () => {
  it('is told when a write to ORB changes port B\'s pins, with the new levels', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    const seen = recorder();
    via.connectPins(seen);
    via.write(VIA_ORB, 0x0b);
    expect(seen.calls).toEqual([['b', 0xfb]]); // PB0-3 driven 1011, PB4-7 inputs floating high
  });

  it('is told when a DDRB write changes the pins, even though ORB didn\'t change: the lines start driving ORB', () => {
    const via = new Via6522(); // ORB = &00, DDRB = &00: every line floats high
    const seen = recorder();
    via.connectPins(seen);
    via.write(VIA_DDRB, 0x0f);
    expect(seen.calls).toEqual([['b', 0xf0]]);
  });

  it('is not told when a write leaves the pins as they were', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    via.write(VIA_ORB, 0x03);
    const seen = recorder();
    via.connectPins(seen);
    via.write(VIA_ORB, 0x03); // the same value again
    via.write(VIA_ORB, 0x73); // only input bits differ: the pins don't
    via.write(VIA_T1C_L, 0x12); // nothing to do with the ports
    expect(seen.calls).toEqual([]);
  });

  it('is told about port A, from ORA writes and from setOutside', () => {
    const via = new Via6522();
    via.write(VIA_DDRA, 0x7f);
    const seen = recorder();
    via.connectPins(seen);
    via.write(VIA_ORA, 0x09);
    via.setOutside('a', 0x7f); // the outside pulls PA7 low
    expect(seen.calls).toEqual([
      ['a', 0x89],
      ['a', 0x09],
    ]);
  });

  it('is told when /RES puts every line back to input', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    const seen = recorder();
    via.connectPins(seen);
    via.reset();
    expect(seen.calls).toEqual([['b', 0xff]]);
  });

  it('may set the outside from inside the call (a keyboard answering on PA7), and is told once more, then it settles', () => {
    const via = new Via6522();
    via.write(VIA_DDRA, 0x7f);
    const calls: number[] = [];
    via.connectPins({
      pinsChanged: (port, pins) => {
        if (port !== 'a') return;
        calls.push(pins);
        via.setOutside('a', (pins & 0x7f) === 0x09 ? 0xff : 0x7f); // "key 9 is down"
      },
    });
    via.write(VIA_ORA, 0x02);
    expect(calls).toEqual([0x82, 0x02]); // floated high, then pulled low: nothing more
    expect(via.read(VIA_ORA)).toBe(0x02);
  });

  it('counts Timer 1\'s PB7 as a pin when an ACR write hands PB7 to it', () => {
    const via = new Via6522();
    const seen = recorder();
    via.connectPins(seen);
    via.write(VIA_ACR, 0x80); // T1 drives PB7, and it starts high
    expect(seen.calls).toEqual([]); // PB7 was floating high, and T1 drives it high: no change
  });

  it('can be disconnected', () => {
    const via = new Via6522();
    via.write(VIA_DDRB, 0x0f);
    const seen = recorder();
    via.connectPins(seen);
    via.connectPins(undefined);
    via.write(VIA_ORB, 0x0b);
    expect(seen.calls).toEqual([]);
  });
});
