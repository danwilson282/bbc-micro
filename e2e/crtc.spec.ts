import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 37: the CRTC panel shows the 6845's registers as the MOS set them,
// and the geometry worked out from them. It's live: typing MODE 0 changes
// it. In the real-time project, because typing needs the machine running.

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

test('after boot the CRTC panel shows MODE 7: 40×25, 50 Hz, R8 = &93, VSYNC on line 280', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  const panel = page.locator('[data-panel="CRTC (6845)"]');
  await expect(panel.locator('.crtc-summary')).toHaveText('40×25 characters, 50.00 Hz, interlaced (sync and video)');
  await expect(panel.locator('tr[data-register="8"] td.hex')).toHaveText('&93');
  await expect(panel.locator('tr[data-register="7"] td.meaning')).toHaveText('VSYNC at row 28: line 280');
  await expect(panel.locator('dd[data-field="Scanline"]')).toHaveText('64 characters ÷ 1 MHz = 64 µs (15,625 Hz)');
});

test('typing MODE 0 changes the panel to 80×32 at a 2 MHz clock, still 64 µs a line', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await page.locator('.screen-frame').click();
  for (const key of ['M', 'O', 'D', 'E', ' ', '0', 'Enter']) await tap(page, key);
  const panel = page.locator('[data-panel="CRTC (6845)"]');
  await expect(panel.locator('.crtc-summary')).toHaveText('80×32 characters, 50.00 Hz, interlaced');
  await expect(panel.locator('dd[data-field="Scanline"]')).toHaveText('128 characters ÷ 2 MHz = 64 µs (15,625 Hz)');
  await expect(panel.locator('tr[data-register="0"] td.hex')).toHaveText('&7F');
});
