import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 44: the Sound panel shows the SN76489's registers. After boot every
// channel is off; typing SOUND 1,-15,53,20 sets chip channel 2 (BASIC
// channel 1) to tone &1D5 at full volume, and the note ends a second later.
// In the real-time project, because typing needs the machine running.

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

/** Keys map by position, so "," and "-" are the PC's own comma and minus keys. */
async function typeLine(page: Page, text: string): Promise<void> {
  await page.locator('.screen-frame').click();
  for (const char of text) await tap(page, char);
  await tap(page, 'Enter');
}

const SKIP = 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)';

test('after boot the Sound panel shows all four channels off, labelled with the BASIC channel that drives each', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), SKIP);
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  const panel = page.locator('[data-panel="Sound"]');
  await expect(panel.locator('.sound-summary')).toHaveText('Silent: all four attenuations are &F.');
  const basic = await panel.locator('.sound-channels tbody tr td:first-of-type').allTextContents();
  expect(basic).toEqual(['3', '2', '1', '0']);
});

test('SOUND 1,-15,53,20 sets chip channel 2 to tone &1D5 (266.5 Hz) at attenuation &0, then it goes silent', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), SKIP);
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await typeLine(page, 'SOUND 1,-15,53,20');
  const panel = page.locator('[data-panel="Sound"]');
  const row = panel.locator('tr[data-channel="2"]');
  await expect(row).toContainText('&1D5 (469)');
  await expect(row).toContainText('266.5 Hz');
  await expect(panel.locator('.sound-bytes li:not([hidden])').last()).toHaveText('&1D  data for R4 (channel 2 tone), high 6 bits = &1D');
  // 20 twentieths of a second later the MOS writes &DF.
  await expect(panel.locator('.sound-summary')).toHaveText('Silent: all four attenuations are &F.', { timeout: 5000 });
});
