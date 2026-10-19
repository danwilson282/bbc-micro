// Stage 51: software from disc. *RUN, CHAIN, SHIFT-BREAK and SAVE, with the
// real MOS, BASIC and DFS, on discs our own tools made. And, with no ROMs at
// all, a sector written through real NMIs by a 6502 program of our own.

import { assemble, formatError } from '../asm/assembler';
import { tokeniseProgram } from '../basic/tokenise';
import { describeFdcEntry } from '../devices/fdc-log';
import { BASIC_EXEC_ADDRESS, BASIC_LOAD_ADDRESS, GREET_OUTPUT, buildBlankDisc, buildDemoDisc } from '../disc/demo-disc';
import { readCatalogue, readFile } from '../disc/dfs-disc';
import { DiscImage, SECTOR_SIZE, TRACK_SIZE } from '../disc/disc-image';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7StartAddress, mode7Text } from '../video/mode7-text';
import { BbcModelB } from './bbc-model-b';
import { shiftBreak } from './shift-break';
import { typeText } from './type-text';

const ALL = ['roms/os12.rom', 'roms/basic2.rom', 'roms/dfs.rom'] as const;

function run(m: BbcModelB, frames: number): void {
  for (let i = 0; i < frames; i++) m.runFrame();
}

function screen(m: BbcModelB): string[] {
  return mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13))).map((r) => r.trimEnd());
}

/** The screen's rows after the one that ends with `command`. */
function after(m: BbcModelB, command: string): string[] {
  const rows = screen(m);
  const at = rows.lastIndexOf(`>${command}`);
  return at < 0 ? [] : rows.slice(at + 1);
}

/** MOS + BASIC + DFS, powered on with `disc` in drive 0, at the > prompt. */
function booted(disc: DiscImage, writeProtected = false): BbcModelB {
  const m = new BbcModelB();
  loadStandardRoms(m.map);
  m.insertDisc(0, disc, writeProtected);
  m.powerOn();
  run(m, 100);
  return m;
}

const demo = (): DiscImage => DiscImage.fromBytes(buildDemoDisc(), 'ssd', 'demo.ssd');
const blank = (): DiscImage => DiscImage.fromBytes(buildBlankDisc(), 'ssd', 'blank.ssd');

/** MODE 2's Video ULA control byte (Advanced User Guide, VDU 22 table). Bit 0 is the flash phase, which the MOS turns over. */
const ULA_MODE_2 = 0xf4;
const ULA_FLASH = 0x01;

describe('loading and running from the demo disc', () => {
  withRoms(...ALL)('*RUN HELLO loads our assembled program at &1900 and jumps to it: it prints its message', () => {
    const m = booted(demo());
    typeText(m, '*RUN HELLO\r');
    run(m, 50);
    expect(after(m, '*RUN HELLO').slice(0, 2)).toEqual(['HELLO FROM DISC', '>']);
  });

  withRoms(...ALL)('CHAIN "GREET" loads our tokenised BASIC at PAGE and runs it', () => {
    const m = booted(demo());
    typeText(m, 'CHAIN "GREET"\r');
    run(m, 50);
    expect(after(m, 'CHAIN "GREET"').slice(0, GREET_OUTPUT.length + 1)).toEqual([...GREET_OUTPUT, '>']);
  });

  withRoms(...ALL)('after CHAIN, the program in memory from PAGE (&1900) is the file\'s bytes, as our tokeniser made them', () => {
    const disc = demo();
    const m = booted(disc);
    typeText(m, 'CHAIN "GREET"\r');
    run(m, 50);
    const entry = readCatalogue(disc, 0).files.find((f) => f.name === 'GREET');
    if (entry === undefined) throw new Error('no GREET on the demo disc');
    const file = readFile(disc, 0, entry);
    expect(m.peek(0x18)).toBe(0x19); // PAGE's high byte
    expect(Array.from(file, (_, i) => m.peek(0x1900 + i))).toEqual(Array.from(file));
  });

  withRoms(...ALL)('SHIFT-BREAK boots it: !BOOT is EXECed, CHAINs DEMO, and DEMO goes to MODE 2 and keeps turning its colours', () => {
    const m = booted(demo());
    const log = m.fdcLog.count;
    shiftBreak(m);
    run(m, 150);
    expect(m.videoUla.control & ~ULA_FLASH).toBe(ULA_MODE_2);
    const before = m.videoUla.paletteEntry(1);
    run(m, 25);
    expect(m.videoUla.paletteEntry(1)).not.toBe(before);
    const reads = m.fdcLog
      .recent()
      .slice(-(m.fdcLog.count - log))
      .map((e) => describeFdcEntry(e).bytes)
      .filter((b) => b.startsWith('53'));
    // The catalogue, then !BOOT (sector 2), then DEMO.
    expect(reads.slice(0, 2)).toEqual(['53 00 00 22', '53 00 02 21']);
    expect(reads).toHaveLength(3);
  });

  withRoms(...ALL)('plain BREAK doesn\'t boot: the > prompt, in MODE 7', () => {
    const m = booted(demo());
    m.setBreak(true);
    run(m, 2);
    m.setBreak(false);
    run(m, 150);
    expect(m.videoUla.teletext).toBe(true);
    expect(screen(m).filter((r) => r !== '').at(-1)).toBe('>');
  });
});

