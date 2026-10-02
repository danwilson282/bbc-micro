// Stage 07 demo: run the hand-assembled stores program and trace each step,
// with the bytes each instruction wrote.
//
//   npm run demo:stores
//
// Same bytes as the browser playground (src/playground/stores-program.ts), on
// the same set-up (src/playground/setup.ts), with a WriteRecorder between the
// CPU and the bus, just as the workbench has.

import { Cpu6502, RESET_VECTOR } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { WriteRecorder } from '../src/memory/write-recorder';
import { loadListing } from '../src/playground/listing';
import { MODE7_ROW, MODE7_SCREEN, loadPlaygroundData } from '../src/playground/setup';
import { STORES_PROGRAM, STORES_PROGRAM_START } from '../src/playground/stores-program';
import { hex16, hex8, hi, lo } from '../src/util/bits';
import { toAscii } from '../src/util/hexdump';

const bus = new TestBus();
loadPlaygroundData(bus);
loadListing(bus, STORES_PROGRAM);
bus.load(RESET_VECTOR, [lo(STORES_PROGRAM_START), hi(STORES_PROGRAM_START)]);

const recorder = new WriteRecorder(bus);
const cpu = new Cpu6502(recorder);
cpu.reset();

const flag = (on: boolean): string => (on ? '1' : '0');
const state = (): string => {
  const r = cpu.regs;
  return `A=${hex8(r.a)} X=${hex8(r.x)} Y=${hex8(r.y)} S=${hex8(r.s)}  N=${flag(r.n)} Z=${flag(r.z)}`;
};
const screenRow = (row: number): string => {
  let text = '';
  for (let i = 0; i < 16; i++) text += toAscii(bus.read(MODE7_SCREEN + row * MODE7_ROW + i));
  return text;
};

console.log('Stage 07: stores & transfers. Each line is one cpu.step().');
console.log('');
console.log(`row 0 (&7C00): "${screenRow(0)}"   row 1 (&7C28): "${screenRow(1)}"`);
console.log(`${'after reset'.padEnd(36)}${state()}`);
console.log('');
console.log('addr  bytes     source         cyc  registers after               wrote        watch for');
console.log('----  --------  -------------  ---  ----------------------------  -----------  ---------');
for (const line of STORES_PROGRAM) {
  const bytes = line.bytes.map(hex8).join(' ').padEnd(8);
  recorder.clear();
  const cycles = cpu.step();
  const wrote = recorder
    .recorded()
    .map((w) => `&${hex16(w.address)}←${hex8(w.value)}`)
    .join(' ');
  console.log(
    `${hex16(line.address)}  ${bytes}  ${line.source.padEnd(13)}  ${String(cycles).padStart(3)}  ${state()}  ${wrote.padEnd(11)}  ${line.comment}`,
  );
}
console.log('');
console.log(`row 0 (&7C00): "${screenRow(0)}"   row 1 (&7C28): "${screenRow(1)}"`);
console.log(`PC=&${hex16(cpu.regs.pc)}, ${String(cpu.cycles)} cycles since power-on (7 of them reset).`);
