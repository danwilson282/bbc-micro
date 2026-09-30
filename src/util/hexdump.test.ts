import { hexdump, type ByteSource } from './hexdump';

/** A 64K byte source backed by a plain object, so these tests don't depend on src/memory. */
function source(bytes: Record<number, number>): ByteSource {
  return { read: (address: number): number => bytes[address & 0xffff] ?? 0x00 };
}

const HELLO = 'HELLO, BBC MICRO';

function textAt(start: number, text: string): Record<number, number> {
  const bytes: Record<number, number> = {};
  for (let i = 0; i < text.length; i++) bytes[start + i] = text.charCodeAt(i);
  return bytes;
}

describe('hexdump', () => {
  it('formats a row as address, 8 + 8 bytes, and an ASCII column', () => {
    expect(hexdump(source(textAt(0x7c00, HELLO)), 0x7c00, 16)).toBe(
      '7C00  48 45 4C 4C 4F 2C 20 42  42 43 20 4D 49 43 52 4F  |HELLO, BBC MICRO|',
    );
  });

  it('shows only printable ASCII (&20-&7E) as text; &0D, &7F and &80+ appear as "."', () => {
    const bytes = { 0: 0x1f, 1: 0x20, 2: 0x41, 3: 0x7e, 4: 0x7f, 5: 0x80, 6: 0x0d, 7: 0xff };
    expect(hexdump(source(bytes), 0x0000, 8)).toBe(
      '0000  1F 20 41 7E 7F 80 0D FF                           |. A~....|',
    );
  });

  it('pads a short last row so the ASCII column lines up with full rows', () => {
    const lines = hexdump(source(textAt(0x2000, 'ABCDEFGHIJKLMNOPQRS')), 0x2000, 19).split('\n');
    expect(lines).toEqual([
      '2000  41 42 43 44 45 46 47 48  49 4A 4B 4C 4D 4E 4F 50  |ABCDEFGHIJKLMNOP|',
      '2010  51 52 53                                          |QRS|',
    ]);
    const firstLine = lines[0] ?? '';
    const lastLine = lines[1] ?? '';
    expect(lastLine.indexOf('|')).toBe(firstLine.indexOf('|'));
  });

  it('pads correctly across the mid-row gap (a row of exactly 9 bytes)', () => {
    expect(hexdump(source({}), 0x0000, 9)).toBe(
      '0000  00 00 00 00 00 00 00 00  00                       |.........|',
    );
  });

  it('starts each row 16 bytes after the last, from wherever the dump starts', () => {
    const lines = hexdump(source({}), 0x0003, 40).split('\n');
    expect(lines.map((l) => l.slice(0, 4))).toEqual(['0003', '0013', '0023']);
  });

  it('wraps from &FFFF to &0000, as the 16-bit address bus does', () => {
    const bytes = { 0xfffe: 0xaa, 0xffff: 0xbb, 0x0000: 0xcc, 0x0001: 0xdd };
    const lines = hexdump(source(bytes), 0xfff8, 24).split('\n');
    expect(lines[0]).toBe(
      'FFF8  00 00 00 00 00 00 AA BB  CC DD 00 00 00 00 00 00  |................|',
    );
    expect(lines[1]?.slice(0, 4)).toBe('0008');
  });

  it('reads every byte exactly once, in address order (reads of I/O can have side effects)', () => {
    const reads: number[] = [];
    const spy: ByteSource = {
      read: (address: number): number => {
        reads.push(address);
        return 0;
      },
    };
    hexdump(spy, 0xfffe, 4);
    expect(reads).toEqual([0xfffe, 0xffff, 0x0000, 0x0001]);
  });

  it('returns an empty string for a length of 0', () => {
    expect(hexdump(source({}), 0x1234, 0)).toBe('');
  });

  it.each([-1, 1.5, Number.NaN])('rejects a length of %p', (length) => {
    expect(() => hexdump(source({}), 0, length)).toThrow(RangeError);
  });
});
