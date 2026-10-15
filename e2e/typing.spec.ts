import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 35: the keyboard interrupts (CA2), the MOS scans, and BASIC sees
// what you type. Keys are held the way fingers hold them (tens of ms), in
// the real-time project: the machine must be running while a key is down.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

/** One PC key held for holdMs, as a person would press it. `shift` holds PC Shift around it. */
async function tap(page: Page, key: string, shift = false, holdMs = 60): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(holdMs);
}

test('typing PRINT 2+2 and RETURN on the PC keyboard makes BASIC print 4', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  const rows = page.locator('.text-row');
  await expect(rows.nth(5)).toHaveText(/^>/);
  await page.locator('.screen-frame').click();
  for (const key of ['P', 'R', 'I', 'N', 'T', ' ', '2']) await tap(page, key);
  await tap(page, ';', true); // by place: PC Shift + ; is BBC SHIFT + ; = +
  await tap(page, '2');
  await tap(page, 'Enter');
  await expect(rows.nth(5)).toHaveText(/^>PRINT 2\+2\s*$/);
  await expect(rows.nth(6)).toHaveText(/^\s+4\s*$/);
  await expect(rows.nth(7)).toHaveText(/^>/);
});

test('the Keyboard panel shows the scan: CA2 interrupt on while idle, and CA2 rises counted after a key', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  const scan = page.locator('.keyboard-scan');
  await expect(scan).toContainText('Autoscan on · CA2 interrupt on: waiting for a key · CA2 rises: 0');
  await page.locator('.screen-frame').click();
  await tap(page, 'A');
  await expect(scan).not.toContainText('CA2 rises: 0');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>A/);
});
