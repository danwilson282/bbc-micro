// For Jest tests that need real ROM files. They're Acorn copyright, so
// they may not be there: then the test skips, with a message saying which
// file is missing, and never fails. Import this only from *.test.ts files.
//
//   withRoms('roms/os12.rom')('the reset vector is &D9CD', () => { ... });

import { romFileExists } from './rom-files';

/** Jest's `test` if every path exists, otherwise a `test.skip` that says which files are missing. */
export function withRoms(...paths: readonly string[]): (name: string, fn: jest.ProvidesCallback) => void {
  const missing = paths.filter((p) => !romFileExists(p));
  if (missing.length === 0) return test;
  return (name, fn) => {
    console.log(`skipping "${name}": ${missing.join(', ')} missing (Acorn copyright, so you supply it)`);
    test.skip(name, fn);
  };
}
