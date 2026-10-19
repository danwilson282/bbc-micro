import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 36: the whole keyboard, from the PC. A multi-line BASIC program
// typed key by key, RUN, and its output screenshotted; the lock LEDs; and
// BREAK on F12 keeping the program for OLD. In the real-time project: the
// machine must be running while a key is held (Stage 35).

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

const HOLD_MS = 60;

/**
 * The PC key (Playwright's name) for each character, and whether PC Shift is
 * held. Keys map by place (Stage 34), so a BBC symbol is typed where the
 * BBC has it: = is BBC SHIFT + - (PC Shift + -), * is BBC SHIFT + : (PC Shift + ').
 */
const PC_KEYS: ReadonlyMap<string, readonly [key: string, shift: boolean]> = new Map([
  [' ', ['Space', false]], ['\r', ['Enter', false]], [',', [',', false]],
  ['=', ['-', true]], ['*', ["'", true]], ['"', ['2', true]],
]);

/** One PC key held for HOLD_MS, as a person would press it. */
async function tap(page: Page, key: string, shift = false): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up(key);
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(HOLD_MS);
}

/** Types capitals, digits and the symbols in PC_KEYS on the PC keyboard. */
async function type(page: Page, text: string): Promise<void> {
  for (const char of text) {
    const [key, shift] = PC_KEYS.get(char) ?? [char, false];
    await tap(page, key, shift);
  }
}

test.describe('BASIC from the PC keyboard', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
    await page.goto('/?machine=mos&roms=mos,basic');
    await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
    await page.locator('.screen-frame').click();
  });

  test('a multi-line program, typed and RUN: a table of squares', async ({ page }) => {
    await type(page, '10 FOR I=1 TO 5\r20 PRINT I,I*I\r30 NEXT\rRUN\r');
    const rows = page.locator('.text-row');
    await expect(rows.nth(5)).toHaveText(/^>10 FOR I=1 TO 5\s*$/);
    await expect(rows.nth(8)).toHaveText(/^>RUN\s*$/);
    await expect(rows.nth(9)).toHaveText(/^\s+1\s+1\s*$/);
    await expect(rows.nth(13)).toHaveText(/^\s+5\s+25\s*$/);
    await expect(rows.nth(14)).toHaveText(/^>/);
    const shot = await page.locator('.screen-frame').screenshot({ path: test.info().outputPath('squares.png') });
    await test.info().attach('squares', { body: shot, contentType: 'image/png' });
  });

  test('the CAPS LOCK LED goes out and comes back with CAPS LOCK; SHIFT LOCK (clicked) lights its own', async ({ page }) => {
    const caps = page.locator('.lock-led[data-led="CAPS LOCK"]');
    const shift = page.locator('.lock-led[data-led="SHIFT LOCK"]');
    await expect(caps).toHaveClass(/\blit\b/);
    await expect(shift).not.toHaveClass(/\blit\b/);
    await tap(page, 'CapsLock');
    await expect(caps).not.toHaveClass(/\blit\b/);
    await tap(page, 'CapsLock');
    await expect(caps).toHaveClass(/\blit\b/);
    // SHIFT LOCK has no PC key: click its keycap down, and up again.
    const shiftLockKey = page.locator('.bbc-key[data-key="50"]');
    await shiftLockKey.click();
    await page.waitForTimeout(HOLD_MS);
    await shiftLockKey.click();
    await expect(shift).toHaveClass(/\blit\b/);
    await expect(caps).not.toHaveClass(/\blit\b/);
    await expect(page.locator('.bbc-key[data-key="50"] .key-led')).toHaveClass(/\blit\b/);
  });

  test('BREAK on F12 is a soft BREAK: the banner loses its "32K", and OLD brings the program back', async ({ page }) => {
    await type(page, '10 PRINT "HI"\r');
    await tap(page, 'F12');
    const rows = page.locator('.text-row');
    await expect(rows.nth(1)).toHaveText(/^BBC Computer\s*$/);
    await expect(rows.nth(5)).toHaveText(/^>\s*$/);
    await type(page, 'OLD\rLIST\r');
    await expect(rows.nth(7)).toHaveText(/^\s+10 PRINT "HI"\s*$/);
  });
});
