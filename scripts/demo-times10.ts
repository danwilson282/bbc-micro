// Stage 13 demo: multiply by 10 using only shifts and adds (x·10 = x·8 + x·2),
// as a 16-bit routine run on the emulated 6502.
//
//   npm run demo:times10
//
// The routine is assembled by our own assembler (Stage 08) and run with
// installProgram, the same set-up as the browser playground.

import { assemble, formatError, type AssembledLine } from '../src/asm/assembler';
import { Cpu6502 } from '../src/cpu/cpu6502';
import { TestBus } from '../src/memory/test-bus';
import { installProgram } from '../src/playground/setup';
import { hex16, hex8 } from '../src/util/bits';
import { formatBinary } from '../src/web/workbench/registers-view-model';

const NUM = 0x80;

const TIMES10_SOURCE = `
num     = &80             ; the 16-bit number, low byte first: &80/&81
times2  = &82             ; num * 2, kept for the add: &82/&83

        *= &0400
        ASL num           ; num * 2: ASL starts the chain with a 0 at the bottom
        ROL num+1         ;   ... ROL carries bit 7 of the low byte into the high byte
        LDA num
        STA times2
        LDA num+1
        STA times2+1      ; times2 = num * 2
        ASL num
        ROL num+1         ; num * 4
        ASL num
        ROL num+1         ; num * 8. C=0 if it still fits in 16 bits: no CLC needed
        LDA num
        ADC times2
        STA num
        LDA num+1
        ADC times2+1      ; num * 8 + num * 2, with the carry from the low byte
        STA num+1         ; num = num * 10. C=1 if the answer didn't fit
`;

const result = assemble(TIMES10_SOURCE);
if (!result.ok) throw new Error(result.errors.map(formatError).join('\n'));
const lines: readonly AssembledLine[] = result.lines;

/** Fresh machine, num = x, the routine at &0400. */
function setUp(x: number): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  installProgram(bus, lines, 0x0400);
  bus.write(NUM, x & 0xff);
  bus.write(NUM + 1, (x >> 8) & 0xff);
  const cpu = new Cpu6502(bus);
  cpu.reset();
  return { cpu, bus };
}

function word(bus: TestBus, address: number): number {
  return bus.read(address) | (bus.read(address + 1) << 8);
}

/** e.g. &03E8 → "%0000 0011  1110 1000": high byte, two spaces, low byte. */
const binary16 = (value: number): string => `${formatBinary(value >> 8)}  ${formatBinary(value & 0xff).slice(1)}`;

console.log('Stage 13: multiply by 10 with shifts. The 6502 has no multiply instruction,');
console.log('but 10 = %1010 = 8 + 2, so  x * 10 = x * 8 + x * 2:  three shifts and one add.');
console.log('');
console.log('The routine (16 bits: ASL the low byte, ROL the high byte):');
console.log('');
for (const line of lines) {
  const bytes = line.bytes.map(hex8).join(' ');
  const comment = line.comment === '' ? '' : ` ; ${line.comment}`;
  console.log(`  &${hex16(line.address)}  ${bytes.padEnd(9)} ${line.source.padEnd(14)}${comment}`.trimEnd());
}

console.log('');
console.log('Each row is the routine run on the emulated 6502:');
console.log('');
console.log('     x    x * 10    result     C   cycles');
console.log('------  --------  --------    -   ------');
for (const x of [0, 1, 7, 23, 99, 255, 1000, 6553, 6554]) {
  const { cpu, bus } = setUp(x);
  let cycles = 0;
  for (let i = 0; i < lines.length; i++) cycles += cpu.step();
  const answer = word(bus, NUM);
  const note = answer === x * 10 ? '' : `   ${String(x * 10)} doesn't fit in 16 bits: wrapped, and C=1 says so`;
  console.log(
    `${String(x).padStart(6)}  ${String(x * 10).padStart(8)}  ${String(answer).padStart(8)}    ${cpu.regs.c ? '1' : '0'}   ${String(cycles).padStart(6)}${note}`,
  );
}

console.log('');
console.log('60 cycles is 30 microseconds on the BBC Micro\'s 2 MHz 6502, whatever the number.');
console.log('');
console.log('Watching x = 1000 (&03E8) go through it. Each ASL pushes bit 7 of the low byte');
console.log('into C, and the ROL after it pulls C into bit 0 of the high byte:');
console.log('');
console.log(`${'after'.padEnd(12)}  ${'&81'.padEnd(12)}${'&80'.padEnd(9)}  value  C`);
console.log('------------  ---------------------  -----  -');
const { cpu, bus } = setUp(1000);
console.log(`${'(start)'.padEnd(12)}  ${binary16(word(bus, NUM))}  ${String(word(bus, NUM)).padStart(5)}`);
for (const line of lines) {
  cpu.step();
  if (!/^(ASL|ROL|STA num)/.test(line.source)) continue;
  const value = word(bus, NUM);
  console.log(`${line.source.padEnd(12)}  ${binary16(value)}  ${String(value).padStart(5)}  ${cpu.regs.c ? '1' : '0'}`);
}
