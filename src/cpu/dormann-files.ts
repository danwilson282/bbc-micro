// Where Dormann's functional test lives, and reading it. Node-only (fs), so
// it's kept apart from dormann.ts. Only tests and CLI demos import it.
//
// Paths are relative to the project root, which is where npm runs jest and
// the demos from.

import { existsSync, readFileSync } from 'node:fs';

/** Where scripts/fetch-test-fixtures.sh puts Dormann's files. */
export const DORMANN_DIR = 'test-fixtures/dormann';
export const FUNCTIONAL_TEST_BIN = `${DORMANN_DIR}/6502_functional_test.bin`;
export const FUNCTIONAL_TEST_LST = `${DORMANN_DIR}/6502_functional_test.lst`;

export function functionalTestExists(): boolean {
  return existsSync(FUNCTIONAL_TEST_BIN) && existsSync(FUNCTIONAL_TEST_LST);
}

/** The 64K image. Throws if it's missing. */
export function loadFunctionalTestImage(): Uint8Array {
  return new Uint8Array(readFileSync(FUNCTIONAL_TEST_BIN));
}

/** The assembler listing, as text. Throws if it's missing. */
export function loadFunctionalTestListing(): string {
  return readFileSync(FUNCTIONAL_TEST_LST, 'utf8');
}
