import { assemble } from '../asm/assembler';
import { BbcMemoryMap } from '../memory/bbc-memory-map';
import type { IoDevice } from '../memory/io-device';
import { ROM_SIZE } from '../memory/memory-regions';
import { loadStandardRoms } from '../memory/rom-files';
import { withRoms } from '../memory/with-roms';
import { MOS_LABELS } from './mos-labels';
import { MosRunner } from './mos-runner';

const MOS = 'roms/os12.rom';
const BASIC = 'roms/basic2.rom';

/** A made-up 16K MOS: source assembled into &C000-&FFFF, reset vector at its first byte. */
function fakeMos(source: string): Uint8Array {
  const assembly = assemble(source);
  if (!assembly.ok) throw new Error(assembly.errors.map((e) => e.message).join('\n'));
  const image = new Uint8Array(ROM_SIZE).fill(0xff);
  for (const line of assembly.lines) {
    line.bytes.forEach((b, i) => {
      image[line.address + i - 0xc000] = b;
    });
  }
  const entry = assembly.entry ?? 0xc000;
  image[0xfffc - 0xc000] = entry & 0xff;
  image[0xfffd - 0xc000] = entry >> 8;
  return image;
}

/** A stand-in "System VIA" for the what-if experiment: every register reads &00, writes vanish. */
const READS_ZERO: IoDevice = {
  read: () => 0,
  write: () => undefined,
  peek: () => 0,
};

/** A map with the standard ROMs from roms/ (the caller's withRoms says which must be there). */
function realMap(devices: ConstructorParameters<typeof BbcMemoryMap>[0] = {}): BbcMemoryMap {
  const map = new BbcMemoryMap(devices);
  loadStandardRoms(map);
  return map;
}

/** The text in mode 7 screen memory (&7C00, 25 rows of 40), one string per non-blank row. */
function mode7Rows(map: BbcMemoryMap): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 25; row++) {
    let text = '';
    for (let col = 0; col < 40; col++) {
      const b = map.peek(0x7c00 + row * 40 + col) & 0x7f;
      text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ';
    }
    if (text.trim() !== '') rows.push(text.trimEnd());
  }
  return rows;
}

describe('MosRunner, on a made-up MOS', () => {
  test('reset starts at whatever the MOS image has at the reset vector &FFFC', () => {
    const map = new BbcMemoryMap();
    map.loadMos(fakeMos(`
        *= &C123
        NOP
`));
    const runner = new MosRunner(map);
    runner.reset();
    expect(runner.cpu.regs.pc).toBe(0xc123);
  });

  test('firmware waiting for a key that floats "down" stalls, and the loop is reported', () => {
    const map = new BbcMemoryMap();
    map.loadMos(fakeMos(`
        *= &C000
        LDX #&FF
        TXS
wait:   JSR test        ; &C003
        BMI wait        ; &C006
        BRK
        *= &F000
test:   LDX &FE4F       ; &F000: System VIA port A, empty slot: floats to &FE
        RTS             ; &F003
`));
    const runner = new MosRunner(map, { stallCycles: 10_000 });
    runner.reset();
    const result = runner.runUntilStall(1_000_000);
    expect(result.kind).toBe('stall');
    expect(result.loop).toEqual([0xc003, 0xc006, 0xf000, 0xf003]);
    expect(map.ioLog.recent(1)[0]).toMatchObject({ address: 0xfe4f, value: 0xfe, write: false });
  });

  test('a run that hits maxCycles first says so', () => {
    const map = new BbcMemoryMap();
    map.loadMos(fakeMos(`
        *= &C000
loop:   JMP loop
`));
    const runner = new MosRunner(map, { stallCycles: 10_000 });
    runner.reset();
    expect(runner.runUntilStall(3000)).toMatchObject({ kind: 'limit', pc: 0xc000 });
  });
});

describe('MosRunner, on MOS 1.20', () => {
  withRoms(MOS)('reset starts at the MOS reset vector, &D9CD', () => {
    const runner = new MosRunner(realMap());
    runner.reset();
    expect(runner.cpu.regs.pc).toBe(0xd9cd);
  });

  withRoms(MOS)('the first 30 instructions follow the disassembly: BREAK path (IER floats to &FE), then the IC32 latch set-up', () => {
    const runner = new MosRunner(realMap());
    runner.reset();
    const pcs: number[] = [];
    for (let i = 0; i < 30; i++) {
      pcs.push(runner.cpu.regs.pc);
      runner.step();
    }
    expect(pcs).toEqual([
      0xd9cd, 0xd9cf, 0xd9d2, 0xd9d3, 0xd9d4, 0xd9d6, // RTI at &0D00, SEI, CLD, S = &FF
      0xd9d7, 0xd9da, 0xd9db, 0xd9dc,                 // IER reads &FE, ASL gives &FC: not zero, so not power-on
      0xd9de, 0xd9e1, 0xd9e2, 0xd9e4,                 // *FX200 (&0258) = 0: don't clear memory on BREAK
      0xda03, 0xda05,                                 // DDRB = &0F
      0xda08, 0xda09, 0xda0c, 0xda0e,                 // port B = &0E: IC32 bit 6 := 1 ...
      0xda08, 0xda09, 0xda0c, 0xda0e,                 // ... &0D: bit 5 := 1
      0xda08, 0xda09, 0xda0c, 0xda0e,                 // ... &0C: bit 4 := 1
      0xda08, 0xda09,                                 // ... &0B: bit 3 := 1
    ]);
  });

  withRoms(MOS, BASIC)('with nothing in the System VIA slot it stalls in the CTRL+SHIFT scroll halt, before printing anything', () => {
    const map = realMap();
    const runner = new MosRunner(map);
    runner.reset();
    const result = runner.runUntilStall(20_000_000);
    expect(result.kind).toBe('stall');
    // The loop goes through keyTest and the CTRL+SHIFT wait ...
    expect(result.loop).toEqual(expect.arrayContaining([0xf02a, 0xf037, 0xcae0, 0xcae3, 0xe9d9]));
    // ... called from printMessage, through OSASCI and OSWRCH.
    const chain = runner.calls.frames().map((f) => MOS_LABELS.get(f.to) ?? f.to);
    expect(chain).toEqual(expect.arrayContaining(['printMessage', 'OSASCI', 'OSWRCH', 'vdu', 'ctrlShiftWait']));
    // What the floating bus made it believe:
    expect(map.peek(0x028d)).toBe(2); // CTRL+BREAK
    expect(map.peek(0x028e)).toBe(0x00); // RAM never measured
    expect(map.peek(0x0355)).toBe(4); // mode 0 from the links, made mode 4 for "16K"
    expect(map.peek(0x02a1 + 15)).toBe(0x60); // but the ROM scan did find BASIC
  });

  withRoms(MOS, BASIC)('if the System VIA read &00 instead, the MOS would power on, print its banner and BASIC\'s prompt, and wait in OSRDCH', () => {
    const map = realMap({ devices: { systemVia: READS_ZERO } });
    const runner = new MosRunner(map);
    runner.reset();
    const result = runner.runUntilStall(40_000_000);
    expect(result.kind).toBe('stall');
    expect(map.peek(0x028d)).toBe(1); // power-on
    expect(map.peek(0x028e)).toBe(0x80); // 32K, measured
    expect(map.peek(0x0355)).toBe(7);
    expect(mode7Rows(map)).toEqual(['BBC Computer 32K', 'BASIC', '>']);
    expect(result.loop).toEqual(expect.arrayContaining([0xdee6, 0xe466]));
  });
});

