// The FDC panel's view-model (Stage 49): the 8271's status bits, the
// special registers the DFS sets, and the commands it has run.
//
//   Status &10: result waiting (&00)
//   [BUSY] [CMD FULL] [PARAM FULL] [RESULT] [INT] [DATA]
//
//   Mode (&17)            &C1  non-DMA
//   Drive output (&23)    &48  SELECT 0, LOAD HEAD
//   Drive input (&22)     &00  not ready (no drive until Stage 50)
//   ...
//
//   time      bytes           drive  command
//   0.284 s   35 0D 0C 0A C8  none   Specify &0D: step rate &0C, ...
//   2.339 s   6C              0      Read Drive Status → &00: not ready   ×37,215
//
// No DOM here: fdc-panel.ts builds elements, Jest tests this.

import { describeDriveInput, describeFdcEntry, describeMode, describeOutputPort, type FdcLogEntry } from '../../devices/fdc-log';
import {
  FDC_SPECIAL_HEAD_SETTLE,
  FDC_SPECIAL_INDEX_COUNT_HEAD_LOAD,
  FDC_SPECIAL_MODE,
  FDC_SPECIAL_OUTPUT_PORT,
  FDC_SPECIAL_STEP_RATE,
  FDC_SPECIAL_SURFACE0_CURRENT_TRACK,
  FDC_SPECIAL_SURFACE1_CURRENT_TRACK,
  FDC_STATUS_COMMAND_BUSY,
  FDC_STATUS_COMMAND_FULL,
  FDC_STATUS_DATA_REQUEST,
  FDC_STATUS_INTERRUPT,
  FDC_STATUS_PARAMETER_FULL,
  FDC_STATUS_RESULT_FULL,
} from '../../devices/fdc8271';
import { hex8 } from '../../util/bits';

/** The 2 MHz 6502's cycles in a second, for the log's times. */
const CPU_HZ = 2_000_000;

/** How many log entries the panel lists, newest last. */
export const FDC_ENTRIES_SHOWN = 16;

export interface FdcViewInput {
  readonly status: number;
  readonly result: number;
  readonly inReset: boolean;
  readonly driveLines: number;
  readonly special: (address: number) => number;
  /** The log's latest entries, oldest first. */
  readonly entries: readonly FdcLogEntry[];
}

export interface FdcStatusBit {
  /** "BUSY". */
  readonly name: string;
  /** "bit 7: command busy". */
  readonly title: string;
  readonly on: boolean;
}

export interface FdcRegisterRow {
  /** "Mode (&17)". */
  readonly label: string;
  /** "&C1". */
  readonly value: string;
  /** "non-DMA". */
  readonly meaning: string;
}

export interface FdcEntryRow {
  /** "0.284 s": when it (first) ran, since the machine was made. */
  readonly time: string;
  readonly bytes: string;
  readonly drive: string;
  readonly text: string;
  /** "×37,215", or "" if it ran once. */
  readonly repeats: string;
}

export interface FdcView {
  /** "Status &10: result waiting (&00)". */
  readonly summary: string;
  readonly bits: readonly FdcStatusBit[];
  readonly registers: readonly FdcRegisterRow[];
  readonly entries: readonly FdcEntryRow[];
  /** "No commands yet: fit roms/dfs.rom..." when the log is empty, else "". */
  readonly empty: string;
}

const BITS: readonly (readonly [number, string, string])[] = [
  [FDC_STATUS_COMMAND_BUSY, 'BUSY', 'bit 7: command busy'],
  [FDC_STATUS_COMMAND_FULL, 'CMD FULL', 'bit 6: command register full'],
  [FDC_STATUS_PARAMETER_FULL, 'PARAM FULL', 'bit 5: parameter register full'],
  [FDC_STATUS_RESULT_FULL, 'RESULT', 'bit 4: result register full'],
  [FDC_STATUS_INTERRUPT, 'INT', 'bit 3: interrupt request (to /NMI from Stage 50)'],
  [FDC_STATUS_DATA_REQUEST, 'DATA', 'bit 2: non-DMA data request (Stage 50)'],
];

function describeStatus(input: FdcViewInput): string {
  const s = input.status;
  const head = `Status &${hex8(s)}`;
  if (input.inReset) return `${head}: held in reset (&FE82 bit 0 = 1)`;
  if ((s & FDC_STATUS_COMMAND_BUSY) !== 0) return `${head}: busy, waiting for parameters`;
  if ((s & FDC_STATUS_RESULT_FULL) !== 0) return `${head}: result waiting (&${hex8(input.result)})`;
  return `${head}: idle`;
}

function row(label: string, address: number, value: number, meaning: string): FdcRegisterRow {
  return { label: `${label} (&${hex8(address)})`, value: `&${hex8(value)}`, meaning };
}

function nibble(n: number): string {
  return (n & 0x0f).toString(16).toUpperCase();
}

/** "0.284 s". */
export function formatSeconds(cycles: number): string {
  return `${(cycles / CPU_HZ).toFixed(3)} s`;
}

export function buildFdcView(input: FdcViewInput): FdcView {
  const sp = input.special;
  const indexLoad = sp(FDC_SPECIAL_INDEX_COUNT_HEAD_LOAD);
  return {
    summary: describeStatus(input),
    bits: BITS.map(([bit, name, title]) => ({ name, title, on: (input.status & bit) !== 0 })),
    registers: [
      row('Mode', FDC_SPECIAL_MODE, sp(FDC_SPECIAL_MODE), describeMode(sp(FDC_SPECIAL_MODE))),
      row('Drive output', FDC_SPECIAL_OUTPUT_PORT, sp(FDC_SPECIAL_OUTPUT_PORT), describeOutputPort(sp(FDC_SPECIAL_OUTPUT_PORT))),
      row('Drive input', 0x22, input.driveLines, `${describeDriveInput(input.driveLines)} (no drive until Stage 50)`),
      row('Step rate', FDC_SPECIAL_STEP_RATE, sp(FDC_SPECIAL_STEP_RATE), ''),
      row('Head settle', FDC_SPECIAL_HEAD_SETTLE, sp(FDC_SPECIAL_HEAD_SETTLE), ''),
      row('Index count / head load', FDC_SPECIAL_INDEX_COUNT_HEAD_LOAD, indexLoad, `index count &${nibble(indexLoad >> 4)}, head load &${nibble(indexLoad)}`),
      row('Surface 0 track', FDC_SPECIAL_SURFACE0_CURRENT_TRACK, sp(FDC_SPECIAL_SURFACE0_CURRENT_TRACK), ''),
      row('Surface 1 track', FDC_SPECIAL_SURFACE1_CURRENT_TRACK, sp(FDC_SPECIAL_SURFACE1_CURRENT_TRACK), ''),
    ],
    entries: input.entries.slice(-FDC_ENTRIES_SHOWN).map((e) => {
      const text = describeFdcEntry(e);
      return {
        time: formatSeconds(e.cycles),
        bytes: text.bytes,
        drive: text.drive,
        text: text.text,
        repeats: e.repeats > 1 ? `×${e.repeats.toLocaleString('en-GB')}` : '',
      };
    }),
    empty: input.entries.length === 0 ? 'No commands yet. With roms/dfs.rom fitted, the DFS sends four at power-on; type *CAT for more.' : '',
  };
}
