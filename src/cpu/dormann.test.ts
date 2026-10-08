import {
  FUNCTIONAL_TEST_CASE,
  FUNCTIONAL_TEST_START,
  FUNCTIONAL_TEST_SUCCESS,
  describeFunctionalResult,
  listingContext,
  listingSource,
  listingSuccessAddress,
  runFunctionalTest,
} from './dormann';
import {
  FUNCTIONAL_TEST_BIN,
  functionalTestExists,
  loadFunctionalTestImage,
  loadFunctionalTestListing,
} from './dormann-files';

/** A few real lines from 6502_functional_test.lst, in its format. */
const LISTING = [
  '                        success macro',
  '                                jmp *           ;test passed, no errors',
  '                                endm',
  '                        ;partial test BNE & CMP, CPX, CPY immediate',
  '058d : c001                     cpy #1          ;testing BNE true',
  '058f : d003                     bne test_bne',
  '                                trap ',
  '0591 : 4c9105          >        jmp *           ;failed anyway',
  '                        ',
  '0594 :                  test_bne',
  '0594 : a900                     lda #0 ',
  '0596 : c900                     cmp #0          ;test compare immediate ',
  '                                trap_ne',
  '0598 : d0fe            >        bne *           ;failed not equal (non zero)',
  '0002 =                 >test_num = test_num + 1',
  '3469 : 4c6934          >        jmp *           ;test passed, no errors',
].join('\n');

/** A 64K image whose code at &0400 is the given bytes; everything else is &00. */
function imageWith(code: readonly number[]): Uint8Array {
  const image = new Uint8Array(0x10000);
  image.set(code, FUNCTIONAL_TEST_START);
  return image;
}

describe('the listing', () => {
  test('finds the success trap: the expanded "jmp * ;test passed" line, not the macro definition', () => {
    expect(listingSuccessAddress(LISTING)).toBe(0x3469);
    expect(listingSuccessAddress('no such line')).toBeUndefined();
  });

  test('turns a trap address into the source lines leading up to it', () => {
    const context = listingContext(LISTING, 0x0598, 2);
    expect(context).toEqual([
      '0596 : c900                     cmp #0          ;test compare immediate',
      '                                trap_ne',
      '0598 : d0fe            >        bne *           ;failed not equal (non zero)',
    ]);
  });

  test('a label-only line has no code, so the address matches the instruction after it', () => {
    expect(listingContext(LISTING, 0x0594, 0)).toEqual(['0594 : a900                     lda #0']);
  });

  test('the source view skips macro expansions (">") and blanks, keeping the trap line last', () => {
    expect(listingSource(LISTING, 0x0598, 3)).toEqual([
      '0594 : a900                     lda #0',
      '0596 : c900                     cmp #0          ;test compare immediate',
      '                                trap_ne',
      '0598 : d0fe            >        bne *           ;failed not equal (non zero)',
    ]);
    expect(listingSource(LISTING, 0x1234)).toEqual([]);
  });

  test('an address with no line gives no context; "=" constant lines are not code', () => {
    expect(listingContext(LISTING, 0x1234)).toEqual([]);
    expect(listingContext(LISTING, 0x0002)).toEqual([]);
  });
});

describe('runFunctionalTest on small stand-in images', () => {
  test('a JMP * at &0400 is a trap, but not the success trap: FAILED', () => {
    const result = runFunctionalTest(imageWith([0x4c, 0x00, 0x04]));
    expect(result.passed).toBe(false);
    expect(result.trap).toMatchObject({ kind: 'trap', pc: 0x0400 });
    expect(describeFunctionalResult(result)).toBe('FAILED: trapped at &0400 in test &00');
  });

  test('reaching JMP * at &3469 is PASSED, and test_case is read from &0200', () => {
    const image = imageWith([0xa9, 0x2a, 0x8d, 0x00, 0x02, 0x4c, 0x69, 0x34]); // LDA #&2A, STA &0200, JMP &3469
    image.set([0x4c, 0x69, 0x34], FUNCTIONAL_TEST_SUCCESS);
    const result = runFunctionalTest(image);
    expect(result.passed).toBe(true);
    expect(result.testCase).toBe(0x2a);
    expect(image[FUNCTIONAL_TEST_CASE]).toBe(0x00); // the image itself is untouched
    expect(describeFunctionalResult(result)).toBe('PASSED: success trap at &3469');
  });

  test('an image that is not 64K is rejected', () => {
    expect(() => runFunctionalTest(new Uint8Array(100))).toThrow(/65536/);
  });
});

// The real thing. Needs scripts/fetch-test-fixtures.sh; skips (doesn't fail) without it.
const haveFixture = functionalTestExists();
if (!haveFixture) {
  console.log(`Dormann functional test: skipping, ${FUNCTIONAL_TEST_BIN} is missing (run npm run fetch-fixtures)`);
}
const withFixture = haveFixture ? test : test.skip;

describe("Klaus Dormann's 6502 functional test", () => {
  withFixture('our success address matches the listing', () => {
    expect(listingSuccessAddress(loadFunctionalTestListing())).toBe(FUNCTIONAL_TEST_SUCCESS);
  });

  withFixture(
    'reaches the success trap at &3469, after 30,646,177 instructions and 96,241,367 cycles',
    () => {
      const result = runFunctionalTest(loadFunctionalTestImage());
      expect(describeFunctionalResult(result)).toBe('PASSED: success trap at &3469');
      // Measured with our core, so they pin it against future changes: one wrong
      // cycle count anywhere would move them. They aren't from an outside source.
      expect(result.trap.instructions).toBe(30_646_177);
      expect(result.trap.cycles).toBe(96_241_367);
      expect(result.testCase).toBe(0xf0);
    },
    60_000,
  );
});
