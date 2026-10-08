// Stage 15 demo: the stack example, one instruction per line, with S and the
// top of page 1 after each step.
//
//   npm run demo:stack
//
// The same assembled program and installProgram() the workbench uses.

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502, STACK_PAGE } from '../src/cpu/cpu6502';
import { packP } from '../src/cpu/flags';
import { TestBus } from '../src/memory/test-bus';
import { STACK_SOURCE } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8 } from '../src/util/bits';

const result = assemble(STACK_SOURCE);
if (!result.ok) {
  console.error(result.errors.map(formatError).join('\n'));
  process.exit(1);
}
const bus = new TestBus();
installProgram(bus, result.lines, result.entry ?? 0x0400);
const cpu = new Cpu6502(bus);
cpu.reset();

const sourceAt = new Map(result.lines.map((line) => [line.address, line.source]));

/** The bytes in use, &01FF first, with the free slot S points at shown as "__". */
function stack(): string {
  const used: string[] = [];
  for (let offset = 0xff; offset > cpu.regs.s; offset--) used.push(hex8(bus.read(STACK_PAGE | offset)));
  // S = &00 means 255 bytes "in use": show the ends, like the Stack panel does.
  const shown = used.length > 8 ? [...used.slice(0, 3), `…${String(used.length - 6)} more…`, ...used.slice(-3)] : used;
  return [...shown, '__'].join(' ');
}

console.log('Stage 15: jumps & the stack. The stack example, step by step.');
console.log('Page 1 is listed from &01FF down; "__" is the free slot S points at.');
console.log('');
console.log('  PC     instruction        A    P     S    cyc   stack (&01FF down)');
console.log('  -----  -----------------  ---  ---  ---  ---   ------------------');
let total = 0;
for (;;) {
  const pc = cpu.regs.pc;
  if (bus.read(pc) === 0x00) {
    console.log(`  &${hex16(pc)}  ${(sourceAt.get(pc) ?? 'BRK').padEnd(17)}  stop: Run stops before a BRK`);
    break;
  }
  const cycles = cpu.step();
  total += cycles;
  const r = cpu.regs;
  console.log(
    `  &${hex16(pc)}  ${(sourceAt.get(pc) ?? '?').padEnd(17)}  ${hex8(r.a)}   ${hex8(packP(r, false))}   ${hex8(r.s)}   ${String(cycles)}    ${stack()}`,
  );
}
console.log('');
console.log(`${String(total)} cycles. P is shown as an IRQ would push it (bit 5 = 1, B = 0).`);
console.log('');
console.log(`JMP (&10FF) read &${hex8(bus.read(0x10ff))} from &10FF and &${hex8(bus.read(0x1000))} from &1000, so it went to &0480.`);
console.log(`A 65C02 would have read &${hex8(bus.read(0x1100))} from &1100 and gone to &0580.`);
console.log(`After the wrap: &0100 = &${hex8(bus.read(0x0100))}, &01FF = &${hex8(bus.read(0x01ff))} (it held &11).`);
