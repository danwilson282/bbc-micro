import { buildRomImage, describeRomType, parseRomHeader, romCpuName, type RomPeek } from './rom-header';

/** BASIC II's first 35 bytes, as in roms/basic2.rom. The rest of the 16K is &FF here. */
const BASIC2_START = [
  0xc9, 0x01, 0xf0, 0x1f, 0x60, 0xea, 0x60, 0x0e, 0x01, 0x42, 0x41, 0x53, 0x49, 0x43, 0x00, 0x28,
  0x43, 0x29, 0x31, 0x39, 0x38, 0x32, 0x20, 0x41, 0x63, 0x6f, 0x72, 0x6e, 0x0a, 0x0d, 0x00, 0x00,
  0x80, 0x00, 0x00,
];

/** Reads a 16K image as if it were paged in at &8000. */
function peekImage(image: Uint8Array): RomPeek {
  return (address) => image[(address - 0x8000) & 0x3fff] ?? 0xff;
}

function imageOf(bytes: readonly number[]): Uint8Array {
  const image = new Uint8Array(0x4000).fill(0xff);
  image.set(bytes);
  return image;
}

describe('parseRomHeader: a real header (BASIC II)', () => {
  const result = parseRomHeader(peekImage(imageOf(BASIC2_START)));

  it('accepts it: &00 ( C ) sits at &8000 + the copyright offset (&0E)', () => {
    expect(result.ok).toBe(true);
  });

  it('reads the raw fields: type &60 at &8006, copyright offset &0E at &8007, binary version &01 at &8008', () => {
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.type).toBe(0x60);
    expect(result.header.copyrightOffset).toBe(0x0e);
    expect(result.header.binaryVersion).toBe(0x01);
  });

  it('decodes type &60 as a language with a relocation address, 6502 BASIC, and no service entry', () => {
    if (!result.ok) throw new Error(result.reason);
    const h = result.header;
    expect([h.hasServiceEntry, h.hasLanguageEntry, h.hasRelocationAddress, h.hasElectronKeys]).toEqual([false, true, true, false]);
    expect(h.cpuType).toBe(0);
    expect(h.cpuName).toBe('6502 BASIC');
  });

  it('reads the title from &8009, and finds no version string because the title ends at the copyright offset', () => {
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.title).toBe('BASIC');
    expect(result.header.versionString).toBeUndefined();
  });

  it('reads the copyright string after its &00, keeping the bytes as they are (BASIC ends it with LF CR)', () => {
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.copyright).toBe('(C)1982 Acorn\n\r');
  });

  it('reads the 4-byte relocation address after the copyright string, because type bit 5 is set: &00008000', () => {
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.relocationAddress).toBe(0x00008000);
  });
});

describe('parseRomHeader: what the MOS would reject', () => {
  it('an empty slot reading the floating bus (&80 everywhere): the offset is &80 and &8080 is not &00', () => {
    const result = parseRomHeader(() => 0x80);
    expect(result).toEqual({ ok: false, reason: 'no "(C)" at &8080 (copyright offset &80): not a ROM' });
  });

  it('a blank EPROM (&FF everywhere)', () => {
    expect(parseRomHeader(() => 0xff).ok).toBe(false);
  });

  it('a near miss: &00 ( C but then not )', () => {
    const image = imageOf([0, 0, 0, 0, 0, 0, 0x82, 0x0a, 0, 0x41, 0x00, 0x28, 0x43, 0x5d]);
    expect(parseRomHeader(peekImage(image)).ok).toBe(false);
  });

  it('a copyright offset pointing back into the fixed header (below &09)', () => {
    // Offset &03: &8003-&8006 hold &00 ( C ), so the type byte is ")" (&29).
    const image = imageOf([0, 0, 0, 0x00, 0x28, 0x43, 0x29, 0x03]);
    const result = parseRomHeader(peekImage(image));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/inside the fixed header/);
  });
});

