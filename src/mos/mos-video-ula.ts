// MOS 1.20's Video ULA control byte for each MODE: its table at &C3F7, read
// by the MODE code at &CBA3 and written through OSBYTE &9A (&E9FF). Stage 40
// measured these from the ROM. MODE 3 shares MODE 0's byte and MODE 6
// shares MODE 4's: the ULA can't tell them apart, only the 6845 can.
//
// The playground has no MOS, so it writes MODE 7's byte itself, the way
// mos-crtc.ts stands in for the MOS's CRTC writes. The workbench uses the
// table to say which MODE a control byte belongs to.

/** Where the table is in MOS 1.20. */
export const MOS_ULA_CONTROL_TABLE = 0xc3f7;

/** MODE 7: teletext on, 1 MHz, cursor segment 2. The MOS writes it at power-on and the playground copies it. */
export const MOS_MODE7_ULA_CONTROL = 0x4b;

/** The control byte for MODE 0-7, as the MOS writes it (flash bit 0, except MODE 7). */
export const MOS_ULA_CONTROL: readonly number[] = [0x9c, 0xd8, 0xf4, 0x9c, 0x88, 0xc4, 0x88, MOS_MODE7_ULA_CONTROL];

/** The MODEs whose control byte this is, ignoring the flash bit (0), which the MOS flips every 25 fields. */
export function mosModesFor(control: number): number[] {
  const steady = control & 0xfe;
  return MOS_ULA_CONTROL.flatMap((c, mode) => ((c & 0xfe) === steady ? [mode] : []));
}
