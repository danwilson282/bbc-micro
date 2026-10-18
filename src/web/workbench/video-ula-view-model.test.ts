import { buildVideoUlaView, type VideoUlaViewInput } from './video-ula-view-model';

/** The palettes MOS 1.20 leaves (measured in src/machine/ula-modes.test.ts), as stored: 16 hex digits, entry 0 first. */
function input(control: number, stored = '7766776644004400'): VideoUlaViewInput {
  return { control, entries: Array.from({ length: stored.length }, (_, i) => parseInt(stored.charAt(i), 16)) };
}

describe('Video ULA view: the control byte', () => {
  it('MODE 1\'s &D8: summary names the MODE and works out the pixels', () => {
    expect(buildVideoUlaView(input(0xd8)).summary).toBe('&D8: MODE 1. 4 pixels a byte, 2 bits each: 4 colours, 320 pixels across');
  });

  it('&9C is MODE 0 or 3: the ULA can\'t tell them apart', () => {
    expect(buildVideoUlaView(input(0x9c)).summary).toBe('&9C: MODE 0 or 3. 8 pixels a byte, 1 bit each: 2 colours, 640 pixels across');
  });

  it('the flash bit doesn\'t change the MODE: &F5 is MODE 2', () => {
    expect(buildVideoUlaView(input(0xf5)).summary).toBe('&F5: MODE 2. 2 pixels a byte, 4 bits each: 16 colours, 160 pixels across');
  });

  it('MODE 7\'s &4B: teletext, so the palette is not used', () => {
    expect(buildVideoUlaView(input(0x4b)).summary).toBe('&4B: MODE 7. Teletext: the SAA5050 colours the screen, and the palette is not used');
  });

  it('a byte no MOS MODE writes says so, and still works the pixels out', () => {
    expect(buildVideoUlaView(input(0x00)).summary).toBe('&00: not a MOS MODE. 2 pixels a byte, 4 bits each: 16 colours, 80 pixels across');
    expect(buildVideoUlaView(input(0x0c)).summary).toBe('&0C: not a MOS MODE. 16 pixels a byte: more than a byte has');
  });

  it('decodes &D8 field by field, highest bits first', () => {
    expect(buildVideoUlaView(input(0xd8)).fields).toEqual([
      { bits: '7-5', name: 'Cursor', value: '%110', meaning: 'segments 1 and 2: 2 bytes wide' },
      { bits: '4', name: 'Clock', value: '1', meaning: '6845 at 2 MHz: a byte every 0.5 µs' },
      { bits: '3-2', name: 'Pixel clock', value: '%10', meaning: '8 MHz (AUG: 40 characters a line): 8 ÷ 2 = 4 pixels a byte' },
      { bits: '1', name: 'Teletext', value: '0', meaning: 'off: the ULA\'s own pixels, through the palette' },
      { bits: '0', name: 'Flash', value: '0', meaning: 'first phase: flashing entries show their first colour' },
    ]);
  });

  it('MODE 7\'s cursor is segment 2 only: one byte, one byte late', () => {
    const fields = buildVideoUlaView(input(0x4b)).fields;
    expect(fields[0]?.meaning).toBe('segment 2: 1 byte wide, starting 1 byte late');
    expect(fields[3]?.meaning).toBe('on: the SAA5050\'s RGB; the palette is not used');
    expect(fields[4]?.meaning).toBe('second phase: flashing entries show their complement');
  });

  it('MODE 2\'s &F4 uses all four segments; no bits means no cursor', () => {
    expect(buildVideoUlaView(input(0xf4)).fields[0]?.meaning).toBe('segments 1, 2, 3 and 4: 4 bytes wide');
    expect(buildVideoUlaView(input(0x1c)).fields[0]?.meaning).toBe('none: no cursor');
  });
});

describe('Video ULA view: the palette swatches', () => {
  it('one swatch per entry, labelled in hex and binary with the nibble as stored', () => {
    const swatches = buildVideoUlaView(input(0xd8)).swatches;
    expect(swatches).toHaveLength(16);
    expect(swatches[10]).toMatchObject({ entry: '&A', binary: '1010', stored: '&0', colour: 7, name: 'white', css: '#ffffff', flashing: false });
    expect(swatches[2]).toMatchObject({ entry: '&2', binary: '0010', stored: '&6', colour: 1, name: 'red', css: '#ff0000' });
  });

  it('explains the EOR 7 in each swatch\'s title', () => {
    expect(buildVideoUlaView(input(0xd8)).swatches[8]?.title).toBe('Entry &8 (1000): stored &4, 4 EOR 7 = 3 yellow');
  });

  it('a flashing entry shows its colour in this phase, and names both', () => {
    // MODE 2's entry 9: physical 9 (red/cyan), stored as &E.
    const first = buildVideoUlaView(input(0xf4, '76543210FEDCBA98')).swatches[9];
    const second = buildVideoUlaView(input(0xf5, '76543210FEDCBA98')).swatches[9];
    expect(first).toMatchObject({ colour: 1, name: 'red/cyan', flashing: true });
    expect(second).toMatchObject({ colour: 6, name: 'red/cyan', flashing: true, css: '#00ffff' });
    expect(second.title).toBe('Entry &9 (1001): stored &E, flashing: 6 EOR 7 = 1 red, then cyan. Now cyan');
  });
});

describe('Video ULA view: the note under the swatches', () => {
  it('2 colours: only index bit 3 is the pixel', () => {
    expect(buildVideoUlaView(input(0x9c)).note).toBe('2 colours: only index bit 3 comes from the pixel, so the MOS sets entries 0-7 to one colour and 8-F to the other. Stage 41 shows why.');
  });

  it('4 colours: index bits 3 and 1', () => {
    expect(buildVideoUlaView(input(0xd8)).note).toBe('4 colours: index bits 3 and 1 come from the pixel, so the MOS writes each colour to four entries. Stage 41 shows why.');
  });

  it('16 colours: entry = logical colour', () => {
    expect(buildVideoUlaView(input(0xf4)).note).toBe('16 colours: all four index bits are the pixel, so entry n is logical colour n. 8-F flash.');
  });

  it('teletext: the entries are left from the last bitmap MODE', () => {
    expect(buildVideoUlaView(input(0x4b)).note).toBe('Teletext: the palette is not used. The MOS doesn\'t write it for MODE 7, so these entries are left from before.');
  });
});
