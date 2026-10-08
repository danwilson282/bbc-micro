// Klaus Dormann's 6502 functional test: running it, and reading its listing.
//
// The test is a 64 KB memory image (bin_files/6502_functional_test.bin) built
// with the default settings in 6502_functional_test.a65. The addresses below
// come from its listing (6502_functional_test.lst); dormann.test.ts checks
// them against the file whenever it's present.
//
// DOM- and fs-free: the caller supplies the bytes and the listing text.

import { TestBus } from '../memory/test-bus';
import { Cpu6502 } from './cpu6502';
import { runToTrap, type TrapResult } from './run-to-trap';
import type { StepFunction } from './singlestep';
import { hex16, hex8 } from '../util/bits';

/** The image is a whole 64K address space, loaded at &0000 (listing: vectors at &FFFA-&FFFF). */
export const FUNCTIONAL_TEST_SIZE = 0x10000;
/** "code_segment = $400": where to set PC to start the test. */
export const FUNCTIONAL_TEST_START = 0x0400;
/** "success: jmp * ;test passed, no errors" at &3469. */
export const FUNCTIONAL_TEST_SUCCESS = 0x3469;
/** "test_case ds 1" at &0200 (data_segment): the number of the section running now. */
export const FUNCTIONAL_TEST_CASE = 0x0200;
/** About 96 million cycles to pass; anything far beyond that is lost, not slow. */
export const FUNCTIONAL_TEST_CYCLE_LIMIT = 200_000_000;

export interface FunctionalTestResult {
  readonly passed: boolean;
  readonly trap: TrapResult;
  /** The byte at test_case when it stopped: which section it was in. */
  readonly testCase: number;
}

/**
 * Loads the image into a flat 64K TestBus, sets PC to &0400 (no RESET: the
 * test starts by setting up S and P itself) and runs to the first trap.
 */
export function runFunctionalTest(image: Uint8Array, step?: StepFunction): FunctionalTestResult {
  if (image.length !== FUNCTIONAL_TEST_SIZE) {
    throw new RangeError(`the functional test image should be 65536 bytes, not ${String(image.length)}`);
  }
  const bus = new TestBus();
  bus.load(0x0000, image);
  const cpu = new Cpu6502(bus);
  cpu.regs.pc = FUNCTIONAL_TEST_START;
  const trap = runToTrap(cpu, FUNCTIONAL_TEST_CYCLE_LIMIT, step);
  return {
    passed: trap.kind === 'trap' && trap.pc === FUNCTIONAL_TEST_SUCCESS,
    trap,
    testCase: bus.read(FUNCTIONAL_TEST_CASE),
  };
}

// --- The listing -------------------------------------------------------------
//
// as65 listing lines that produced code look like this:
//
//   0598 : d0fe            >        bne *           ;failed not equal (non zero)
//   └addr  └bytes           └source (">" marks a line that came from a macro)
//
// Other lines are comments, blank, labels with no bytes ("0594 :   test_bne"),
// "0002 =  ..." for constants, or macro definitions (source with no address).

const CODE_LINE = /^([0-9a-f]{4}) : [0-9a-f]+\s/i;

/** The address a listing line assembled to, or undefined for lines with no code. */
function lineAddress(line: string): number | undefined {
  const match = CODE_LINE.exec(line);
  const hex = match?.[1];
  return hex === undefined ? undefined : parseInt(hex, 16);
}

/**
 * The address of "jmp * ;test passed" in the listing, or undefined if it isn't
 * there. The line also appears earlier, in the success macro's definition,
 * with no address; only the expanded copy has one.
 */
export function listingSuccessAddress(listing: string): number | undefined {
  for (const line of listing.split('\n')) {
    const address = lineAddress(line);
    if (address !== undefined && /jmp \*\s*;test passed/i.test(line)) return address;
  }
  return undefined;
}

/**
 * The listing around an address: up to `before` lines leading to the line
 * that assembled to it, and that line last. Empty if no line did. This is
 * how a trap address becomes "bne * ;failed not equal, just after CMP #0".
 */
export function listingContext(listing: string, address: number, before = 8): string[] {
  const lines = listing.split('\n');
  const index = lines.findIndex((line) => lineAddress(line) === address);
  if (index < 0) return [];
  return lines.slice(Math.max(0, index - before), index + 1).map((line) => line.trimEnd());
}

/** as65 puts ">" in column 24 of every line that came from expanding a macro. */
const MACRO_LINE = /^.{23}>/;

/**
 * The trap line, after the last `count` lines of the programmer's own source
 * before it: no macro expansions, no blank lines. The expansions are the
 * checking code (php, cmp, trap_ne); the source says what was being tested.
 *
 *   1b89 : 2415      bit zp1+2   ;41 - should set V (M6) / clear NZ
 *                    tst_a 1,fv
 *   1b94 : d0fe   >  bne *       ;failed not equal (non zero)
 */
export function listingSource(listing: string, address: number, count = 4): string[] {
  const lines = listing.split('\n');
  const index = lines.findIndex((line) => lineAddress(line) === address);
  if (index < 0) return [];
  const source: string[] = [];
  for (let i = index - 1; i >= 0 && source.length < count; i--) {
    const line = (lines[i] ?? '').trimEnd();
    if (line.trim() !== '' && !MACRO_LINE.test(line)) source.unshift(line);
  }
  return [...source, ...lines.slice(index, index + 1).map((line) => line.trimEnd())];
}

/** "PASSED: success trap at &3469" / "FAILED: trapped at &0598 in test &02". */
export function describeFunctionalResult(result: FunctionalTestResult): string {
  const at = `&${hex16(result.trap.pc)}`;
  if (result.passed) return `PASSED: success trap at ${at}`;
  if (result.trap.kind === 'limit') return `FAILED: no trap after ${String(result.trap.cycles)} cycles (PC at ${at})`;
  return `FAILED: trapped at ${at} in test &${hex8(result.testCase)}`;
}
