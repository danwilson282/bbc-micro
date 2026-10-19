import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { buildTestDisc } from '../src/disc/test-disc';

// Stage 50: a disc chosen in the Disc panel goes into drive 0, and *CAT on
// the emulator's screen reads it through the 8271, one NMI per byte. The disc
// is the Stage 48 test disc, built here by our own writer (no files needed).
// Real-time project: typing needs the machine running.

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

async function typeCat(page: Page): Promise<void> {
  await page.locator('.screen-frame').click();
  // * is BBC SHIFT + : (PC Shift + '): keys map by place (Stage 34).
  await tap(page, "'", true);
  for (const c of 'CAT') await tap(page, c);
  await tap(page, 'Enter');
}

const SKIP = 'roms/os12.rom, roms/basic2.rom or roms/dfs.rom is missing (Acorn copyright, so you supply them)';

test.describe('*CAT reads a disc in drive 0', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await hasRoms(request)), SKIP);
    await page.goto('/?machine=mos');
    await expect(page.locator('.text-row').nth(7)).toHaveText(/^>/);
  });

  test('choose the test disc, type *CAT: the real DFS prints its catalogue, from 512 bytes that came by NMI', async ({ page }) => {
    const disc = page.locator('[data-panel="Disc"]');
    await disc.locator('input[type="file"]').setInputFiles({ name: 'stage48.ssd', mimeType: 'application/octet-stream', buffer: Buffer.from(buildTestDisc()) });
    await expect(disc.locator('.disc-in-drive')).toHaveText('Drive 0: stage48.ssd');

    await typeCat(page);
    const rows = page.locator('.text-row');
    await expect(rows.nth(16)).toHaveText(/^>/);
    const screen = (await rows.allTextContents()).slice(7, 17).map((r) => r.trimEnd());
    expect(screen).toEqual([
      '>*CAT',
      'STAGE 48 (00)',
      'Drive 0             Option 3 (EXEC)',
      'Directory :0.$      Library :0.$',
      '',
      '    !BOOT               EMPTY',
      '    HELLO    L          README',
      '',
      '  E.DATA',
      '>',
    ]);

    const fdc = page.locator('[data-panel="FDC (8271)"]');
    await expect(fdc.locator('.fdc-transfer')).toHaveText('512 bytes by NMI · 0 late');
    await expect(fdc.locator('.fdc-log tbody tr:not([hidden])').last()).toContainText('Read Data, track 0 sector 0, 2 × 256 bytes → &00 OK');
  });

  test('after Eject, *CAT waits for a drive that is not ready, as with no disc', async ({ page }) => {
    const disc = page.locator('[data-panel="Disc"]');
    await disc.locator('input[type="file"]').setInputFiles({ name: 'stage48.ssd', mimeType: 'application/octet-stream', buffer: Buffer.from(buildTestDisc()) });
    await disc.getByRole('button', { name: 'Eject' }).click();
    await expect(disc.locator('.disc-in-drive')).toHaveText('Drive 0: empty');

    await typeCat(page);
    const repeats = page.locator('[data-panel="FDC (8271)"] .fdc-log tbody tr:not([hidden])').last().locator('.fdc-repeats');
    await expect(repeats).toHaveText(/^×[\d,]+$/);
    await expect(page.locator('.text-row').nth(8)).toHaveText(/^\s*$/);
  });
});
