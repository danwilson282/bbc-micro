import { assemble } from '../asm/assembler';
import { TestBus } from '../memory/test-bus';
import { Cpu6502 } from './cpu6502';
import { StallDetector, lastLap } from './stall-detector';
import type { TraceEntry } from './trace';

/** A CPU on a flat 64K bus with source assembled into it, PC at its first byte. */
function cpuWith(source: string): Cpu6502 {
  const assembly = assemble(source);
  if (!assembly.ok) throw new Error(assembly.errors.map((e) => e.message).join('\n'));
  const bus = new TestBus();
  for (const line of assembly.lines) bus.load(line.address, line.bytes);
  const cpu = new Cpu6502(bus);
  cpu.regs.pc = assembly.entry ?? 0;
  return cpu;
}

/** Steps with the detector watching, until it reports a stall or maxSteps run out. */
function run(cpu: Cpu6502, detector: StallDetector, maxSteps: number): number {
  for (let i = 0; i < maxSteps; i++) {
    if (detector.isStalled(cpu.cycles)) return i;
    detector.record(cpu.regs.pc, cpu.cycles);
    cpu.step();
  }
  return maxSteps;
}

// A loop that waits for a "key" bit that never comes, spread over two
// subroutines a page apart: the shape of the MOS's CTRL+SHIFT wait.
const WAIT_FOR_KEY = `
        *= &0400
        LDX #0
        STX &70
wait:   JSR check       ; &0404
        BMI wait        ; &0407
        BRK
        *= &0500
check:  JSR read        ; &0500
        RTS             ; &0503
        *= &0600
read:   LDA &70         ; &0600: always 0 ...
        EOR #&80        ; ... so N is always 1
        RTS             ; &0604
`;

describe('StallDetector', () => {
  test('a loop that only revisits old addresses is a stall once no new address has run for stallCycles', () => {
    const cpu = cpuWith(WAIT_FOR_KEY);
    const detector = new StallDetector(1000);
    run(cpu, detector, 10_000);
    expect(detector.isStalled(cpu.cycles)).toBe(true);
    // The last new address was BMI (&0407), first run after LDX, STX, JSR, JSR, LDA, EOR, RTS, RTS:
    // 2+3+6+6+3+2+6+6 = 34 cycles in. After that, every lap is old code.
    expect(detector.lastNewCycle).toBe(34);
    expect(cpu.cycles - detector.lastNewCycle).toBeGreaterThanOrEqual(1000);
  });

  test('the loop body is what still runs in the second half of the stall: the lead-in (LDX, STX) drops out', () => {
    const cpu = cpuWith(WAIT_FOR_KEY);
    const detector = new StallDetector(1000);
    run(cpu, detector, 10_000);
    expect(detector.loopAddresses()).toEqual([0x0404, 0x0407, 0x0500, 0x0503, 0x0600, 0x0602, 0x0604]);
  });

  test('code that keeps reaching new addresses is never a stall, however long it runs', () => {
    // 256 NOPs in a row: each step is at a new address.
    const cpu = cpuWith(`
        *= &0400
${'        NOP\n'.repeat(256)}
done:   JMP done
`);
    const detector = new StallDetector(100);
    for (let i = 0; i < 256; i++) {
      detector.record(cpu.regs.pc, cpu.cycles);
      cpu.step();
      expect(detector.isStalled(cpu.cycles)).toBe(false);
    }
  });

  test('a long loop is not a stall while it runs for less than stallCycles', () => {
    // 200 laps of a 5-cycle loop = 1000 cycles, then on to new code.
    const cpu = cpuWith(`
        *= &0400
        LDY #200
lap:    DEY             ; 2 cycles
        BNE lap         ; 3 cycles when taken
        NOP
        NOP
`);
    const detector = new StallDetector(2000);
    const steps = run(cpu, detector, 403);
    expect(steps).toBe(403);
    expect(detector.isStalled(cpu.cycles)).toBe(false);
  });

  test('firstRun gives the step number at which an address first ran, or undefined if it never did', () => {
    const cpu = cpuWith(WAIT_FOR_KEY);
    const detector = new StallDetector(1000);
    run(cpu, detector, 100);
    expect(detector.firstRun(0x0400)).toBe(1); // LDX: the first step
    expect(detector.firstRun(0x0600)).toBe(5); // LDX, STX, JSR check, JSR read, LDA
    expect(detector.firstRun(0x0409)).toBeUndefined(); // the BRK is never reached
  });

  test('clear() forgets everything: the next address is new again', () => {
    const detector = new StallDetector(10);
    detector.record(0x0400, 0);
    detector.record(0x0400, 100);
    expect(detector.isStalled(100)).toBe(true);
    detector.clear();
    expect(detector.firstRun(0x0400)).toBeUndefined();
    detector.record(0x0400, 100);
    expect(detector.isStalled(105)).toBe(false);
    expect(detector.lastNewCycle).toBe(100);
  });

  test('nothing recorded yet is not a stall', () => {
    expect(new StallDetector(10).isStalled(1_000_000)).toBe(false);
  });
});

describe('lastLap', () => {
  /** Just the PCs: lastLap looks at nothing else. */
  const at = (pcs: readonly number[]): TraceEntry[] => pcs.map((pc) => ({ kind: 'instruction', cycles: 0, pc, bytes: [], a: 0, x: 0, y: 0, s: 0, p: 0 }));

  test('one lap runs from the last-but-one to the last visit of the instruction that runs once per lap', () => {
    // A lap is 1, 5, 6, 5, 6 (5-6 runs twice a lap, like keyTest), with lead-in 9.
    const trace = at([9, 1, 5, 6, 5, 6, 1, 5, 6, 5, 6, 1, 5]);
    expect(lastLap(trace).map((e) => e.pc)).toEqual([1, 5, 6, 5, 6]);
  });

  test('of the instructions that run once a lap, the lap starts at the lowest address', () => {
    expect(lastLap(at([2, 1, 2, 1, 2, 1])).map((e) => e.pc)).toEqual([1, 2]);
  });

  test('with less than two laps in the trace, there is no lap', () => {
    expect(lastLap(at([1, 2, 3]))).toEqual([]);
  });
});
