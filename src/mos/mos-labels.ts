// What we know about MOS 1.20, for reading traces of it.
//
// Three kinds of knowledge, kept apart because they're trusted differently:
//
//   MOS_LABELS     names that replace addresses in the disassembly:
//                  - the OS calls and page 2 vectors: published in the
//                    Advanced User Guide, so facts;
//                  - routines: OUR names, for code worked out by reading the
//                    disassembly in Stage 23 (Acorn's own labels aren't
//                    published). Each says how we know what it does.
//   MOS_NOTES      a comment on one instruction: why it's there.
//   MOS_VARIABLES  what a documented workspace address holds (AUG). Shown as
//                  a comment, so the trace keeps the address in hex.
//
// formatMosTraceLine() adds the comment to a Stage 18 trace line.

import { disassemble, type Labels } from '../cpu/disassembler';
import { formatTraceLine, type TraceEntry } from '../cpu/trace';
import { FRED_START } from '../memory/memory-regions';
import { describeIoAddress } from '../memory/sheila';

/** The OS calls, at the fixed addresses programs use (AUG, "Operating system calls"). */
const OS_CALLS: readonly (readonly [number, string])[] = [
  [0xffce, 'OSFIND'],
  [0xffd1, 'OSGBPB'],
  [0xffd4, 'OSBPUT'],
  [0xffd7, 'OSBGET'],
  [0xffda, 'OSARGS'],
  [0xffdd, 'OSFILE'],
  [0xffe0, 'OSRDCH'],
  [0xffe3, 'OSASCI'],
  [0xffe7, 'OSNEWL'],
  [0xffec, 'OSWRCR'],
  [0xffee, 'OSWRCH'],
  [0xfff1, 'OSWORD'],
  [0xfff4, 'OSBYTE'],
  [0xfff7, 'OSCLI'],
];

/** The page 2 vectors, two bytes each from &0200 (AUG, "Vectors"). An OS call jumps through one, so software can redirect it. */
export const VECTOR_NAMES: readonly string[] = [
  'USERV', 'BRKV', 'IRQ1V', 'IRQ2V', 'CLIV', 'BYTEV', 'WORDV', 'WRCHV', 'RDCHV',
  'FILEV', 'ARGSV', 'BGETV', 'BPUTV', 'GBPBV', 'FINDV', 'FSCV', 'EVNTV', 'UPTV',
  'NETV', 'VDUV', 'KEYV', 'INSV', 'REMV', 'CNPV', 'IND1V', 'IND2V', 'IND3V',
];

const VECTORS_START = 0x0200;

/** A vector's default target: where MOS 1.20 points it at reset. */
export interface DefaultHandler {
  readonly vector: number;
  readonly address: number;
  readonly name: string;
}

/**
 * The default handlers for the vectors this stage's traces go through. Read
 * from the table the MOS copies from &D940 into page 2 at reset; a test
 * checks them against os12.rom.
 */
export const DEFAULT_HANDLERS: readonly DefaultHandler[] = [
  { vector: 0x0202, address: 0xdc54, name: 'defaultBRK' },
  { vector: 0x0204, address: 0xdc93, name: 'defaultIRQ1' },
  { vector: 0x0208, address: 0xdf89, name: 'defaultCLI' },
  { vector: 0x020a, address: 0xe772, name: 'defaultBYTE' },
  { vector: 0x020c, address: 0xe7eb, name: 'defaultWORD' },
  { vector: 0x020e, address: 0xe0a4, name: 'defaultWRCH' },
  { vector: 0x0210, address: 0xdec5, name: 'defaultRDCH' },
  { vector: 0x0228, address: 0xef02, name: 'defaultKEY' },
  { vector: 0x022a, address: 0xe4b3, name: 'defaultINS' },
  { vector: 0x022c, address: 0xe464, name: 'defaultREM' },
  { vector: 0x022e, address: 0xe1d1, name: 'defaultCNP' },
];

/**
 * Routines named by us, from reading the Stage 23 disassembly. The comment
 * on each says what it does and how we know.
 */
