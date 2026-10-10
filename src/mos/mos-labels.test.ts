import type { TraceEntry } from '../cpu/trace';
import { loadRomFile } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { DEFAULT_HANDLERS, MOS_LABELS, MOS_NOTES, VECTOR_NAMES, describeMosVariable, formatMosTraceLine, mosHeading } from './mos-labels';

const MOS = 'roms/os12.rom';

/** A trace entry for one instruction, registers zero unless given. */
function entry(pc: number, bytes: readonly number[], regs: Partial<Pick<TraceEntry, 'x' | 'y'>> = {}): TraceEntry {
  return { kind: 'instruction', cycles: 0, pc, bytes, a: 0, x: regs.x ?? 0, y: regs.y ?? 0, s: 0xff, p: 0x24 };
}

describe('MOS labels and notes', () => {
  test('the OS call addresses are named as the Advanced User Guide names them', () => {
    expect(MOS_LABELS.get(0xffee)).toBe('OSWRCH');
    expect(MOS_LABELS.get(0xfff4)).toBe('OSBYTE');
    expect(MOS_LABELS.get(0xffe3)).toBe('OSASCI');
    expect(MOS_LABELS.get(0xffe0)).toBe('OSRDCH');
  });

  test('the page 2 vectors are named, two bytes apart from USERV at &0200 to IND3V at &0234', () => {
    expect(VECTOR_NAMES).toHaveLength(27);
    expect(MOS_LABELS.get(0x0200)).toBe('USERV');
    expect(MOS_LABELS.get(0x020e)).toBe('WRCHV');
    expect(MOS_LABELS.get(0x0228)).toBe('KEYV');
    expect(MOS_LABELS.get(0x0234)).toBe('IND3V');
  });

  test('an indirect JMP through a vector shows the vector by name', () => {
    expect(formatMosTraceLine(entry(0xffee, [0x6c, 0x0e, 0x02]))).toContain('JMP (WRCHV)');
  });

  test('a call to a routine we have named shows the name, and its entry gets a heading', () => {
    expect(formatMosTraceLine(entry(0xda12, [0x20, 0x2a, 0xf0]))).toContain('JSR keyTest');
    expect(mosHeading(0xf02a)).toBe('keyTest:');
    expect(mosHeading(0xf02c)).toBeUndefined();
  });

  test('an I/O access with no note of its own is described by the register it reaches', () => {
    // STX &FE4F somewhere the notes don't cover.
    expect(formatMosTraceLine(entry(0x0400, [0x8e, 0x4f, 0xfe]))).toMatch(/; System VIA reg 15 \(ORA\/IRA, no handshake\)$/);
  });

  test('an indexed I/O access is described at its effective address: STA &FE4D,X with X = 1 reaches the IER', () => {
    expect(formatMosTraceLine(entry(0x0400, [0x9d, 0x4d, 0xfe], { x: 1 }))).toMatch(/; System VIA reg 14 \(IER\)$/);
  });

  test('a documented workspace variable is explained in a comment, and its address stays in hex', () => {
    const line = formatMosTraceLine(entry(0x0400, [0xad, 0x8d, 0x02])); // LDA &028D
    expect(line).toContain('LDA &028D');
    expect(line).toMatch(/; last BREAK type/);
  });

  test('the ROM type table is described slot by slot', () => {
    expect(describeMosVariable(0x02a1 + 15)).toBe('ROM type table: slot 15');
  });

  test('a note for the instruction wins over the register description', () => {
    const note = MOS_NOTES.get(0xd9d7);
    expect(note).toBeDefined();
    expect(formatMosTraceLine(entry(0xd9d7, [0xad, 0x4e, 0xfe]))).toContain(`; ${note ?? ''}`);
  });

  test('an instruction with nothing known about it has no comment', () => {
    expect(formatMosTraceLine(entry(0x0400, [0xea]))).not.toContain(';');
  });

  withRoms(MOS)('the default handler names match the vector table os12.rom copies from &D940 into page 2', () => {
    const image = loadRomFile(MOS);
    const romByte = (address: number): number => image[address - 0xc000] ?? 0;
    for (const handler of DEFAULT_HANDLERS) {
      const source = 0xd940 + (handler.vector - 0x0200);
      const target = romByte(source) | (romByte(source + 1) << 8);
      // The vector's name rides along so a failure says which one.
      expect([MOS_LABELS.get(handler.vector), target]).toEqual([MOS_LABELS.get(handler.vector), handler.address]);
    }
  });
});
