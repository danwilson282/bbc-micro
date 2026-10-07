// Stage 16 demo: the subroutines example as a call trace. Every JSR and RTS
// gets a line, indented by call depth, with the bytes on the stack. The
// instructions in between are counted, not listed.
//
//   npm run demo:multiply
//
// The same assembled program and installProgram() the workbench uses.

import { assemble, formatError } from '../src/asm/assembler';
import { Cpu6502, STACK_PAGE } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { SUBROUTINES_SOURCE } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8, word } from '../src/util/bits';

const JSR = 0x20;
const RTS = 0x60;

const result = assemble(SUBROUTINES_SOURCE);
if (!result.ok) {
  console.error(result.errors.map(formatError).join('\n'));
  process.exit(1);
}
const bus = new TestBus();
installProgram(bus, result.lines, result.entry ?? 0x0400);
const cpu = new Cpu6502(bus);
cpu.reset();

const nameAt = new Map([...result.symbols].map(([name, address]) => [address, name]));
const sourceAt = new Map(result.lines.map((line) => [line.address, line.source.replace(/^\w+:\s*/, '')]));

/** The bytes in use, &01FF first. */
function stack(): string {
  const used: string[] = [];
  for (let offset = 0xff; offset > cpu.regs.s; offset--) used.push(hex8(bus.read(STACK_PAGE | offset)));
  return used.length === 0 ? '(empty)' : used.join(' ');
}

console.log('Stage 16: subroutines. The multiply example as a call trace.');
console.log('Stack bytes are listed from &01FF down. A return address is low byte first, so "04 09" on');
console.log('the stack is high &04 at &01FF, low &09 at &01FE: the word &0409.');
console.log('');

let depth = 0;
let between = 0;
let instructions = 0;
let total = 0;
/** Prints "… n instructions" for the ones run since the last JSR or RTS. */
function flush(): void {
  if (between > 0) console.log(`  ${'  '.repeat(depth)}… ${String(between)} instruction${between === 1 ? '' : 's'}`);
  between = 0;
}

for (;;) {
  const pc = cpu.regs.pc;
  const opcode = bus.read(pc);
  if (opcode === 0x00) break;
  const indent = '  '.repeat(depth);
  total += cpu.step();
  instructions++;
  if (opcode === JSR) {
    flush();
    const target = cpu.regs.pc;
    const pushed = word(bus.read(STACK_PAGE | ((cpu.regs.s + 1) & 0xff)), bus.read(STACK_PAGE | ((cpu.regs.s + 2) & 0xff)));
    console.log(`  ${indent}&${hex16(pc)}  JSR ${nameAt.get(target) ?? hex16(target)}`.padEnd(32) + `pushes &${hex16(pushed)}   stack: ${stack()}`);
    depth++;
  } else if (opcode === RTS) {
    flush();
    depth--;
    console.log(`  ${'  '.repeat(depth)}&${hex16(pc)}  RTS`.padEnd(32) + `→ &${hex16(cpu.regs.pc)}       stack: ${stack()}`);
    console.log(`  ${'  '.repeat(depth)}        A = &${hex8(cpu.regs.a)}, X = &${hex8(cpu.regs.x)}: the answer is &${hex16(cpu.regs.a | (cpu.regs.x << 8))} = ${String(cpu.regs.a | (cpu.regs.x << 8))}`);
  } else {
    between++;
  }
}
flush();
console.log(`  &${hex16(cpu.regs.pc)}  ${sourceAt.get(cpu.regs.pc) ?? 'BRK'}: stop (BRK is Stage 17)`);
console.log('');
console.log(`${String(instructions)} instructions, ${String(total)} cycles.`);
console.log('');
const results = [0x90, 0x92, 0x94].map((a) => word(bus.read(a), bus.read(a + 1)));
console.log(`results at &90-&95: ${[0x90, 0x91, 0x92, 0x93, 0x94, 0x95].map((a) => hex8(bus.read(a))).join(' ')}`);
console.log(`  13 x 11 = ${String(results[0] ?? 0)}   12 x 12 = ${String(results[1] ?? 0)}   200 x 150 = ${String(results[2] ?? 0)}`);
