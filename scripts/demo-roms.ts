// Stage 22 demo: ROMs and sideways paging.
//
//   npm run demo:roms
//
// Part 1 loads whatever is in roms/ (and a made-up ROM, so there's always
// something to page in). Part 2 pages each of the 16 slots in through
// ROMSEL and prints its header. Part 3 does the same from 6502 code, the way
// the MOS will at reset. Part 4 looks at the MOS at &C000 and at BASIC's two
// entry points.

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { disassembleRange } from '../src/cpu/disassembler';
import { BbcMemoryMap, SIDEWAYS_SLOTS } from '../src/memory/bbc-memory-map';
import { loadStandardRoms, romPath } from '../src/memory/rom-files';
import { buildRomImage, describeRomType, parseRomHeader } from '../src/memory/rom-header';
import { hex16, hex8 } from '../src/util/bits';

/** Control characters (BASIC's copyright ends in LF CR) shown as <&0A>. */
function printable(s: string): string {
  let out = '';
  for (const c of s) {
    const code = c.charCodeAt(0);
    out += code >= 0x20 && code < 0x7f ? c : `<&${hex8(code)}>`;
  }
  return out;
}

const map = new BbcMemoryMap();

console.log('── Part 1: loading the ROMs ──');
const report = loadStandardRoms(map);
for (const rom of report.loaded) console.log(`  loaded   ${romPath(rom).padEnd(16)} ${rom.name.padEnd(10)} → ${rom.slot === 'mos' ? '&C000-&FFFF' : `sideways slot ${String(rom.slot)}`}`);
for (const rom of report.missing) console.log(`  missing  ${romPath(rom).padEnd(16)} ${rom.name.padEnd(10)}   (Acorn copyright, so you supply it; the slot stays empty)`);
const DEMO_SLOT = 0;
map.loadSidewaysRom(DEMO_SLOT, buildRomImage({ type: 0x82, binaryVersion: 0x01, title: 'DEMO', version: '0.01', copyright: '(C)2026 Stage 22' }));
console.log(`  built    a made-up ROM, "DEMO", by buildRomImage → sideways slot ${String(DEMO_SLOT)}`);

console.log('\n── Part 2: each slot, paged in through ROMSEL (&FE30), header parsed ──');
console.log('  slot  title       version  bin  type                                          copyright');
for (let slot = SIDEWAYS_SLOTS - 1; slot >= 0; slot--) {
  map.write(0xfe30, slot); // a CPU write: the latch picks the slot
  const result = parseRomHeader((a) => map.peek(a));
  const n = String(slot).padStart(4);
  if (!result.ok) {
    console.log(`  ${n}  (empty: reads float, no "(C)" where the header says)`);
    continue;
  }
  const h = result.header;
  const type = `&${hex8(h.type)} ${describeRomType(h.type)}`;
  console.log(`  ${n}  ${h.title.padEnd(10)}  ${(h.versionString ?? '-').padEnd(7)}  &${hex8(h.binaryVersion)}  ${type.padEnd(44)}  ${printable(h.copyright)}`);
}

console.log('\n── Part 3: the same scan in 6502 code, as the MOS does it at reset ──');
const SCAN = `
types = &70             ; one byte per slot: its type byte, or 0 if no ROM

        *= &0400
        LDX #15
next:   STX &F4         ; the MOS's RAM copy: ROMSEL can't be read back
        STX &FE30       ; page slot X in
        LDY &8007       ; the copyright offset
        LDA &8000,Y     ; is &00 ( C ) there?
        BNE none
        LDA &8001,Y
        CMP #&28
        BNE none
        LDA &8002,Y
        CMP #&43
        BNE none
        LDA &8003,Y
        CMP #&29
        BNE none
        LDA &8006       ; yes: keep the type byte
        BNE keep
none:   LDA #0
keep:   STA types,X
        DEX
        BPL next
        BRK
`;
const assembly = assemble(SCAN);
if (!assembly.ok) throw new Error(assembly.errors.map(formatError).join('\n'));
for (const line of assembly.lines) {
  line.bytes.forEach((b, i) => {
    map.poke(line.address + i, b);
  });
}
const cpu = new Cpu6502(map);
cpu.regs.pc = assembly.entry ?? 0x0400;
map.clearIoHistory();
let instructions = 0;
let cycles = 0;
while (map.peek(cpu.regs.pc) !== 0x00 && instructions < 10_000) {
  cycles += cpu.step();
  instructions++;
}
console.log(`  ${String(instructions)} instructions, ${String(cycles)} cycles, ${String(map.ioLog.count)} writes to ROMSEL. Type bytes found at &70-&7F:`);
const row: string[] = [];
for (let slot = 0; slot < SIDEWAYS_SLOTS; slot++) row.push(`${String(slot).padStart(2)}:${map.peek(0x70 + slot) === 0 ? '--' : hex8(map.peek(0x70 + slot))}`);
console.log(`  ${row.join(' ')}`);
console.log(`  &F4 = &${hex8(map.peek(0xf4))}, the last slot paged. (The MOS keeps a table like this at &02A1.)`);
console.log('  An empty slot fails at the first test: LDY &8007 reads the floating bus, &80 (the high');
console.log('  byte of the operand just fetched), so Y = &80, and &8080 floats to &80 too, not &00.');

console.log('\n── Part 4: the MOS at &C000, and BASIC\'s entry points ──');
if (report.loaded.some((r) => r.id === 'mos')) {
  const vector = (a: number): number => map.peek(a) | (map.peek(a + 1) << 8);
  console.log(`  The CPU vectors, from the last page of os12.rom (file offset &3FFA = &FFFA):`);
  console.log(`    NMI   &FFFA → &${hex16(vector(0xfffa))}   (RAM: filing systems put NMI code there)`);
  console.log(`    RESET &FFFC → &${hex16(vector(0xfffc))}   (Stage 23 starts here)`);
  console.log(`    IRQ   &FFFE → &${hex16(vector(0xfffe))}`);
  console.log(`  The first instructions of the reset code:`);
  for (const d of disassembleRange((a) => map.peek(a), vector(0xfffc), 6)) console.log(`    &${hex16(d.address)}  ${d.text}`);
} else {
  console.log('  skipped: roms/os12.rom is missing.');
}
const basic = report.loaded.find((r) => r.id === 'basic');
if (basic !== undefined && basic.slot !== 'mos') {
  map.write(0xfe30, basic.slot);
  console.log(`\n  BASIC paged in (slot ${String(basic.slot)}). Its language entry at &8000 is code, not a JMP:`);
  for (const d of disassembleRange((a) => map.peek(a), 0x8000, 4)) console.log(`    &${hex16(d.address)}  ${d.text}`);
  console.log('  The MOS enters a language with A = 1, so BASIC checks for that first, and returns if not.');
  console.log('  That code runs straight through &8003-&8005, the service entry\'s bytes: BASIC has no');
  console.log('  service entry (type &60, bit 7 clear), so the MOS never calls &8003, and the space is free.');
  console.log(`  (The type byte &60 at &8006 happens to be an RTS opcode too, but nothing runs it.)`);
} else {
  console.log('\n  BASIC entry points: skipped, roms/basic2.rom is missing.');
}
