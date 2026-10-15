// The BBC Micro's keyboard matrix (Stage 34), replacing the Stage 28 stub.
//
// The keys are switches on a grid of 10 columns × 8 rows. Each key joins
// one column to one row. The Advanced User Guide numbers the positions:
//
//   internal key number = row × 16 + column       (&41 = row 4, column 1 = A)
//
// which is also exactly what the CPU writes to the System VIA's port A to
// ask about a key: PA0-PA3 pick the column, PA4-PA6 the row. With autoscan
// off, the keyboard answers on PA7: 1 if that switch is closed.
//
// Row 0, columns 2-9 aren't keys: they're eight start-up option links on
// the keyboard PCB. A closed link joins its row and column, just as a held
// key would. The MOS reads them at reset into &028F, inverted (&DA11-&DA3D),
// so bit b of &028F is the link on column 9 - b, 1 = open. `links` uses
// that same layout, so it's the value the MOS will store (Stage 28).
//
// The state is one byte per column, bit r = row r closed: the shape the
// hardware has (drive a column, see its rows). Stage 35's "is any key down
// in this column?" for CA2 is then one read and an AND.
//
// Stage 35 adds the keyboard PCB's scan logic. A 4-bit counter picks the
// column: with autoscan on (IC32 bit 3 = 1) it counts 0-15 at 1 MHz by
// itself; with it off it's loaded from PA0-PA3, so the CPU picks. Either
// way, "is any key in rows 1-7 of this column down?" goes out on CA2, and
// the System VIA interrupts on its rising edge (PCR &04). Columns 10-15
// select nothing. Row 0 (SHIFT, CTRL, the links) is left out of CA2, or a
// closed link would interrupt for ever.
//
// PA7 is still driven low in autoscan: a real board would show a row of the
// counter's column, but the MOS never reads it then (see the Stage 35 doc).

import type { Clocked } from './clocked';

/** 10 columns (0-9) by 8 rows (0-7). */
export const MATRIX_COLUMNS = 10;
export const MATRIX_ROWS = 8;

/** The column counter is 4 bits wide: 0-15. */
const COUNTER_MASK = 0x0f;

/** CA2's NAND gate sees rows 1-7 only. */
const CA2_ROWS = 0xfe;

/** The counter is clocked at 1 MHz: one step per 2 CPU (2 MHz) cycles. */
const CPU_CYCLES_PER_SCAN_STEP = 2;

/** All links open: &028F = &FF, MODE 7. A sensible default, not a fact about every Model B (see the Stage 28 doc). */
export const DEFAULT_LINKS = 0xff;

/** Row 0, columns 2-9: the links. */
const FIRST_LINK_COLUMN = 2;
const LAST_LINK_COLUMN = 9;

/** One key on the BBC keyboard, and where it sits in the matrix. */
export interface BbcKey {
  /** Unique: "A", "SHIFT", "f0", "LEFT", ":". */
  readonly name: string;
  /** What's printed on the key, unshifted (or the key's name for the special keys). */
  readonly legend: string;
  /** What SHIFT gives, where the key has a second symbol. */
  readonly shifted?: string;
  /** Internal key number: row × 16 + column. */
  readonly key: number;
}

/** row × 16 + column. */
export function keyNumber(row: number, column: number): number {
  return ((row & 0x07) << 4) | (column & 0x0f);
}

/** PA4-PA6. */
export function keyRow(key: number): number {
  return (key >> 4) & 0x07;
}

/** PA0-PA3. */
export function keyColumn(key: number): number {
  return key & 0x0f;
}

/** A key with no second symbol: letters and the named keys. */
function k(name: string, key: number, legend = name): BbcKey {
  return { name, legend, key };
}

/** A key with a shifted symbol, e.g. 2 and ". */
function s(name: string, shifted: string, key: number): BbcKey {
  return { name, legend: name, shifted, key };
}

/**
 * All 72 keys in the matrix, by row (BREAK makes 73, but it is wired to reset). Positions from the Advanced User Guide's
 * internal key numbers (and its INKEY table: INKEY -n is key n - 1).
 * Shifted symbols from the Model B's keytops.
 */
