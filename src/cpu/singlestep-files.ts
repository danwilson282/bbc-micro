// Where the SingleStepTests files live, and reading them. Node-only (fs), so
// it's kept apart from singlestep.ts. Only tests and CLI demos import it.
//
// Paths are relative to the project root, which is where npm runs jest and
// the demos from.

import { existsSync, readFileSync } from 'node:fs';
import { hex8 } from '../util/bits';
import { parseCases, type SingleStepCase } from './singlestep';

/** Where scripts/fetch-test-fixtures.sh puts the NMOS 6502 set. */
export const SINGLESTEP_DIR = 'test-fixtures/singlestep/6502';

/** "test-fixtures/singlestep/6502/a9.json": the files are named by opcode in lower-case hex. */
export function singleStepFile(opcode: number): string {
  return `${SINGLESTEP_DIR}/${hex8(opcode).toLowerCase()}.json`;
}

export function singleStepFileExists(opcode: number): boolean {
  return existsSync(singleStepFile(opcode));
}

/** Reads and checks one opcode's 10,000 cases. Throws if the file is missing or malformed. */
export function loadSingleStepCases(opcode: number): SingleStepCase[] {
  return parseCases(JSON.parse(readFileSync(singleStepFile(opcode), 'utf8')));
}

/** The opcode list in fetch-test-fixtures.sh's DOCUMENTED_OPCODES="…" block, as numbers. */
export function documentedOpcodes(script: string): number[] {
  const block = /DOCUMENTED_OPCODES="([^"]*)"/.exec(script)?.[1] ?? '';
  return block
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => parseInt(token, 16));
}
