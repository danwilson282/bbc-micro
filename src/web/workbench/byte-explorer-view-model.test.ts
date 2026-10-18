import { MOS_DEFAULT_PALETTE } from '../../mos/mos-video-ula';
import { buildByteExplorerView, cyclePixel, parseByte, toggleBit } from './byte-explorer-view-model';

function row(byte: number, mode: 0 | 1 | 2) {
  const r = buildByteExplorerView({ byte }).modes.find((m) => m.mode === mode);
  if (r === undefined) throw new Error(`no MODE ${String(mode)} row`);
  return r;
}

describe('Byte explorer view-model', () => {
  test('summary shows the byte in hex, binary nibbles and decimal', () => {
    expect(buildByteExplorerView({ byte: 0xa5 }).summary).toBe('&A5 = %1010 0101 = 165');
    expect(buildByteExplorerView({ byte: 0xa5 }).bits).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
  });

  test('MODE 1 &A5: bits owned 0 1 2 3 0 1 2 3, pixels logical 2 1 2 1 = yellow red yellow red', () => {
    const r = row(0xa5, 1);
    expect(r.heading).toBe('MODE 1: 4 pixels, 2 bits each (4 colours)');
    expect(r.bitOwners).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(r.pixels.map((p) => p.label)).toEqual(['2', '1', '2', '1']);
    expect(r.pixels.map((p) => p.colour)).toEqual([3, 1, 3, 1]);
    expect(r.pixels[0]?.title).toBe('Pixel 0: b7 b3 = %10 = logical 2. The ULA reads index &C (%1100), which the MOS sets to yellow. Click to change');
  });

  test('MODE 2 bit owners alternate 0 1 0 1..., MODE 0 owners are 0-7', () => {
    expect(row(0, 2).bitOwners).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(row(0, 0).bitOwners).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('every row is one byte wide: pixel widths add up to 8', () => {
    for (const m of [0, 1, 2] as const) expect(row(0x5a, m).pixels.reduce((t, p) => t + p.width, 0)).toBe(8);
  });

  test('MODE 2 &FF is colour 15 twice: white, flashing; &3F is plain white', () => {
    expect(row(0xff, 2).pixels.map((p) => [p.label, p.colour, p.flashing])).toEqual([['15', 7, true], ['15', 7, true]]);
    expect(row(0x3f, 2).pixels.map((p) => [p.label, p.flashing])).toEqual([['7', false], ['7', false]]);
  });

  test('no live row without a ULA', () => {
    expect(buildByteExplorerView({ byte: 0 }).live).toBeUndefined();
  });

  test('live row in MODE 1 shows the palette indices the ULA really reads: &C &3 &9 &7', () => {
    const live = buildByteExplorerView({ byte: 0xa5, ula: { control: 0xd8, entries: MOS_DEFAULT_PALETTE[1] } }).live;
    expect(live?.heading).toBe('The ULA now (&D8, MODE 1): 4 pixels a byte');
    expect(live?.pixels.map((p) => p.label)).toEqual(['&C', '&3', '&9', '&7']);
    expect(live?.pixels.map((p) => p.colour)).toEqual([3, 1, 3, 1]);
  });

  test('live row with a changed palette entry: only pixels reading that entry change', () => {
    const entries = [...MOS_DEFAULT_PALETTE[1]];
    entries[0xc] = 2 ^ 7; // green, stored inverted
    const live = buildByteExplorerView({ byte: 0xa5, ula: { control: 0xd8, entries } }).live;
    expect(live?.pixels.map((p) => p.colour)).toEqual([2, 1, 3, 1]);
  });

  test('live row in MODE 7 says teletext is on', () => {
    const live = buildByteExplorerView({ byte: 0, ula: { control: 0x4b, entries: new Array<number>(16).fill(0) } }).live;
    expect(live?.heading).toBe('The ULA now (&4B, MODE 7): 8 pixels a byte. Teletext is on, so the screen shows the SAA5050, not these');
  });

  test('live row at 16 pixels a byte: the last 8 read entry &F', () => {
    // &8C: 16 MHz pixel clock, 1 MHz bytes. Not a MOS MODE.
    const live = buildByteExplorerView({ byte: 0, ula: { control: 0x8c, entries: new Array<number>(16).fill(7) } }).live;
    expect(live?.heading).toBe('The ULA now (&8C, not a MOS MODE): 16 pixels a byte');
    expect(live?.pixels.slice(8).map((p) => p.label)).toEqual(new Array<string>(8).fill('&F'));
  });

  test('parseByte accepts &A5, A5, $a5, 0xA5 and %10100101; rejects bigger or junk', () => {
    for (const t of ['&A5', 'A5', '$a5', '0xA5', ' %10100101 ']) expect(parseByte(t)).toBe(0xa5);
    for (const t of ['&100', '%111111111', 'G1', '']) expect(parseByte(t)).toBeUndefined();
  });

  test('toggleBit inverts one bit', () => {
    expect(toggleBit(0x00, 7)).toBe(0x80);
    expect(toggleBit(0x81, 0)).toBe(0x80);
  });

  test('cyclePixel moves one pixel to its next logical colour, wrapping, and leaves the rest', () => {
    // MODE 1 &A5 = 2 1 2 1; pixel 1 → 2 gives 2 2 2 1 = b6 set, b2 clear: &E1.
    expect(cyclePixel(0xa5, 2, 1)).toBe(0xe1);
    expect(cyclePixel(0xff, 2, 0)).toBe(0x77); // 3 → 0
    expect(cyclePixel(0x00, 4, 1)).toBe(0x01); // right pixel 0 → 1 is bit 0
    expect(cyclePixel(0x00, 1, 7)).toBe(0x01);
  });
});
