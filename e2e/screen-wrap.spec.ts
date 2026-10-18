import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 43: hardware wrap-around and MODE 3's gap lines, typed on the PC
// keyboard. A MODE 1 program draws a triangle with MOVE/DRAW/GCOL, then
// prints from the bottom row until the screen has scrolled 10 rows, so the
// 6845 counts past MA &0FFF every field. The text read back off the canvas
// must match the MOS's font: without the board's wrap those rows would be
// zero page. In the real-time project: typing needs the machine running.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

async function glyphs(request: APIRequestContext, text: string): Promise<number[][]> {
  const rom = await (await request.get('/roms/os12.rom')).body();
  return Array.from(text, (c) => Array.from(rom.subarray((c.charCodeAt(0) - 0x20) * 8, (c.charCodeAt(0) - 0x20) * 8 + 8)));
}

/** Keys map by place (Stage 34): " is BBC SHIFT + 2 (PC Shift + 2), = is BBC SHIFT + - (PC Shift + -). */
const PC_KEYS: ReadonlyMap<string, readonly [key: string, shift: boolean]> = new Map([
  [' ', ['Space', false]], ['\r', ['Enter', false]], [',', [',', false]], [';', [';', false]], ['"', ['2', true]], ['=', ['-', true]],
]);

async function type(page: Page, text: string): Promise<void> {
  for (const char of text) {
    const [key, shift] = PC_KEYS.get(char) ?? [char, false];
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    await page.waitForTimeout(60);
    await page.keyboard.up(key);
    if (shift) await page.keyboard.up('Shift');
    await page.waitForTimeout(60);
  }
}

/** The letters at text row `row` (rows `lines` scanlines apart) read off the canvas, 8 bytes each. */
async function lettersOnCanvas(page: Page, lettersAcross: number, lines: number, row: number, count: number): Promise<number[][]> {
  return page.evaluate(
    ({ lettersAcross, lines, row, count }) => {
      const canvas = document.querySelector('#screen');
      if (!(canvas instanceof HTMLCanvasElement)) return [];
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (data === undefined) return [];
      const dots = canvas.width / lettersAcross / 8;
      return Array.from({ length: count }, (_, column) =>
        Array.from({ length: 8 }, (_, line) => {
          let byte = 0;
          for (let px = 0; px < 8; px++) {
            const i = ((row * lines + line) * canvas.width + (column * 8 + px) * dots) * 4;
            byte = (byte << 1) | ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0 ? 1 : 0);
          }
          return byte;
        }),
      );
    },
    { lettersAcross, lines, row, count },
  );
}

/** How many dots of canvas line y aren't black? */
async function litDots(page: Page, y: number): Promise<number> {
  return page.evaluate((y) => {
    const canvas = document.querySelector('#screen');
    if (!(canvas instanceof HTMLCanvasElement)) return 0;
    const data = canvas.getContext('2d')?.getImageData(0, y, canvas.width, 1).data;
    if (data === undefined) return 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0) n++;
    return n;
  }, y);
}

test.describe('Stage 43: wrap-around and gap lines', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
    await page.goto('/?machine=mos');
    await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
    await page.locator('.screen-frame').click();
  });

  test('MODE 1: a MOVE/DRAW/GCOL triangle, then 10 scrolls: the wrapped bottom rows read SCROLL 9, SCROLL 10, >', async ({ page, request }, testInfo) => {
    // About 150 keys at 120 ms each: 18 s of typing alone, more under the full suite's load.
    test.setTimeout(60_000);
    await type(
      page,
      '10 MODE 1\r20 GCOL 0,1\r30 MOVE 100,100\r40 DRAW 1180,100\r50 DRAW 640,900\r60 DRAW 100,100\r' +
        '70 VDU 31,0,31\r80 FOR I=1 TO 10\r90 PRINT "SCROLL ";I\r100 NEXT\rRUN\r',
    );
    const expected = [await glyphs(request, 'SCROLL 9'), await glyphs(request, 'SCROLL 10'), await glyphs(request, '>')];
    await expect
      .poll(async () => [await lettersOnCanvas(page, 40, 8, 29, 8), await lettersOnCanvas(page, 40, 8, 30, 9), await lettersOnCanvas(page, 40, 8, 31, 1)], { timeout: 10_000 })
      .toEqual(expected);
    // The triangle's base, x 100-1180 at y = 100 (MODE 1 pixels 25-295: 271 × 2 dots, on line 255 - 100 / 4 = 230), is 10 rows (80 lines) up.
    expect(await litDots(page, 150)).toBe(542);
    await testInfo.attach('mode-1-graphics-scrolled.png', { body: await page.locator('.screen-frame').screenshot(), contentType: 'image/png' });
  });

  test('MODE 3: rows are 10 lines, and lines 8 and 9 of each are black', async ({ page, request }, testInfo) => {
    await type(page, 'MODE 3\rREM BBC\r');
    const expected = await glyphs(request, '>REM BBC');
    await expect.poll(() => lettersOnCanvas(page, 80, 10, 0, expected.length), { timeout: 5000 }).toEqual(expected);
    // Row 0's > has lit pixels on line 0; its RA 8 and 9 (lines 8, 9) are black.
    const lit = await Promise.all([0, 8, 9, 10].map((y) => litDots(page, y)));
    expect(lit.map((n) => n > 0)).toEqual([true, false, false, true]);
    await testInfo.attach('mode-3.png', { body: await page.locator('.screen-frame').screenshot(), contentType: 'image/png' });
  });
});
