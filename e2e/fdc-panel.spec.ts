import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 49: the FDC panel logs every command the DFS sends the 8271. At
// power-on: three Specifies and the mode register. *CAT: select drive 0,
// then poll Read Drive Status (no disc in drive 0, so never ready). Escape: the DFS
// resets the 8271 and sets it up again. In the real-time project, because
// typing needs the machine running.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom', '/roms/dfs.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

/** One PC key held for 60 ms, as a person would press it. */
async function tap(page: Page, key: string, shift = false): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(60);
}

const SKIP = 'roms/os12.rom, roms/basic2.rom or roms/dfs.rom is missing (Acorn copyright, so you supply them)';

test.describe('the FDC panel with DFS 0.98', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await hasRoms(request)), SKIP);
    await page.goto('/?machine=mos');
    await expect(page.locator('.text-row').nth(7)).toHaveText(/^>/);
  });

  test('after power-on it lists the four set-up commands, and the mode register reads &C1 (non-DMA)', async ({ page }) => {
    const panel = page.locator('[data-panel="FDC (8271)"]');
    const bytes = panel.locator('.fdc-log tbody tr:not([hidden]) td:nth-child(2)');
    await expect(bytes).toHaveText(['35 0D 0C 0A C8', '35 10 FF FF 00', '35 18 FF FF 00', '3A 17 C1']);
    await expect(panel.locator('.fdc-registers tr').first()).toContainText('&C1');
    await expect(panel.locator('.fdc-registers tr').first()).toContainText('non-DMA');
  });

  test('*CAT selects drive 0 and polls Read Drive Status; Escape resets the 8271 and BASIC says Escape', async ({ page }) => {
    await page.locator('.screen-frame').click();
    // * is BBC SHIFT + : (PC Shift + '): keys map by place (Stage 34).
    await tap(page, "'", true);
    for (const c of 'CAT') await tap(page, c);
    await tap(page, 'Enter');
    const panel = page.locator('[data-panel="FDC (8271)"]');
    const rows = panel.locator('.fdc-log tbody tr:not([hidden])');
    await expect(rows.nth(5)).toContainText('Write Special Register &23 (drive control output) = &48: SELECT 0, LOAD HEAD');
    await expect(rows.nth(6)).toContainText('Read Drive Status → &02: TRK0'); // drive 0 is empty: no RDY0 (Stage 50)
    await expect(rows.nth(6).locator('.fdc-repeats')).toHaveText(/^×[\d,]+$/);

    await tap(page, 'Escape');
    await expect(page.locator('.text-row').nth(9)).toHaveText(/^Escape/);
    await expect(rows.nth(7)).toContainText('Reset (&FE82 bit 0 = 1)');
    await expect(rows.nth(11)).toContainText('Write Special Register &17 (mode) = &C1');
  });
});
