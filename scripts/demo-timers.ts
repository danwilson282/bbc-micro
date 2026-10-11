// Stage 25 demo: the 6522's timers, one VIA cycle at a time.
//
//   npm run demo:timers
//
// Part 1 prints the datasheet's timing diagrams as tables: T1 free-running
// and one-shot with a tiny latch of 3, and T2 one-shot. Part 2 checks the
// MOS's 100 Hz setting (latch &270E). Part 3 shows the torn 16-bit read the
// Stage 25 example was changed to avoid.

import {
  ACR_T1_FREE_RUN,
  ACR_T1_PB7_OUTPUT,
  CPU_CYCLES_PER_VIA_CYCLE,
  IFR_T1,
  IFR_T2,
  VIA_ACR,
  VIA_IFR,
  VIA_T1C_H,
  VIA_T1C_L,
  VIA_T2C_H,
  VIA_T2C_L,
  Via6522,
} from '../src/devices/via6522';
import { hex16, hex8 } from '../src/util/bits';

const CYCLES = 12;

function row(label: string, cells: readonly string[]): string {
  return `${label.padEnd(14)}${cells.map((c) => c.padStart(6)).join('')}`;
}

function timeline(title: string, via: Via6522, which: 1 | 2, start: () => void): void {
  start();
  const counter: string[] = [];
  const flag: string[] = [];
  const pb7: string[] = [];
  const flagBit = which === 1 ? IFR_T1 : IFR_T2;
  const record = (): void => {
    const t = via.timers();
    counter.push(hex16(which === 1 ? t.t1.counter : t.t2.counter));
    flag.push(via.peek(VIA_IFR) & flagBit ? '1' : '0');
    pb7.push(String((via.pins('b') >> 7) & 1));
  };
  record();
  for (let i = 0; i < CYCLES; i++) {
    via.tick(CPU_CYCLES_PER_VIA_CYCLE);
    record();
  }
  console.log(title);
  console.log(row('VIA cycle', Array.from({ length: CYCLES + 1 }, (_, i) => (i === 0 ? 'write' : String(i)))));
  console.log(row('counter', counter));
  console.log(row(`IFR bit ${which === 1 ? '6' : '5'}`, flag));
  if (which === 1) console.log(row('PB7', pb7));
  console.log('');
}

console.log('Part 1: the timing diagrams, one VIA cycle (1 µs, 2 CPU cycles) per column\n');

const free = new Via6522();
timeline('T1 free-running, latch &0003, ACR = &C0 (free-run + PB7):', free, 1, () => {
  free.write(VIA_ACR, ACR_T1_FREE_RUN | ACR_T1_PB7_OUTPUT);
  free.write(VIA_T1C_L, 0x03);
  free.write(VIA_T1C_H, 0x00);
});
console.log('  3, 2, 1, 0, FFFF, then 3 again: a period of N+2 = 5 cycles. Nobody clears the');
console.log('  flag here, so the second timeout is lost in it. PB7 inverts at each timeout.\n');

const oneShot = new Via6522();
timeline('T1 one-shot, latch &0003, ACR = &80 (one-shot + PB7):', oneShot, 1, () => {
  oneShot.write(VIA_ACR, ACR_T1_PB7_OUTPUT);
  oneShot.write(VIA_T1C_L, 0x03);
  oneShot.write(VIA_T1C_H, 0x00);
});
console.log('  One flag, and one low pulse on PB7. The counter still reloads from the latch.\n');

const t2 = new Via6522();
timeline('T2 one-shot, &0003:', t2, 2, () => {
  t2.write(VIA_T2C_L, 0x03);
  t2.write(VIA_T2C_H, 0x00);
});
console.log('  No reload: after FFFF it carries on down, so you can see how long ago it ran out.\n');

console.log("Part 2: the MOS's System VIA setting (os12.rom &DA88): ACR = &60, latch = &270E\n");
const mos = new Via6522();
mos.write(VIA_ACR, 0x60);
mos.write(VIA_T1C_L, 0x0e);
mos.write(VIA_T1C_H, 0x27);
const at: number[] = [];
for (let cpu = 2; cpu <= 2_000_000; cpu += 2) {
  mos.tick(2);
  if (mos.peek(VIA_IFR) & IFR_T1) {
    at.push(cpu);
    mos.read(VIA_T1C_L); // acknowledge, as the interrupt handler will
  }
}
console.log(`  timeouts in one emulated second: ${String(at.length)}`);
console.log(`  first at CPU cycle ${at[0]?.toLocaleString('en-GB') ?? '?'}, then every ${((at[1] ?? 0) - (at[0] ?? 0)).toLocaleString('en-GB')} CPU cycles`);
console.log('  = (9,998 + 2) µs = 10 ms: 100 Hz, the centisecond clock.\n');

console.log('Part 3: reading a 16-bit counter one byte at a time\n');
const tear = new Via6522();
tear.write(VIA_T2C_L, 0x04);
tear.write(VIA_T2C_H, 0xff);
tear.tick(CPU_CYCLES_PER_VIA_CYCLE); // the load cycle: the counter is &FF04
const low = tear.read(VIA_T2C_L);
tear.tick(14); // 7 VIA cycles pass between the two LDAs
const high = tear.read(VIA_T2C_H);
console.log(`  low byte read first:  &${hex8(low)}   (counter was &FF04)`);
console.log(`  high byte, 7 µs later: &${hex8(high)}   (counter is now &${hex16(tear.timers().t2.counter)})`);
console.log(`  the program sees &${hex8(high)}${hex8(low)}: 256 µs out, because the low byte wrapped in between.`);
