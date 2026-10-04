// Stage 09 demo: assemble the increment & decrement example and trace each
// step: the registers, the N Z C flags, and every bus write. INC and DEC show
// two writes each: the NMOS 6502 writes the old value back before the new one.
//
//   npm run demo:incdec
//
// Same source as the browser playground's default example
// (src/playground/examples.ts), on the same set-up (src/playground/setup.ts).

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { WriteRecorder } from '../src/memory/write-recorder';
import { INCDEC_SOURCE } from '../src/playground/examples';
import { MODE7_SCREEN, installProgram } from '../src/playground/setup';
import { hex16, hex8 } from '../src/util/bits';
import { toAscii } from '../src/util/hexdump';

const result = assemble(INCDEC_SOURCE);
if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));

const bus = new TestBus();
installProgram(bus, result.lines, 0x0400);
const recorder = new WriteRecorder(bus);
const cpu = new Cpu6502(recorder);
cpu.reset();

const flag = (on: boolean): string => (on ? '1' : '0');
const state = (): string => {
  const r = cpu.regs;
  return `A=${hex8(r.a)} X=${hex8(r.x)} Y=${hex8(r.y)} &80=${hex8(bus.read(0x80))}  N=${flag(r.n)} Z=${flag(r.z)} C=${flag(r.c)}`;
};
const screen = (): string => {
  let text = '';
  for (let i = 0; i < 5; i++) text += toAscii(bus.read(MODE7_SCREEN + i));
  return text;
};

console.log('Stage 09: increment & decrement. Each line is one cpu.step().');
console.log('');
console.log(`${'after reset'.padEnd(37)}${state()}   screen: "${screen()}"`);
console.log('');
console.log('addr  bytes     source            cyc  registers after                        wrote');
console.log('----  --------  ----------------  ---  -------------------------------------  -----');
for (const line of result.lines) {
  recorder.clear();
  const cycles = cpu.step();
  const wrote = recorder
    .recorded()
    .map((w) => `&${hex16(w.address)}←${hex8(w.value)}`)
    .join(' ');
  const bytes = line.bytes.map(hex8).join(' ').padEnd(8);
  const source = line.source.replace(/^start:\s*/, '');
  console.log(`${hex16(line.address)}  ${bytes}  ${source.padEnd(16)}  ${String(cycles).padStart(3)}  ${state()}  ${wrote}`.trimEnd());
}
console.log('');
console.log(`screen: "${screen()}". PC=&${hex16(cpu.regs.pc)}, ${String(cpu.cycles)} cycles since power-on (7 of them reset).`);