describe('parseRomHeader: other shapes of header', () => {
  it('finds a version string between the title and the copyright', () => {
    const image = buildRomImage({ type: 0x82, binaryVersion: 0x20, title: 'DFS', version: '1.20', copyright: '(C)1982 Acorn' });
    const result = parseRomHeader(peekImage(image));
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.title).toBe('DFS');
    expect(result.header.versionString).toBe('1.20');
    expect(result.header.copyright).toBe('(C)1982 Acorn');
    expect(result.header.relocationAddress).toBeUndefined();
  });

  it('decodes type &82 as a service ROM of 6502 code with no language entry', () => {
    const result = parseRomHeader(peekImage(buildRomImage({ type: 0x82, title: 'X', copyright: '(C)' })));
    if (!result.ok) throw new Error(result.reason);
    expect([result.header.hasServiceEntry, result.header.hasLanguageEntry]).toEqual([true, false]);
    expect(result.header.cpuName).toBe('6502 code');
  });

  it('reads an empty title as ""', () => {
    const result = parseRomHeader(peekImage(buildRomImage({ type: 0x82, title: '', copyright: '(C) Me' })));
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.title).toBe('');
    expect(result.header.copyright).toBe('(C) Me');
  });

  it('reads a relocation address above &7FFFFFFF as a positive number', () => {
    const image = buildRomImage({ type: 0xe2, title: 'T', copyright: '(C)', relocationAddress: 0xf0008000 });
    const result = parseRomHeader(peekImage(image));
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.relocationAddress).toBe(0xf0008000);
  });

  it('stops a string at &BFFF, the top of the window, even with no &00', () => {
    const image = buildRomImage({ type: 0x82, title: 'T', copyright: '(C)' });
    image.fill(0x41, 0x0e); // overwrite the copyright's &00 terminator and everything after with "A"
    const result = parseRomHeader(peekImage(image));
    if (!result.ok) throw new Error(result.reason);
    expect(result.header.copyright.length).toBeLessThanOrEqual(0x4000);
  });
});

describe('buildRomImage: a fake ROM for tests and demos', () => {
  it('lays out the header the way the parser reads it, BASIC II byte for byte', () => {
    const image = buildRomImage({ type: 0x60, binaryVersion: 0x01, title: 'BASIC', copyright: '(C)1982 Acorn\n\r', relocationAddress: 0x8000 });
    // BASIC's entry code differs (ours is RTS), so compare from the type byte on.
    expect([...image.subarray(6, 35)]).toEqual(BASIC2_START.slice(6));
  });

  it('puts RTS (&60) at both entries, so calling a fake ROM just returns', () => {
    const image = buildRomImage({ type: 0xc2, title: 'T', copyright: '(C)' });
    expect([image[0], image[3]]).toEqual([0x60, 0x60]);
  });

  it('fills the rest with &FF, like an erased EPROM', () => {
    expect(buildRomImage({ type: 0x82, title: 'T', copyright: '(C)' })[0x3fff]).toBe(0xff);
  });

  it('refuses a copyright string that does not start with "(C)", because the MOS would not accept it', () => {
    expect(() => buildRomImage({ type: 0x82, title: 'T', copyright: 'Acorn' })).toThrow(RangeError);
  });
});

describe('naming the type byte', () => {
  it.each([
    [0, '6502 BASIC'],
    [2, '6502 code'],
    [3, '68000'],
    [8, 'Z80'],
    [9, '32016'],
    [5, 'code type 5'],
  ])('code type %d is %s', (cpu, name) => {
    expect(romCpuName(cpu)).toBe(name);
  });

  it.each([
    ['60', 0x60, 'language, relocation address; 6502 BASIC'],
    ['82', 0x82, 'service; 6502 code'],
    ['C2', 0xc2, 'service, language; 6502 code'],
    ['02', 0x02, 'no entries; 6502 code'],
  ])('type &%s (%d) reads as "%s"', (_hex, type, text) => {
    expect(describeRomType(type)).toBe(text);
  });
});
