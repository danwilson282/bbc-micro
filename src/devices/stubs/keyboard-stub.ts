// STUB, replaced by the real keyboard matrix in Stages 34-36.
//
// The keyboard is 10 columns × 8 rows. With autoscan off (latch bit 3 = 0)
// the CPU puts a key number on the System VIA's PA0-PA6:
//
//   PA0-PA3  column 0-9
//   PA4-PA6  row 0-7
//
// and the keyboard answers on PA7: 1 if that key is down (the MOS's keyTest
// at &F02A). This stub has no key down, ever.
//
// Except the links. Row 0, columns 2-9 aren't keys: they're eight start-up
// option links on the keyboard PCB. A closed link joins its row and column,
// just as a held key would. The MOS reads them at reset into &028F, inverted
// (&DA11-&DA3D), so bit b of &028F is the link on column 9 - b, 1 = open.
// `links` uses that same layout, so it's the value the MOS will store.
//
// With autoscan on, the keyboard's own counter picks the column and a key
// down raises CA2 (Stage 35). With nothing down there's nothing to raise.
// We drive PA7 low then (unconfirmed: the MOS doesn't read PA7 in autoscan).

/** All links open: &028F = &FF, MODE 7. A sensible default, not a fact about every Model B (see the Stage 28 doc). */
export const DEFAULT_LINKS = 0xff;

/** Row 0, columns 2-9: the links. */
const FIRST_LINK_COLUMN = 2;
const LAST_LINK_COLUMN = 9;

export class KeyboardStub {
  /** The eight links as the MOS will see them in &028F: bit b is column 9 - b, 1 = open, 0 = closed. */
  links: number;

  constructor(links = DEFAULT_LINKS) {
    this.links = links & 0xff;
  }

  /** Is key (PA0-PA6: row << 4 | column) "down"? Only a closed link can be. */
  isDown(key: number): boolean {
    const row = (key >> 4) & 0x07;
    const column = key & 0x0f;
    if (row !== 0 || column < FIRST_LINK_COLUMN || column > LAST_LINK_COLUMN) return false;
    return ((this.links >> (LAST_LINK_COLUMN - column)) & 1) === 0;
  }

  /** The level the keyboard puts on PA7, given the key number on PA0-PA6 and whether autoscan is on. */
  pa7(key: number, autoscan: boolean): 0 | 1 {
    if (autoscan) return 0;
    return this.isDown(key & 0x7f) ? 1 : 0;
  }
}
