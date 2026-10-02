// Stage 06 demo: run the hand-assembled loads program and trace each step.
//
//   npm run demo:loads
//
// Same bytes as the browser playground (src/playground/loads-program.ts), on
// the same set-up: "HELLO, BBC MICRO" at &7C00 and a pointer to it at &70.

import { Cpu6502, RESET_VECTOR } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { loadListing } from '../src/playground/listing';
import { LOADS_PROGRAM, LOADS_PROGRAM_START } from '../src/playground/loads-program';
import { loadPlaygroundData } from '../src/playground/setup';
import { hex16, hex8, hi, lo } from '../src/util/bits';

const bus = new TestBus();
loadPlaygroundData(bus);
loadListing(bus, LOADS_PROGRAM);
bus.load(RESET_VECTOR, [lo(LOADS_PROGRAM_START), hi(LOADS_PROGRAM_START)]);

const cpu = new Cpu6502(bus);
cpu.reset();

const flag = (on: boolean): string => (on ? '1' : '0');
const state = (): string => {
  const r = cpu.regs;
  return `A=${hex8(r.a)} X=${hex8(r.x)} Y=${hex8(r.y)}  N=${flag(r.n)} Z=${flag(r.z)}`;
};

console.log('Stage 06: loads. Each line is one cpu.step().');
console.log('');
console.log(`${'after reset'.padEnd(36)}${state()}  C=${flag(cpu.regs.c)} I=${flag(cpu.regs.i)}`);
console.log('');
console.log('addr  bytes     source         cyc  registers after          watch for');
console.log('----  --------  -------------  ---  -----------------------  ---------');
for (const line of LOADS_PROGRAM) {
  const bytes = line.bytes.map(hex8).join(' ').padEnd(8);
  const cycles = cpu.step();
  console.log(`${hex16(line.address)}  ${bytes}  ${line.source.padEnd(13)}  ${String(cycles).padStart(3)}  ${state()}  ${line.comment}`);
}
console.log('');
console.log(`PC=&${hex16(cpu.regs.pc)}, ${String(cpu.cycles)} cycles since power-on (7 of them reset).`);
console.log(`C=${flag(cpu.regs.c)} V=${flag(cpu.regs.v)} D=${flag(cpu.regs.d)} I=${flag(cpu.regs.i)}: loads never touch these.`);
