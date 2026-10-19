// Stage 50: the 8271's INT on /NMI, and a disc that DFS can read.

import { assemble, formatError } from '../asm/assembler';
import { readCatalogue, openDfsDisc } from '../disc/dfs-disc';
import { catLines } from '../disc/dfs-text';
import { DiscImage, SECTOR_SIZE } from '../disc/disc-image';
import { buildTestDisc } from '../disc/test-disc';
import { describeFdcEntry } from '../devices/fdc-log';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { mode7StartAddress, mode7Text } from '../video/mode7-text';
import { BbcModelB } from './bbc-model-b';
import { typeText } from './type-text';

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

/**
 * Our own little OS: at &C000, select drive 0 and read track 0 sector 2 to
 * &3000 with Read Data &53, wait for not busy, and keep the result at &70.
 * `prelude` goes first (SEI, to show NMIs don't care).
 */
function mosReadingSector(prelude = ''): string {
  return `
        *= &C000
reset:  LDX #&FF
        TXS
        ${prelude}
        LDA #&00          ; the NMI handler's pointer: &3000
        STA &80
        LDA #&30
        STA &81
        LDA #&7A          ; Write Special Register (drive 0 bits; any will do)
        STA &FE80
        LDA #&23          ;   the output port...
        STA &FE81
        LDA #&48          ;   ...SELECT 0 + LOAD HEAD
        STA &FE81
        LDA #&53          ; Read Data, drive 0
        STA &FE80
        LDA #0            ;   track 0
        STA &FE81
        LDA #2            ;   sector 2
        STA &FE81
        LDA #&21          ;   one sector of 256 bytes
        STA &FE81
wait:   BIT &FE80         ; busy? (the NMIs do the work meanwhile)
        BMI wait
        LDA &FE81         ; the result
        STA &70
done:   JMP done
`;
}

/** An NMI handler at &0D00, where the MOS's NMI vector points: a data byte goes to (&80), then &80 steps on. */
const NMI_HANDLER = `
        *= &0D00
nmi:    PHA
        TYA
        PHA
        LDA &FE80
        AND #&04          ; a data byte?
        BEQ out           ; no: the end. Leave the result for the foreground
        LDA &FE84         ; take it (INT drops)
        LDY #0
        STA (&80),Y
        INC &80
        BNE out
        INC &81
out:    PLA
        TAY
        PLA
        RTI
`;

function machineWithDisc(mos: string, handler = NMI_HANDLER): { m: BbcModelB; disc: DiscImage } {
  const m = new BbcModelB();
  const image = new Uint8Array(0x4000);
  // Vectors: NMI → &0D00 (in RAM, as the real MOS has it), RESET → &C000.
  image[0x3ffa] = 0x00;
  image[0x3ffb] = 0x0d;
  image[0x3ffc] = 0x00;
  image[0x3ffd] = 0xc0;
  m.map.loadMos(image);
  put(m, mos);
  put(m, handler);
  const disc = DiscImage.fromBytes(buildTestDisc(), 'ssd', 'test.ssd');
  m.insertDisc(0, disc);
  m.powerOn();
  return { m, disc };
}

describe('the 8271\'s INT is the 6502\'s /NMI: each disc byte is one NMI', () => {
  it('a program of our own reads track 0 sector 2 into &3000, one NMI a byte, and gets result &00', () => {
    const { m, disc } = machineWithDisc(mosReadingSector());
    for (let i = 0; i < 20; i++) m.runFrame(); // 0.4 s: more than a revolution
    expect(m.peek(0x70)).toBe(0x00);
    const want = disc.readSector(0, 0, 2);
    const got = Array.from({ length: SECTOR_SIZE }, (_, i) => m.peek(0x3000 + i));
    expect(got).toEqual(Array.from(want));
    expect(m.fdc.bytesTransferred).toBe(256);
    expect(m.fdc.lateBytes).toBe(0);
  });

  it('SEI doesn\'t stop them: NMIs can\'t be masked, so the read works with interrupts off', () => {
    const { m } = machineWithDisc(mosReadingSector('SEI'));
    for (let i = 0; i < 20; i++) m.runFrame();
    expect(m.registers.i).toBe(true);
    expect(m.peek(0x70)).toBe(0x00);
    expect(m.fdc.bytesTransferred).toBe(256);
  });

  it('a handler that never reads &FE84 gets one NMI, then &0A late DMA', () => {
    const { m } = machineWithDisc(mosReadingSector(), '        *= &0D00\nnmi:    RTI\n');
    for (let i = 0; i < 20; i++) m.runFrame();
    expect(m.peek(0x70)).toBe(0x0a);
    expect(m.fdc.lateBytes).toBe(1);
  });

  it('INT high sets the CPU\'s NMI latch at the end of the instruction that ticked it', () => {
    const { m } = machineWithDisc(mosReadingSector());
    let steps = 0;
    while (!m.fdc.interruptRequest && steps < 1_000_000) {
      m.step();
      steps++;
    }
    expect(m.fdc.interruptRequest).toBe(true);
    expect(m.pendingInterrupt).toBe('nmi');
    m.step(); // the NMI sequence
    expect(m.registers.pc).toBe(0x0d00);
  });
});

describe('DFS 0.98 reads a disc', () => {
  const ALL = ['roms/os12.rom', 'roms/basic2.rom', 'roms/dfs.rom'] as const;

  function screen(m: BbcModelB): string[] {
    return mode7Text((a) => m.peek(a), mode7StartAddress(m.crtc.register(12), m.crtc.register(13))).map((r) => r.trimEnd());
  }

  function bootedWith(bytes: Uint8Array): BbcModelB {
    const m = new BbcModelB();
    loadStandardRoms(m.map);
    m.insertDisc(0, DiscImage.fromBytes(bytes, 'ssd', 'test.ssd'));
    m.powerOn();
    for (let i = 0; i < 100; i++) m.runFrame();
    return m;
  }

  withRoms(...ALL)('*CAT of the Stage 48 test disc prints its catalogue, exactly as dfs-text imitates it', () => {
    const bytes = buildTestDisc();
    const m = bootedWith(bytes);
    typeText(m, '*CAT\r');
    for (let i = 0; i < 50; i++) m.runFrame();
    const expected = catLines(readCatalogue(openDfsDisc(bytes, 'ssd', 'test.ssd'), 0), 0);
    expect(screen(m).slice(7, 7 + 1 + expected.length + 1)).toEqual(['>*CAT', ...expected, '>']);
    expect(screen(m).slice(8, 17)).toEqual([
      'STAGE 48 (00)',
      'Drive 0             Option 3 (EXEC)',
      'Directory :0.$      Library :0.$',
      '',
      '    !BOOT               EMPTY',
      '    HELLO    L          README',
      '',
      '  E.DATA',
      '>',
    ]);
  });

  withRoms(...ALL)('to do it, DFS seeks to track 0 and reads sectors 0 and 1 (&22: two of 256 bytes): 512 NMIs, none late', () => {
    const m = bootedWith(buildTestDisc());
    typeText(m, '*CAT\r');
    for (let i = 0; i < 50; i++) m.runFrame();
    const after = m.fdcLog.recent().slice(4).map((e) => describeFdcEntry(e).bytes);
    expect(after).toEqual(['6C', '3A 23 48', '6C', '69 00', '53 00 00 22']);
    expect(m.fdc.bytesTransferred).toBe(512);
    expect(m.fdc.lateBytes).toBe(0);
  });
});
