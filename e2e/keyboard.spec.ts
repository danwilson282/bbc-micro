import { test, expect } from '@playwright/test';

// Stage 34: the key matrix and the PC key map. The Keyboard panel lights the
// BBC switch a PC key closes, in the desk view and the matrix view. Runs in
// the playground, so it needs no ROMs.

test.describe('Keyboard panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('section[data-panel="Keyboard"]')).toBeVisible();
  });

  test('keys only go to the BBC while the screen has focus', async ({ page }) => {
    const status = page.locator('.keyboard-status');
    await expect(status).toContainText('Click the screen to type.');
    await page.keyboard.down('a');
    await expect(status).toContainText('No keys down.');
    await page.keyboard.up('a');
    await page.locator('.screen-frame').click();
    await expect(status).toContainText('Typing goes to the BBC.');
  });

  test('PC A lights BBC A (&41) in both views, and letting go clears it', async ({ page }) => {
    await page.locator('.screen-frame').click();
    await page.keyboard.down('a');
    await expect(page.locator('.bbc-key[data-key="41"]')).toHaveClass(/down/);
    await expect(page.locator('.key-matrix td[data-key="41"]')).toHaveClass(/down/);
    await expect(page.locator('.keyboard-status')).toContainText('Down: A &41');
    await page.keyboard.up('a');
    await expect(page.locator('.bbc-key.down')).toHaveCount(0);
  });

  test("PC Shift + ' closes BBC SHIFT and : (by place, so the BBC would print *)", async ({ page }) => {
    await page.locator('.screen-frame').click();
    await page.keyboard.down('Shift');
    await page.keyboard.down("'");
    await expect(page.locator('.keyboard-status')).toContainText('Down: SHIFT &00, : &48');
    await page.keyboard.up("'");
    await page.keyboard.up('Shift');
    await expect(page.locator('.keyboard-status')).toContainText('No keys down.');
  });

  test('Tab is the BBC TAB key while typing, not a focus change', async ({ page }) => {
    await page.locator('.screen-frame').click();
    await page.keyboard.down('Tab');
    await expect(page.locator('.bbc-key[data-key="60"]')).toHaveClass(/down/);
    await expect(page.locator('.screen-frame')).toBeFocused();
    await page.keyboard.up('Tab');
  });

  test('clicking SHIFT LOCK holds it down until clicked again, and keeps the screen focused', async ({ page }) => {
    await page.locator('.screen-frame').click();
    const shiftLock = page.locator('.bbc-key[data-key="50"]');
    await shiftLock.click();
    await expect(shiftLock).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.screen-frame')).toBeFocused();
    await shiftLock.click();
    await expect(shiftLock).toHaveAttribute('aria-pressed', 'false');
  });

  test('losing focus lets go of held PC keys, so none get stuck', async ({ page }) => {
    await page.locator('.screen-frame').click();
    await page.keyboard.down('a');
    await expect(page.locator('.keyboard-status')).toContainText('A &41');
    await page.locator('h1').click();
    await expect(page.locator('.keyboard-status')).toContainText('No keys down.');
    await page.keyboard.up('a');
  });

  test('BREAK is a keycap but not a matrix key (Stage 36): a click holds the 6502 in reset, a second click lets go', async ({ page }) => {
    const brk = page.locator('.bbc-key.not-in-matrix');
    await expect(brk).toHaveText('BREAK');
    await brk.click();
    await expect(brk).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.keyboard-status')).toContainText('Down: BREAK (the 6502 is held in reset)');
    await brk.click();
    await expect(brk).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.keyboard-status')).toContainText('No keys down.');
  });
});
