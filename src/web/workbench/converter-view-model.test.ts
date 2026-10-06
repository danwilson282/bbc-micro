import { convertFrom, describeNumber, formatBinaryGroups, type ConvertResult } from './converter-view-model';

function converted(result: ConvertResult) {
  if (!result.ok) throw new Error(`expected a conversion, got "${result.error}"`);
  return result.conversion;
}

describe('describeNumber', () => {
  it('shows &41 as 65, %0100 0001 and the letter A', () => {
    expect(describeNumber(0x41)).toMatchObject({
      width: 8,
      hex: '&41',
      decimal: '65',
      binary: '%0100 0001',
      ascii: 'A',
      notes: ['ASCII &41 is "A".'],
    });
  });

  it('names control codes instead of printing them: &0D is CR', () => {
    const c = describeNumber(0x0d);
    expect(c.ascii).toBe('');
    expect(c.asciiHint).toBe('CR');
    expect(c.notes[0]).toBe('ASCII &0D is CR (carriage return), a control code: it has no printable character.');
    expect(describeNumber(0x7f).asciiHint).toBe('DEL');
    expect(describeNumber(0x00).asciiHint).toBe('NUL');
  });

  it('shows a space as a real space with a "space" hint', () => {
    expect(describeNumber(0x20)).toMatchObject({ ascii: ' ', asciiHint: 'space' });
  });

  it('says a byte with bit 7 set is not ASCII, and gives its signed value', () => {
    const c = describeNumber(0xc8);
    expect(c.asciiHint).toBe('not ASCII');
    expect(c.notes).toEqual([
      "&C8 has bit 7 set, so it isn't ASCII (ASCII is 7-bit: &00-&7F).",
      'As a signed byte: -56 (bit 7 is worth -128, so &C8 - &100).',
    ]);
  });

  it('gives no signed note for a byte below &80, where signed and unsigned agree', () => {
    expect(describeNumber(0x7f).notes).toHaveLength(1);
  });

  it('widens to 16 bits above &FF, and shows the bytes in 6502 memory order', () => {
    const c = describeNumber(0x4142);
    expect(c).toMatchObject({ width: 16, hex: '&4142', decimal: '16706', binary: '%0100 0001 0100 0010', ascii: '', asciiHint: '2 bytes' });
    expect(c.notes).toEqual([
      'ASCII is one byte per character: high byte &41 is A, low byte &42 is B.',
      'In memory, low byte first (6502 order): 42 41.',
    ]);
  });

  it('gives the signed value of a word with bit 15 set', () => {
    expect(describeNumber(0xff38).notes).toContain('As a signed word: -200 (bit 15 is worth -32768, so &FF38 - &10000).');
  });
});

describe('formatBinaryGroups', () => {
  it('groups bits in fours so each group is one hex digit', () => {
    expect(formatBinaryGroups(0x00, 8)).toBe('%0000 0000');
    expect(formatBinaryGroups(0xffff, 16)).toBe('%1111 1111 1111 1111');
  });
});

describe('convertFrom', () => {
  it('reads hex as bare, &, $ or 0x', () => {
    for (const text of ['41', '&41', '$41', '0x41', ' &41 ']) expect(converted(convertFrom('hex', text)).value).toBe(0x41);
  });

  it('keeps a hex byte typed with leading zeros as its value', () => {
    expect(converted(convertFrom('hex', '&0041')).hex).toBe('&41');
  });

  it('rejects hex that is not hex, or wider than 16 bits', () => {
    expect(convertFrom('hex', '&4G')).toEqual({ ok: false, error: 'Hex is digits 0-9 and A-F, e.g. &41' });
    expect(convertFrom('hex', '&10000')).toEqual({ ok: false, error: 'Hex must fit in 16 bits: &0000-&FFFF' });
  });

  it('stores negative decimals as two\'s complement: -1 is &FF, -128 is &80, -200 is &FF38', () => {
    expect(converted(convertFrom('decimal', '-1')).hex).toBe('&FF');
    expect(converted(convertFrom('decimal', '-128')).hex).toBe('&80');
    expect(converted(convertFrom('decimal', '-129')).hex).toBe('&FF7F');
    expect(converted(convertFrom('decimal', '-200')).hex).toBe('&FF38');
    expect(converted(convertFrom('decimal', '-32768')).hex).toBe('&8000');
  });

  it('rejects decimals outside -32768 to 65535, and non-integers', () => {
    expect(convertFrom('decimal', '65536')).toEqual({ ok: false, error: 'Decimal must be -32768 to 65535' });
    expect(convertFrom('decimal', '-32769')).toEqual({ ok: false, error: 'Decimal must be -32768 to 65535' });
    expect(convertFrom('decimal', '1.5')).toEqual({ ok: false, error: 'Decimal is a whole number, e.g. 65 or -1' });
  });

  it('reads binary with or without % and with spaces between groups', () => {
    for (const text of ['%0100 0001', '01000001', '%0100_0001', '1000001']) expect(converted(convertFrom('binary', text)).value).toBe(0x41);
  });

  it('rejects binary with other digits, or more than 16 bits', () => {
    expect(convertFrom('binary', '%0102')).toEqual({ ok: false, error: 'Binary is digits 0 and 1, e.g. %0100 0001' });
    expect(convertFrom('binary', '1'.repeat(17))).toEqual({ ok: false, error: 'Binary must fit in 16 bits' });
  });

  it('reads one printable ASCII character, including a space', () => {
    expect(converted(convertFrom('ascii', 'A')).hex).toBe('&41');
    expect(converted(convertFrom('ascii', ' ')).hex).toBe('&20');
    expect(converted(convertFrom('ascii', '~')).hex).toBe('&7E');
  });

  it('rejects empty, multi-character and non-ASCII text in the ASCII field', () => {
    expect(convertFrom('ascii', '')).toEqual({ ok: false, error: 'ASCII is one character' });
    expect(convertFrom('ascii', 'AB')).toEqual({ ok: false, error: 'ASCII is one character' });
    expect(convertFrom('ascii', '£')).toEqual({ ok: false, error: 'ASCII characters are &20-&7E (space to ~); type a control code as hex' });
  });

  it('round-trips every 16-bit value through hex, decimal and binary', () => {
    for (let v = 0; v <= 0xffff; v++) {
      const c = describeNumber(v);
      expect(converted(convertFrom('hex', c.hex)).value).toBe(v);
      expect(converted(convertFrom('decimal', c.decimal)).value).toBe(v);
      expect(converted(convertFrom('binary', c.binary)).value).toBe(v);
    }
  });
});
