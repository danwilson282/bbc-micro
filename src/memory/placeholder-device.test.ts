import { PlaceholderDevice } from './placeholder-device';

describe('PlaceholderDevice', () => {
  it('drives nothing: read and peek return whatever the data bus last carried', () => {
    const bus = { dataBus: 0xfe };
    const device = new PlaceholderDevice('6522 VIA', bus);
    expect(device.read()).toBe(0xfe);
    bus.dataBus = 0x12;
    expect(device.peek()).toBe(0x12);
  });

  it('ignores writes, so the next read still floats', () => {
    const bus = { dataBus: 0x00 };
    const device = new PlaceholderDevice('6845 CRTC', bus);
    device.write();
    expect(device.read()).toBe(0x00);
    expect(device.name).toBe('6845 CRTC');
  });
});