const ROUTINES: readonly (readonly [number, string])[] = [
  [0xd9cd, 'reset'], //         the reset vector at &FFFC points here
  [0xd9e7, 'clearMemory'], //   STA (&00),Y up through RAM from &0400; power-on only
  [0xda03, 'setLatch'], //      DDRB = &0F, then &0E..&08 to port B: IC32 bits 6..0 = 1
  [0xda11, 'readLinks'], //     keyTest on keys 9..1 (the 8 links, then CTRL) into &FC
  [0xdabd, 'romScan'], //       per slot: selectRom, compare the "(C)" with &DF0C, store type at &02A1+X
  [0xdc16, 'selectRom'], //     STX &F4 : STX &FE30 : RTS
  [0xc300, 'vduInit'], //       JMP &CB1D: clears VDU workspace, picks the mode (16K: ORA #4)
  [0xdea9, 'printMessage'], //  prints &C300+Y+1 onwards with OSASCI, up to a &00
  [0xc4c0, 'vdu'], //           the VDU driver's character entry, called by defaultWRCH
  [0xc6f0, 'vdu10'], //         reached through JMP (&035D) for character &0A: line feed
  [0xcae0, 'scrollHalted'], //  the top of the CTRL+SHIFT loop
  [0xcae3, 'ctrlShiftWait'], // readCtrlShift; loop while C (CTRL) and N (SHIFT) are both set
  [0xe9d9, 'readCtrlShift'], // calls KEYV with C = V = 0; returns C = CTRL, N = SHIFT
  [0xeeeb, 'keyLeds'], //       writes IC32 bits 6 and 7 (the lock LEDs) from &025A
  [0xf02a, 'keyTest'], //       key number X out on port A, read back: bit 7 = down
  [0xf12e, 'autoScanOn'], //    LDA #&0B : STA &FE40: IC32 bit 3 = 1, keyboard scans itself again
  [0xdee6, 'rdchWait'], //      inside defaultRDCH: loop until the input buffer isn't empty
];

/** Address → name, for the disassembler and the trace. */
export const MOS_LABELS: Labels = new Map<number, string>([
  ...OS_CALLS,
  ...VECTOR_NAMES.map((name, i): [number, string] => [VECTORS_START + i * 2, name]),
  ...DEFAULT_HANDLERS.map((h): [number, string] => [h.address, h.name]),
  ...ROUTINES,
]);

/** Comments for particular instructions: why they're there. */
export const MOS_NOTES: ReadonlyMap<number, string> = new Map<number, string>([
  [0xd9cd, '&40 = RTI opcode ...'],
  [0xd9cf, '... at &0D00, where NMI goes: a stray NMI returns at once'],
  [0xd9d2, 'no IRQs during set-up'],
  [0xd9d3, 'reset left D as it was (NMOS)'],
  [0xd9d6, 'stack empty: next push goes to &01FF'],
  [0xd9d7, 'IER: power-on cleared it (reads &80); BREAK left &F2'],
  [0xd9da, '&80 → &00 means power-on; anything else, BREAK'],
  [0xd9db, 'keep the answer for &DA2A'],
  [0xd9dc, 'power-on: go and clear memory'],
  [0xd9de, '*FX200: should BREAK clear memory too?'],
  [0xd9e4, 'no: keep RAM as it is'],
  [0xda05, 'DDRB = &0F: PB0-3 drive the IC32 latch'],
  [0xda09, 'IC32: bit (X AND 7) := X bit 3'],
  [0xda12, 'is key A down? 9-2 are the links, 1 is CTRL'],
  [0xda15, 'C = bit 7 of the answer: down'],
  [0xda17, 'shift it into &FC'],
  [0xda1d, '&028D = 0 (soft BREAK) for now'],
  [0xda2a, 'the power-on answer from &D9DB'],
  [0xda2f, 'CTRL not down: soft BREAK'],
  [0xda33, 'CTRL+BREAK: &028D = 2 ...'],
  [0xda36, '... (power-on: 1)'],
  [0xda3d, 'start-up options = links EOR &FF'],
  [0xf02a, 'IC32 bit 3 := 0 ...'],
  [0xf02c, '... keyboard autoscan off: we ask about one key'],
  [0xf031, 'DDRA = &7F: PA0-6 out (key number), PA7 in'],
  [0xf034, 'key number on port A'],
  [0xf037, 'bit 7 = that key is down. No VIA: the read floats'],
  [0xcae6, 'CTRL not down: carry on'],
  [0xcae8, 'CTRL and SHIFT down: halt scrolling, ask again'],
  [0xef1d, 'X = &00: SHIFT'],
  [0xef23, 'SHIFT not down?'],
  [0xef2b, 'X = &01: CTRL'],
  [0xe9e8, 'C = CTRL, N = SHIFT'],
  [0xdeb2, 'next character of the message'],
  [0xe466, 'buffer X empty? (start index = end index)'],
]);

