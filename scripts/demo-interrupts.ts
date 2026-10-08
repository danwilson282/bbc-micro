// Stage 17 demo: the interrupts example on a timeline. The script presses
// the IRQ and NMI "buttons" at fixed cycles, and prints every way into and
// out of a handler, with the three bytes pushed and what the B bit says.
// Then it removes the handler's STA doorbell and shows what an IRQ that's
// never answered does to the main program.
//
//   npm run demo:interrupts
//
// The same assembled program, installProgram() and playground target
// (CPU → WriteRecorder → Doorbell → TestBus) that the workbench uses.

import { assemble, formatError } from '../src/asm/assembler';
import { STACK_PAGE } from '../src/cpu/cpu6502';
import { P_B } from '../src/cpu/flags';
import { TestBus } from '../src/memory/test-bus';
import { DOORBELL } from '../src/playground/doorbell';
import { INTERRUPTS_SOURCE } from '../src/playground/examples';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8 } from '../src/util/bits';
import { playgroundTarget } from '../src/web/workbench/debug-target';
import { formatBinary } from '../src/web/workbench/registers-view-model';

const BRK = 0x00;
const RTI = 0x40;
const IRQS = 0x80;
const NMIS = 0x81;
const BRKS = 0x82;
const MAIN = 0x84;

/** Button presses: at this many cycles after reset, press these. */
const PRESSES: readonly { at: number; irq: boolean; nmi: boolean }[] = [
  { at: 300, irq: true, nmi: false },
  { at: 600, irq: false, nmi: true },
  { at: 900, irq: true, nmi: true },
];
const RUN_FOR = 1300;

function setUp(source: string): ReturnType<typeof playgroundTarget> {
  const result = assemble(source);
  if (!result.ok) {
    console.error(result.errors.map(formatError).join('\n'));
    process.exit(1);
  }
  const bus = new TestBus();
  installProgram(bus, result.lines, result.entry ?? 0x0400);
  const target = playgroundTarget(bus);
  target.reset();
  return target;
}

const t = setUp(INTERRUPTS_SOURCE);
const counters = (): string =>
  `IRQs ${String(t.peek(IRQS))}  NMIs ${String(t.peek(NMIS))}  BRKs ${String(t.peek(BRKS))}  main loop ${String(t.peek(MAIN) | (t.peek(MAIN + 1) << 8))}`;

/** The 3 bytes just pushed (PCH PCL P), and the B bit's verdict. */
function frame(): string {
  const s = t.registers.s;
  const at = (n: number): number => t.peek(STACK_PAGE | ((s + n) & 0xff));
  const p = at(1);
  const b = (p & P_B) !== 0;
  return `pushed ${hex8(at(3))} ${hex8(at(2))} ${hex8(p)}   P = ${formatBinary(p)}, B = ${b ? '1: BRK' : '0: hardware'}`;
}

const line = (cycle: number, text: string): void => {
  console.log(`${String(cycle).padStart(6)}  ${text}`);
};

console.log('Stage 17: interrupts. The example, with the IRQ and NMI buttons pressed at fixed cycles.');
console.log('Cycles count from power-on (the 7-cycle reset included). Handlers save A and X, so S');
console.log('drops 3 for the interrupt and 2 more inside; it is back to &FF after every RTI.');
console.log('');
line(t.cycles, `reset → &${hex16(t.registers.pc)}   I = 1, so no IRQ until the CLI`);

let next = 0;
while (t.cycles < RUN_FOR) {
  const press = PRESSES.at(next);
  if (press !== undefined && t.cycles >= press.at) {
    next++;
    const what = [press.irq ? 'IRQ (the doorbell rings, IRQ held)' : '', press.nmi ? 'NMI (one pulse: one edge)' : ''].filter((s) => s !== '').join(' and ');
    line(t.cycles, `── press ${what}`);
    if (press.irq) t.ringIrq();
    if (press.nmi) t.pulseNmi();
  }
  const pc = t.registers.pc;
  const due = t.pendingInterrupt;
  const opcode = t.peek(pc);
  t.writes.clear();
  t.step();
  if (due !== undefined) {
    line(t.cycles, `${due.toUpperCase()} taken before &${hex16(pc)} → &${hex16(t.registers.pc)}   ${frame()}`);
  } else if (opcode === BRK) {
    line(t.cycles, `BRK at &${hex16(pc)} → &${hex16(t.registers.pc)}            ${frame()}`);
  } else if (opcode === RTI) {
    line(t.cycles, `  RTI → &${hex16(t.registers.pc)}   I = ${t.registers.i ? '1' : '0'}   ${counters()}`);
  } else if (t.writes.recorded().some((w) => w.address === DOORBELL)) {
    line(t.cycles, `  STA &${hex16(DOORBELL)}: the doorbell is answered, and lets go of IRQ`);
  }
}
console.log('');
console.log(`After ${String(t.cycles)} cycles: ${counters()}`);
console.log('The NMI at the third press went first (NMI wins), and the IRQ, still held, came straight after its RTI.');

console.log('');
console.log('── Now without the handler\'s STA doorbell: one IRQ press, never answered.');
const bad = setUp(INTERRUPTS_SOURCE.replace(/^ *STA doorbell.*$/m, ''));
while (bad.cycles < 300) bad.step();
const mainBefore = bad.peek(MAIN) | (bad.peek(MAIN + 1) << 8);
bad.ringIrq();
const start = bad.cycles;
while (bad.cycles < start + 20_000) bad.step();
console.log(`  20,000 cycles later (10 ms): IRQs ${String(bad.peek(IRQS))} (the byte wraps at 256), main loop ${String(bad.peek(MAIN) | (bad.peek(MAIN + 1) << 8))}, the same as before the press (${String(mainBefore)}).`);
console.log('  IRQ is a level: RTI clears I, the line is still held, so the CPU goes straight back in.');
