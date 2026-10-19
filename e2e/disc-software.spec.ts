import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 51: software from disc, in the browser. The demo disc (made by our
// own writer, assembler and tokeniser) boots with the SHIFT-BREAK button; a
// program typed in is SAVEd to a blank disc, shows in the catalogue, can be
// downloaded, and CHAINs back. Real-time project: the machine must run.

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

/** Types capitals, digits, spaces and " (BBC SHIFT + 2, which is where PC Shift + 2 lands), then Return. */
async function typeLine(page: Page, text: string): Promise<void> {
  for (const c of text) {
    if (c === '"') await tap(page, '2', true);
    else await tap(page, c);
  }
  await tap(page, 'Enter');
}

/** The colour in the middle of each of DEMO's six bands, as "r,g,b". Band C% is at graphics y = C%*112+50 of 1024, counted from the bottom. */
async function sample(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#screen');
    if (!(canvas instanceof HTMLCanvasElement)) return [];
    const ctx = canvas.getContext('2d');
    if (ctx === null) return [];
    return [1, 2, 3, 4, 5, 6].map((band) => {
      const f = 1 - (band * 112 + 50) / 1024;
      const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * f), 1, 1).data;
      return `${String(d[0])},${String(d[1])},${String(d[2])}`;
    });
  });
}

const SKIP = 'roms/os12.rom, roms/basic2.rom or roms/dfs.rom is missing (Acorn copyright, so you supply them)';

test.describe('software from disc', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await hasRoms(request)), SKIP);
    await page.goto('/?machine=mos');
    await expect(page.locator('.text-row').nth(7)).toHaveText(/^>/);
  });

  test('the demo disc boots with SHIFT-BREAK: !BOOT CHAINs DEMO, which draws MODE 2 bands and keeps turning their colours', async ({ page }, info) => {
    const disc = page.locator('[data-panel="Disc"]');
    await disc.getByRole('button', { name: 'Insert the demo disc' }).click();
    await expect(disc.locator('[data-drive="0"] .disc-in-drive')).toHaveText('Drive 0: demo.ssd');
    await expect(disc.locator('.disc-cat')).toContainText('STAGE 51 (00)');

    await disc.getByRole('button', { name: 'SHIFT-BREAK: boot the disc in drive 0' }).click();
    // Six bands in six different colours, none of them black.
    await expect.poll(async () => new Set(await sample(page)).size, { timeout: 15_000 }).toBe(6);
    expect(await sample(page)).not.toContain('0,0,0');
    const first = await sample(page);
    await expect.poll(() => sample(page), { timeout: 5_000 }).not.toEqual(first);
    await info.attach('demo disc booted', { body: await page.locator('.screen-frame').screenshot(), contentType: 'image/png' });
  });

  test('SAVE to a blank disc: the catalogue shows it, Download saves the changed disc, and CHAIN brings it back', async ({ page }) => {
    const disc = page.locator('[data-panel="Disc"]');
    await disc.getByRole('button', { name: 'Insert a blank disc' }).click();
    const drive0 = disc.locator('[data-drive="0"]');
    await expect(drive0.locator('.disc-in-drive')).toHaveText('Drive 0: blank.ssd');
    await expect(drive0.getByRole('button', { name: 'Download the disc in drive 0' })).toBeDisabled();

    await page.locator('.screen-frame').click();
    await typeLine(page, '10 PRINT "SAVED"');
    await typeLine(page, 'SAVE "PROG"');
    await expect(disc.locator('.disc-cat')).toContainText('PROG');
    await expect(disc.locator('.disc-cat')).toContainText('BLANK (01)');
    await expect(drive0.locator('.disc-changed')).toHaveText(/^changed: [\d,]+ bytes written$/);

    const downloading = page.waitForEvent('download');
    await drive0.getByRole('button', { name: 'Download the disc in drive 0' }).click();
    const download = await downloading;
    await page.locator('.screen-frame').click(); // the button took the keyboard focus
    expect(download.suggestedFilename()).toBe('blank.ssd');
    const path = await download.path();
    const { statSync } = await import('node:fs');
    expect(statSync(path).size).toBe(204_800);

    await typeLine(page, 'NEW');
    await typeLine(page, 'CHAIN "PROG"');
    const rows = page.locator('.text-row');
    await expect.poll(async () => (await rows.allTextContents()).map((r) => r.trimEnd())).toContain('SAVED');
  });

  test('with Write protect ticked, SAVE gets "Disk read only" and the disc is unchanged', async ({ page }) => {
    const disc = page.locator('[data-panel="Disc"]');
    await disc.getByRole('button', { name: 'Insert a blank disc' }).click();
    await disc.getByRole('checkbox', { name: 'Write protect drive 0' }).check();
    await page.locator('.screen-frame').click();
    await typeLine(page, '10 PRINT');
    await typeLine(page, 'SAVE "PROG"');
    const rows = page.locator('.text-row');
    await expect.poll(async () => (await rows.allTextContents()).map((r) => r.trimEnd())).toContain('Disk read only');
    await expect(disc.locator('[data-drive="0"] .disc-changed')).toHaveText('');
  });
});
