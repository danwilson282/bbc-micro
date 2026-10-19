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
  await page.goto('/?machine=mos&roms=mos,basic');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  const panel = page.locator('[data-panel="CRTC (6845)"]');
  await expect(panel.locator('.crtc-summary')).toHaveText('40×25 characters, 50.00 Hz, interlaced (sync and video)');
  await expect(panel.locator('tr[data-register="8"] td.hex')).toHaveText('&93');
  await expect(panel.locator('tr[data-register="7"] td.meaning')).toHaveText('VSYNC at row 28: line 280');
  await expect(panel.locator('dd[data-field="Scanline"]')).toHaveText('64 characters ÷ 1 MHz = 64 µs (15,625 Hz)');
});

test('typing MODE 0 changes the panel to 80×32 at a 2 MHz clock, still 64 µs a line', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos&roms=mos,basic');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await page.locator('.screen-frame').click();
  for (const key of ['M', 'O', 'D', 'E', ' ', '0', 'Enter']) await tap(page, key);
  const panel = page.locator('[data-panel="CRTC (6845)"]');
  await expect(panel.locator('.crtc-summary')).toHaveText('80×32 characters, 50.00 Hz, interlaced');
  await expect(panel.locator('dd[data-field="Scanline"]')).toHaveText('128 characters ÷ 2 MHz = 64 µs (15,625 Hz)');
  await expect(panel.locator('tr[data-register="0"] td.hex')).toHaveText('&7F');
});

// Stage 38: the frame rate comes from the CRTC's counters, measured between VSYNCs.

test('the status line and the CRTC panel show the field rate measured from VSYNC: 50.00 Hz, 40,000 cycles', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos&roms=mos,basic');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await expect(page.locator('.run-status')).toContainText('VSYNC 50.00 Hz');
  const panel = page.locator('[data-panel="CRTC (6845)"]');
  await expect(panel.locator('dd[data-field="Measured"]')).toHaveText('VSYNC every 40,000 cycles = 20.000 ms: 50.00 Hz');
  await expect(panel.locator('dd[data-field="Fields"]')).toHaveText(/^(odd|even) field; [\d,]+ VSYNCs since power-on$/);
});

test('turning MODE 7\'s interlace off in R8 from the console makes 19-line rows: 591-line fields, 26.44 Hz (why *TV leaves MODE 7 alone)', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos&roms=mos,basic');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await page.evaluate(() => {
    // The console handle (main.ts): R8 := &00. Without sync and video, R9 = &12 counts 19 lines a row.
    const handle: unknown = Reflect.get(window, 'workbench');
    const crtc: unknown = typeof handle === 'object' && handle !== null ? Reflect.get(handle, 'crtc') : undefined;
    if (typeof crtc !== 'object' || crtc === null) throw new Error('no workbench.crtc');
    const write: unknown = Reflect.get(crtc, 'write');
    if (typeof write !== 'function') throw new Error('no crtc.write');
    write.call(crtc, 0, 8);
    write.call(crtc, 1, 0x00);
  });
  const panel = page.locator('[data-panel="CRTC (6845)"]');
  // 31 rows × 19 lines + 2 = 591 lines × 64 µs: measured by the counters, and the geometry agrees.
  await expect(panel.locator('dd[data-field="Measured"]')).toHaveText('VSYNC every 75,648 cycles = 37.824 ms: 26.44 Hz');
  await expect(panel.locator('.crtc-summary')).toHaveText('40×25 characters, 26.44 Hz, non-interlaced');
  await expect(page.locator('.run-status')).toContainText('VSYNC 26.44 Hz');
});
