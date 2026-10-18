import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 40: the Video ULA panel decodes the control byte and shows the 16
// palette entries as swatches. Typing MODE 1 and MODE 2 changes them, and
// the screen goes black, because the ULA is no longer in teletext and the
// bitmap renderer is Stage 42. In the real-time project, because typing
// needs the machine running.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

/** One PC key held for 60 ms, as a person would press it. */
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(60);
}

async function typeMode(page: Page, mode: number): Promise<void> {
  await page.locator('.screen-frame').click();
  for (const key of ['M', 'O', 'D', 'E', ' ', String(mode), 'Enter']) await tap(page, key);
}

/** Is every pixel of the screen canvas black? */
async function screenIsBlack(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#screen');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (data === undefined) return false;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 0) return false;
    return true;
  });
}

const SKIP = 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)';

test('after boot the Video ULA panel shows MODE 7\'s control byte: teletext, palette unused', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), SKIP);
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  const panel = page.locator('[data-panel="Video ULA"]');
  // Bit 0 flips every 25 fields, so &4A or &4B.
  await expect(panel.locator('.ula-summary')).toHaveText(/^&4[AB]: MODE 7\. Teletext/);
  await expect(panel.locator('.ula-swatch')).toHaveCount(16);
});

test('typing MODE 1 changes the swatches to black, red, yellow, white in four entries each, and the screen goes black', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), SKIP);
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await typeMode(page, 1);
  const panel = page.locator('[data-panel="Video ULA"]');
  await expect(panel.locator('.ula-summary')).toHaveText(/^&D[89]: MODE 1\. 4 pixels a byte, 2 bits each: 4 colours, 320 pixels across$/);
  const colours = await panel.locator('.ula-swatch').evaluateAll((items) => items.map((item) => (item instanceof HTMLElement ? item.dataset.colour : '')).join(''));
  expect(colours).toBe('0011001133773377');
  await expect(page.locator('.text-row').nth(0)).toHaveText(/^ +$/);
  expect(await screenIsBlack(page)).toBe(true);
});

test('MODE 2 shows 16 colours with 8-F flashing; back in MODE 7 the teletext screen returns', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), SKIP);
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await typeMode(page, 2);
  const panel = page.locator('[data-panel="Video ULA"]');
  await expect(panel.locator('.ula-summary')).toHaveText(/^&F[45]: MODE 2\. .*16 colours, 160 pixels across$/);
  await expect(panel.locator('.ula-swatch.flashing')).toHaveCount(8);
  // Entry 9 is red/cyan: within two flash periods (2 s) it shows both.
  const entry9 = panel.locator('.ula-swatch[data-entry="9"]');
  await expect(entry9).toHaveAttribute('data-colour', '1', { timeout: 3000 });
  await expect(entry9).toHaveAttribute('data-colour', '6', { timeout: 3000 });
  await typeMode(page, 7);
  await expect(panel.locator('.ula-summary')).toHaveText(/^&4[AB]: MODE 7/);
  await expect(page.locator('.text-row').nth(0)).toHaveText(/^>/);
});
