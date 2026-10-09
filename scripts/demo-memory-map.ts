// Stage 21 demo: the BBC memory map.
//
//   npm run demo:memmap
//
// Part 1 prints the map and the SHEILA slot table. Part 2 runs the Stage 21
// example on a BbcMemoryMap (as the workbench does) and prints the I/O log and
// what each read returned. Part 3 shows the 768 MOS ROM bytes that the I/O
// pages hide, straight from roms/os12.rom (skipped if the file is missing).

import { existsSync, readFileSync } from 'node:fs';
import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { BbcMemoryMap } from '../src/memory/bbc-memory-map';
import { MEMORY_REGIONS } from '../src/memory/memory-regions';
import { SHEILA_SLOTS, describeIoAddress } from '../src/memory/sheila';
import { MEMORY_MAP_SOURCE } from '../src/playground/examples';
import { installProgram, pokeWriter } from '../src/playground/setup';
import { hex16, hex8 } from '../src/util/bits';
import { formatSize } from '../src/web/workbench/memory-map-view-model';

console.log('── Part 1: the Model B memory map ──');
for (const r of MEMORY_REGIONS) {
  console.log(`  &${hex16(r.start)}-&${hex16(r.end)}  ${formatSize(r.end - r.start + 1).padEnd(9)}  ${r.name.padEnd(12)}  ${r.detail}`);
}
console.log('\n  SHEILA, slot by slot (registers × mirrors):');
for (const s of SHEILA_SLOTS) {
  const range = `&${hex16(0xfe00 + s.start)}-&${hex16(0xfe00 + s.start + s.size - 1)}`;
  const regs = `${String(s.registers.length)} × ${String(s.size / s.registers.length)}`;
  console.log(`  ${range}  ${s.chip.padEnd(30)}  ${regs.padEnd(7)}  ${s.builtIn}`);
}

console.log('\n── Part 2: the Stage 21 example, run on the map ──');
const result = assemble(MEMORY_MAP_SOURCE);
if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
const map = new BbcMemoryMap();
installProgram(pokeWriter(map), result.lines, 0x0400);
const cpu = new Cpu6502(map);
cpu.reset();
map.clearIoHistory();
let steps = 0;
while (map.peek(cpu.regs.pc) !== 0x00 && steps < 1000) {
  cpu.step();
  steps++;
}
console.log(`  ${String(steps)} instructions, then the BRK at &${hex16(cpu.regs.pc)}. The I/O log:`);
for (const e of map.ioLog.recent()) {
  const arrow = e.write ? '←' : '→';
  console.log(`  #${String(e.index)}  ${e.write ? 'W' : 'R'}  &${hex16(e.address)} ${arrow} &${hex8(e.value)}   ${describeIoAddress(e.address).text}`);
}
console.log('\n  What came back (&80-&84):');
const notes = ['RAM kept the write', 'MOS ROM: the write was lost', 'System VIA placeholder: floating bus', 'JIM: floating bus', 'empty sideways socket: floating bus'];
notes.forEach((note, i) => {
  console.log(`  &${hex16(0x80 + i)} = &${hex8(map.peek(0x80 + i))}   ${note}`);
});

console.log('\n── Part 3: the MOS bytes hidden under &FC00-&FEFF ──');
const rom = 'roms/os12.rom';
if (!existsSync(rom)) {
  console.log(`  skipped: ${rom} is missing (it's Acorn copyright, so you supply it).`);
} else {
  const bytes = readFileSync(rom);
  const hidden = bytes.subarray(0xfc00 - 0xc000, 0xff00 - 0xc000);
  const text = String.fromCharCode(...hidden.filter((b) => b >= 0x20 && b < 0x7f));
  console.log(`  ${rom} offset &3C00 = &FC00. The CPU can never read these ${String(hidden.length)} bytes, because I/O wins the decode:`);
  for (let i = 0; i < Math.min(text.length, 240); i += 80) console.log(`  ${text.slice(i, i + 80)}`);
  console.log('  ...');
}
