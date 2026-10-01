import type { ListingLine } from '../../playground/listing';
import { TestBus } from '../../memory/test-bus';
import { testBusTarget } from './debug-target';
import { buildListingView } from './listing-view-model';

const LINES: readonly ListingLine[] = [
  { address: 0x0400, bytes: [0xa9, 0x41], source: 'LDA #&41', comment: 'A=&41' },
  { address: 0x0402, bytes: [0xbd, 0x00, 0x7c], source: 'LDA &7C00,X', comment: 'indexed' },
];

function target(): ReturnType<typeof testBusTarget> {
  const bus = new TestBus();
  bus.load(0x0400, [0xa9, 0x41, 0xbd, 0x00, 0x7c]);
  return testBusTarget(bus);
}

describe('buildListingView', () => {
  it('shows each line as address, bytes, source and comment in & hex', () => {
    expect(buildListingView(LINES, target(), 0x0400)).toEqual([
      { address: 0x0400, addressHex: '&0400', bytes: 'A9 41', source: 'LDA #&41', comment: 'A=&41', current: true, modified: false },
      {
        address: 0x0402,
        addressHex: '&0402',
        bytes: 'BD 00 7C',
        source: 'LDA &7C00,X',
        comment: 'indexed',
        current: false,
        modified: false,
      },
    ]);
  });

  it('marks the line whose opcode PC is on, and none when PC is outside the listing', () => {
    expect(buildListingView(LINES, target(), 0x0402).map((r) => r.current)).toEqual([false, true]);
    expect(buildListingView(LINES, target(), 0x0403).map((r) => r.current)).toEqual([false, false]);
  });

  it('flags a line as modified when memory no longer holds its bytes', () => {
    const t = target();
    t.poke(0x0404, 0x7d); // LDA &7C00,X becomes LDA &7D00,X in memory
    expect(buildListingView(LINES, t, 0x0400).map((r) => r.modified)).toEqual([false, true]);
  });
});
