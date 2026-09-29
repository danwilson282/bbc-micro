import { test, expect } from '@playwright/test';

test('serves the emulator page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('BBC Micro');
  await expect(page.locator('#screen')).toBeVisible();
});