describe('SAVE: the DFS writes through the 8271, one NMI a byte', () => {
  const PROGRAM = '10 PRINT "SAVED AND LOADED"\n20 GOTO 30\n30 END\n';

  function saveProgram(m: BbcModelB): void {
    typeText(m, `${PROGRAM.replaceAll('\n', '\r')}SAVE "PROG"\r`);
    run(m, 100);
  }

  withRoms(...ALL)('SAVE "PROG" writes a catalogue entry FF1900 FF8023 and the program\'s bytes, exactly as our tokeniser makes them', () => {
    const disc = blank();
    const m = booted(disc);
    saveProgram(m);
    const cat = readCatalogue(disc, 0);
    expect(cat.cycle).toBe(1);
    expect(cat.files).toHaveLength(1);
    const [file] = cat.files;
    expect(file).toMatchObject({ directory: '$', name: 'PROG', load: BASIC_LOAD_ADDRESS & 0x3_ffff, exec: BASIC_EXEC_ADDRESS & 0x3_ffff, startSector: 2 });
    expect(Array.from(readFile(disc, 0, file))).toEqual(Array.from(tokeniseProgram(PROGRAM)));
  });

  withRoms(...ALL)('the 8271 log: read the catalogue, verify, write the catalogue, then write the data (all &00)', () => {
    const m = booted(blank());
    const from = m.fdcLog.count;
    saveProgram(m);
    const commands = m.fdcLog
      .recent()
      .slice(-(m.fdcLog.count - from))
      .map((e) => describeFdcEntry(e).bytes)
      .filter((b) => !b.startsWith('6C') && !b.startsWith('3A'));
    expect(commands).toEqual(['69 00', '53 00 00 22', '69 00', '5F 00 08 22', '4B 00 00 22', '4B 00 02 21']);
    expect(m.fdc.lateBytes).toBe(0);
  });

  withRoms(...ALL)('NEW wipes memory, and CHAIN "PROG" brings it back from the disc', () => {
    const m = booted(blank());
    saveProgram(m);
    typeText(m, 'NEW\rCHAIN "PROG"\r');
    run(m, 100);
    expect(after(m, 'CHAIN "PROG"').slice(0, 2)).toEqual(['SAVED AND LOADED', '>']);
  });

  withRoms(...ALL)('with the write protect tab on, DFS says "Disk read only" and the disc doesn\'t change', () => {
    const disc = blank();
    const m = booted(disc, true);
    saveProgram(m);
    // BASIC starts an error on a new line: a blank row, then the message.
    expect(after(m, 'SAVE "PROG"').slice(0, 3)).toEqual(['', 'Disk read only', '>']);
    expect(disc.changes).toBe(0);
  });
});

describe('the 8271 writes from an NMI handler: no ROMs, our own program', () => {
  /** Assembles source and pokes its bytes where they belong. */
  function put(m: BbcModelB, source: string): void {
    const assembly = assemble(source);
    if (!assembly.ok) throw new Error(assembly.errors.map(formatError).join('; '));
    for (const line of assembly.lines) {
      line.bytes.forEach((b, i) => {
        m.poke(line.address + i, b);
      });
    }
  }

  // Our OS at &C000: fill &3000-&30FF with 255-i, Write Data (&4B) to track 0 sector 4, wait, keep the result at &70.
  const MOS = `
        *= &C000
reset:  LDX #&FF
        TXS
        LDX #0
fill:   TXA
        EOR #&FF
        STA &3000,X
        INX
        BNE fill
        LDA #&00          ; the NMI handler's pointer: &3000
        STA &80
        LDA #&30
        STA &81
        LDA #&4B          ; Write Data, drive 0
        STA &FE80
        LDA #0            ;   track 0
        STA &FE81
        LDA #4            ;   sector 4
        STA &FE81
        LDA #&21          ;   one sector of 256 bytes
        STA &FE81
wait:   BIT &FE80
        BMI wait
        LDA &FE81
        STA &70
done:   JMP done
`;

  // At &0D00: each request, give the next byte from (&80) and step the pointer on.
  const NMI_HANDLER = `
        *= &0D00
nmi:    PHA
        TYA
        PHA
        LDA &FE80
        AND #&04          ; a byte wanted?
        BEQ out
        LDY #0
        LDA (&80),Y
        STA &FE84         ; give it (INT drops)
        INC &80
        BNE out
        INC &81
out:    PLA
        TAY
        PLA
        RTI
`;

  it('writes 256 bytes from &3000 to track 0 sector 4, one NMI each, and gets &00', () => {
    const m = new BbcModelB();
    const image = new Uint8Array(0x4000);
    image[0x3ffa] = 0x00; // NMI → &0D00
    image[0x3ffb] = 0x0d;
    image[0x3ffc] = 0x00; // RESET → &C000
    image[0x3ffd] = 0xc0;
    m.map.loadMos(image);
    put(m, MOS);
    put(m, NMI_HANDLER);
    const disc = DiscImage.fromBytes(new Uint8Array(40 * TRACK_SIZE), 'ssd', 'blank.ssd');
    m.insertDisc(0, disc);
    m.powerOn();
    run(m, 20);
    expect(m.peek(0x70)).toBe(0x00);
    expect(Array.from(disc.readSector(0, 0, 4))).toEqual(Array.from({ length: SECTOR_SIZE }, (_, i) => 255 - i));
    expect(m.fdc.bytesTransferred).toBe(256);
    expect(m.fdc.lateBytes).toBe(0);
  });
});
