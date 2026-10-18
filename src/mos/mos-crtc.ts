// MOS 1.20's MODE 7 settings for the 6845, R0-R15, as measured from the real
// ROM at power-on (Stages 37 and 39): its MODE 7 table at &C46E (R7 one more,
// Stage 37 doc), the start address &2800 (&7C00), and the cursor.
//
// The playground has no MOS, and a 6845 nobody has programmed displays
// nothing (R1 = R6 = 0). So the playground writes these once, standing in for
// the MOS, with the cursor off (R10 = &20, as VDU 23,1,0 writes it): nothing
// is typing there.

import { CRTC_ADDRESS, CRTC_DATA } from '../devices/crtc6845';
import type { IoDevice } from '../memory/io-device';

/** R0-R15 after MODE 7 at power-on: cursor at &28C9, under the > prompt's next cell. */
export const MOS_MODE7_CRTC: readonly number[] = [
  0x3f, 0x28, 0x33, 0x24, // R0-R3: 64 characters a line, 40 shown, HSYNC at 51 for 4
  0x1e, 0x02, 0x19, 0x1c, // R4-R7: 31 rows + 2 lines, 25 shown, VSYNC at row 28
  0x93, 0x12, 0x72, 0x13, // R8-R11: interlace sync and video, skews 1/2; rows of 10 (×2); cursor lines 18-19, 32-field blink
  0x28, 0x00, 0x28, 0xc9, // R12-R15: start &2800 (&7C00); cursor &28C9
];

/** R10 = &20: blink mode %01, no cursor (VDU 23,1,0). */
const R10_NO_CURSOR = 0x20;

/** Writes MOS_MODE7_CRTC into a 6845 the way the MOS does, through &FE00/&FE01, with no cursor and the cursor register at the start. */
export function programMode7NoCursor(crtc: IoDevice): void {
  const values = [...MOS_MODE7_CRTC];
  values[10] = R10_NO_CURSOR;
  values[14] = values[12] ?? 0;
  values[15] = values[13] ?? 0;
  values.forEach((value, register) => {
    crtc.write(CRTC_ADDRESS, register);
    crtc.write(CRTC_DATA, value);
  });
}