export const BBC_KEYS: readonly BbcKey[] = [
  // Row 0: SHIFT, CTRL, then the eight links (not keys).
  k('SHIFT', 0x00), k('CTRL', 0x01),
  // Row 1
  k('Q', 0x10), s('3', '#', 0x11), s('4', '$', 0x12), s('5', '%', 0x13), k('f4', 0x14), s('8', '(', 0x15),
  k('f7', 0x16), s('-', '=', 0x17), s('^', '~', 0x18), k('LEFT', 0x19, '←'),
  // Row 2
  k('f0', 0x20), k('W', 0x21), k('E', 0x22), k('T', 0x23), s('7', "'", 0x24), k('I', 0x25), s('9', ')', 0x26),
  k('0', 0x27), s('_', '£', 0x28), k('DOWN', 0x29, '↓'),
  // Row 3
  s('1', '!', 0x30), s('2', '"', 0x31), k('D', 0x32), k('R', 0x33), s('6', '&', 0x34), k('U', 0x35), k('O', 0x36),
  k('P', 0x37), s('[', '{', 0x38), k('UP', 0x39, '↑'),
  // Row 4
  k('CAPS LOCK', 0x40), k('A', 0x41), k('X', 0x42), k('F', 0x43), k('Y', 0x44), k('J', 0x45), k('K', 0x46),
  k('@', 0x47), s(':', '*', 0x48), k('RETURN', 0x49),
  // Row 5
  k('SHIFT LOCK', 0x50), k('S', 0x51), k('C', 0x52), k('G', 0x53), k('H', 0x54), k('N', 0x55), k('L', 0x56),
  s(';', '+', 0x57), s(']', '}', 0x58), k('DELETE', 0x59),
  // Row 6
  k('TAB', 0x60), k('Z', 0x61), k('SPACE', 0x62), k('V', 0x63), k('B', 0x64), k('M', 0x65), s(',', '<', 0x66),
  s('.', '>', 0x67), s('/', '?', 0x68), k('COPY', 0x69),
  // Row 7
  k('ESCAPE', 0x70), k('f1', 0x71), k('f2', 0x72), k('f3', 0x73), k('f5', 0x74), k('f6', 0x75), k('f8', 0x76),
  k('f9', 0x77), s('\\', '|', 0x78), k('RIGHT', 0x79, '→'),
];

const KEYS_BY_NUMBER: ReadonlyMap<number, BbcKey> = new Map(BBC_KEYS.map((key) => [key.key, key]));

/** The key at a matrix position, or undefined for a link or an empty position. */
export function bbcKey(key: number): BbcKey | undefined {
  return KEYS_BY_NUMBER.get(key & 0x7f);
}

/** Is this matrix position a start-up link (row 0, columns 2-9)? */
export function isLinkPosition(key: number): boolean {
  const column = keyColumn(key);
  return keyRow(key) === 0 && column >= FIRST_LINK_COLUMN && column <= LAST_LINK_COLUMN;
}

/** Which bit of `links` (and of &028F) the link at this column is. */
export function linkBit(column: number): number {
  return LAST_LINK_COLUMN - column;
}

/** What can press and release switches: the matrix, as the PC key map sees it. */
export interface KeyboardSwitches {
  press(key: number): void;
  release(key: number): void;
}

/** Where the keyboard's CA2 output goes: the machine wires it to the System VIA. */
export type Ca2Listener = (level: 0 | 1) => void;

export class Keyboard implements KeyboardSwitches, Clocked {
  /** The eight links as the MOS will see them in &028F: bit b is column 9 - b, 1 = open, 0 = closed. */
  links: number;

  /** Bit r of columns[c] = the key at row r, column c is held. Links aren't in here. */
  private readonly columns = new Uint8Array(MATRIX_COLUMNS);
  private readonly onChange: (() => void) | undefined;

  // The scan logic (Stage 35).
  private autoscan = false;
  private counter = 0;
  /** A CPU cycle left over from the last tick: half a microsecond. */
  private phase = 0;
  private ca2Level: 0 | 1 = 0;
  private rises = 0;
  private ca2Listener: Ca2Listener | undefined;

  /** onChange is called after any switch opens or closes (the machine recomputes PA7). */
  constructor(links = DEFAULT_LINKS, onChange?: () => void) {
    this.links = links & 0xff;
    this.onChange = onChange;
  }

  /** Close a key's switch. Positions with no key (links, columns 10-15) are ignored. */
  press(key: number): void {
    this.set(key, true);
  }

  /** Open a key's switch. */
  release(key: number): void {
    this.set(key, false);
  }

  /** Open every key's switch (the links stay as they are). */
  releaseAll(): void {
    if (this.columns.every((rows) => rows === 0)) return;
    this.columns.fill(0);
    this.updateCa2();
    this.onChange?.();
  }

