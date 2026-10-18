import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 42: text in the bitmap MODEs. For MODE 0, 1, 2, 4 and 5 we type
// the MODE and a REM line, then read the letters back off the canvas and
// compare them with the MOS's own font in roms/os12.rom (&C000: characters
// &20-&7F, 8 bytes each). A screenshot of each is attached to the report.
// In the real-time project, because typing needs the machine running.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

/** The MOS font's 8 bytes for each character of text, from os12.rom (the ROM's &C000 is offset 0). */
async function glyphs(request: APIRequestContext, text: string): Promise<number[][]> {
  const rom = await (await request.get('/roms/os12.rom')).body();
  return Array.from(text, (c) => Array.from(rom.subarray((c.charCodeAt(0) - 0x20) * 8, (c.charCodeAt(0) - 0x20) * 8 + 8)));
}

/** One PC key held for 60 ms, as a person would press it. */
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(60);
}

async function typeLine(page: Page, text: string): Promise<void> {
  for (const c of text) await tap(page, c === ' ' ? ' ' : c);
  await tap(page, 'Enter');
}

/**
 * The letters at text row `row`, columns 0 to count - 1, read off the canvas
 * as 8 bytes each (bit 7 = the leftmost pixel, set where it isn't black).
 * A letter is 8 pixels; each is 640 ÷ letters across ÷ 8 dots wide.
 */
async function lettersOnCanvas(page: Page, lettersAcross: number, row: number, count: number): Promise<number[][]> {
  return page.evaluate(
    ({ lettersAcross, row, count }) => {
      const canvas = document.querySelector('#screen');
      if (!(canvas instanceof HTMLCanvasElement)) return [];
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (data === undefined) return [];
      const dots = canvas.width / lettersAcross / 8;
      return Array.from({ length: count }, (_, column) =>
        Array.from({ length: 8 }, (_, line) => {
          let byte = 0;
          for (let px = 0; px < 8; px++) {
            const i = ((row * 8 + line) * canvas.width + (column * 8 + px) * dots) * 4;
            byte = (byte << 1) | ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0 ? 1 : 0);
          }
          return byte;
        }),
      );
    },
    { lettersAcross, row, count },
  );
}

const SKIP = 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)';

for (const [mode, lettersAcross] of [
  [0, 80],
  [1, 40],
  [2, 20],
  [4, 40],
  [5, 20],
] as const) {
  test(`MODE ${String(mode)}: the canvas is 640 × 256 and shows ">REM BBC" in the MOS's own font`, async ({ page, request }, testInfo) => {
    test.skip(!(await hasRoms(request)), SKIP);
    await page.goto('/?machine=mos');
    await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
    await page.locator('.screen-frame').click();
    await typeLine(page, `MODE ${String(mode)}`);
    await typeLine(page, 'REM BBC');
    const expected = await glyphs(request, '>REM BBC');
    await expect.poll(() => lettersOnCanvas(page, lettersAcross, 0, expected.length), { timeout: 5000 }).toEqual(expected);
    expect(await page.evaluate(() => {
      const canvas = document.querySelector('#screen');
      return canvas instanceof HTMLCanvasElement ? `${String(canvas.width)}x${String(canvas.height)}` : 'none';
    })).toBe('640x256');
    await testInfo.attach(`mode-${String(mode)}.png`, { body: await page.locator('.screen-frame').screenshot(), contentType: 'image/png' });
  });
}