/** Documented MOS workspace (AUG, "Memory usage"), for comments. */
export const MOS_VARIABLES: ReadonlyMap<number, string> = new Map<number, string>([
  [0x00d0, 'VDU status byte'],
  [0x00f4, 'paged ROM number: RAM copy of ROMSEL'],
  [0x00ff, 'ESCAPE flag (bit 7)'],
  [0x024b, 'BASIC ROM slot'],
  [0x0258, '*FX200: ESCAPE/BREAK effect'],
  [0x025a, 'keyboard status: CAPS/SHIFT LOCK'],
  [0x028d, 'last BREAK type: 0 soft, 1 power-on, 2 hard'],
  [0x028e, 'RAM size: &40 = 16K, &80 = 32K'],
  [0x028f, 'start-up options (the keyboard links)'],
  [0x0355, 'screen mode'],
  [0x0d00, 'NMI routine (the NMI vector points here)'],
]);

const ROM_TYPE_TABLE = 0x02a1;
const ROM_SLOTS = 16;

/** What a workspace address holds, or undefined if we don't know. */
export function describeMosVariable(address: number): string | undefined {
  const a = address & 0xffff;
  if (a >= ROM_TYPE_TABLE && a < ROM_TYPE_TABLE + ROM_SLOTS) return `ROM type table: slot ${String(a - ROM_TYPE_TABLE)}`;
  return MOS_VARIABLES.get(a);
}

/** "keyTest:" if a named routine starts at pc, for a heading above its first line. */
export function mosHeading(pc: number): string | undefined {
  const name = MOS_LABELS.get(pc & 0xffff);
  return name === undefined ? undefined : `${name}:`;
}

/** Where a data operand points, with the index added for abs,X and abs,Y. Undefined for code and immediates. */
function dataAddress(entry: TraceEntry): number | undefined {
  const { bytes, pc } = entry;
  const d = disassemble((address) => bytes[(address - pc) & 0xffff] ?? 0, pc);
  switch (d.mode) {
    case 'absolute':
    case 'zeroPage':
      // A JMP or JSR target is code, not data.
      return d.mnemonic === 'JMP' || d.mnemonic === 'JSR' ? undefined : d.target;
    case 'absoluteX':
      return ((d.target ?? 0) + entry.x) & 0xffff;
    case 'absoluteY':
      return ((d.target ?? 0) + entry.y) & 0xffff;
    case 'zeroPageX':
      return ((d.target ?? 0) + entry.x) & 0xff;
    default:
      return undefined;
  }
}

/** Why an instruction is there, or what it touches, or undefined. */
function comment(entry: TraceEntry): string | undefined {
  const note = MOS_NOTES.get(entry.pc);
  if (note !== undefined) return note;
  if (entry.kind !== 'instruction') return undefined;
  const address = dataAddress(entry);
  if (address === undefined) return undefined;
  if (address >= FRED_START && address <= 0xfeff) return describeIoAddress(address).text;
  return describeMosVariable(address);
}

/** A Stage 18 trace line with MOS names in the operands, and a comment if we know something. */
export function formatMosTraceLine(entry: TraceEntry): string {
  const line = formatTraceLine(entry, MOS_LABELS);
  const note = comment(entry);
  return note === undefined ? line : `${line}  ; ${note}`;
}