  // ── Scanning (Stage 35) ────────────────────────────────────────────────

  /**
   * Wires CA2: the listener hears the level now, then every change, as it
   * happens. The gate always drives the line, so the VIA's floating-high
   * input is pulled to the keyboard's level at once. Otherwise the first
   * key would be 1 → 1, which isn't a rising edge. One listener; undefined disconnects.
   */
  connectCa2(listener: Ca2Listener | undefined): void {
    this.ca2Listener = listener;
    listener?.(this.ca2Level);
  }

  /** IC32 bit 3: true = the counter counts by itself, false = it follows PA0-PA3. */
  setAutoscan(on: boolean): void {
    this.autoscan = on;
  }

  /** PA0-PA3 as they are now (higher bits ignored). Loads the counter, but only while autoscan is off. */
  selectColumn(pins: number): void {
    if (this.autoscan) return;
    this.counter = pins & COUNTER_MASK;
    this.updateCa2();
  }

  /** The column the counter is on (0-15; 10-15 select nothing). */
  get scanColumn(): number {
    return this.counter;
  }

  /** The level on CA2: 1 while the counter's column has a key down in rows 1-7. */
  get ca2(): 0 | 1 {
    return this.ca2Level;
  }

  /** Rising edges on CA2 since the last resetScan(). For the panel. */
  get ca2Rises(): number {
    return this.rises;
  }

  /** Is autoscan on (IC32 bit 3 = 1)? */
  get scanning(): boolean {
    return this.autoscan;
  }

  /** Power-on: counter at 0, CA2 low, count cleared. The keys stay as they are. */
  resetScan(): void {
    this.counter = 0;
    this.phase = 0;
    this.setCa2(0);
    this.rises = 0;
  }

  /**
   * The 1 MHz counter moves on while autoscan is on, one column per µs, and
   * every change on CA2 is sent as it happens: a 1 µs pulse in the middle of
   * a 4 µs instruction still reaches the VIA. The hot path: no allocation,
   * and at most 4 steps an instruction.
   */
  tick(cpuCycles: number): void {
    if (!this.autoscan) return;
    this.phase += cpuCycles;
    while (this.phase >= CPU_CYCLES_PER_SCAN_STEP) {
      this.phase -= CPU_CYCLES_PER_SCAN_STEP;
      this.counter = (this.counter + 1) & COUNTER_MASK;
      this.updateCa2();
    }
  }

  /** The NAND gate: any of rows 1-7 closed in the counter's column. */
  private updateCa2(): void {
    const rows = this.counter < MATRIX_COLUMNS ? (this.columns[this.counter] ?? 0) : 0;
    this.setCa2((rows & CA2_ROWS) !== 0 ? 1 : 0);
  }

  private setCa2(level: 0 | 1): void {
    if (level === this.ca2Level) return;
    this.ca2Level = level;
    if (level === 1) this.rises++;
    this.ca2Listener?.(level);
  }

  /** Is the switch at this position closed: a held key or a closed link? Reads only bits 0-6. */
  isDown(key: number): boolean {
    const column = keyColumn(key);
    if (column >= MATRIX_COLUMNS) return false;
    return ((this.columnRows(column) >> keyRow(key)) & 1) === 1;
  }

  /** A column's closed switches as a row bit mask (bit 0 = row 0, including its link). */
  columnRows(column: number): number {
    const rows = this.columns[column] ?? 0;
    if (column < FIRST_LINK_COLUMN || column > LAST_LINK_COLUMN) return rows;
    const linkClosed = ((this.links >> linkBit(column)) & 1) === 0;
    return linkClosed ? rows | 0x01 : rows;
  }

  /** The level the keyboard puts on PA7, given the key number on PA0-PA6 and whether autoscan is on. */
  pa7(key: number, autoscan: boolean): 0 | 1 {
    if (autoscan) return 0;
    return this.isDown(key & 0x7f) ? 1 : 0;
  }

  private set(key: number, down: boolean): void {
    if (bbcKey(key) === undefined) return;
    const column = keyColumn(key);
    const bit = 1 << keyRow(key);
    const before = this.columns[column] ?? 0;
    const after = down ? before | bit : before & ~bit & 0xff;
    if (after === before) return;
    this.columns[column] = after;
    if (column === this.counter) this.updateCa2();
    this.onChange?.();
  }
}
