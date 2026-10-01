import { TestBus } from '../memory/test-bus';
import { listingEnd, loadListing, type ListingLine } from './listing';

const LINES: readonly ListingLine[] = [
  { address: 0x0400, bytes: [0xa9, 0x41], source: 'LDA #&41', comment: '' },
  { address: 0x0402, bytes: [0xad, 0x00, 0x7c], source: 'LDA &7C00', comment: '' },
];

describe('loadListing', () => {
  it('writes each line\'s bytes at its address, operands low byte first', () => {
    const bus = new TestBus();
    loadListing(bus, LINES);
    expect([0x0400, 0x0401, 0x0402, 0x0403, 0x0404].map((a) => bus.read(a))).toEqual([0xa9, 0x41, 0xad, 0x00, 0x7c]);
    expect(bus.read(0x0405)).toBe(0x00);
  });
});

describe('listingEnd', () => {
  it('is the address just after the last byte', () => {
    expect(listingEnd(LINES)).toBe(0x0405);
  });

  it('is 0 for an empty listing', () => {
    expect(listingEnd([])).toBe(0);
  });
});
