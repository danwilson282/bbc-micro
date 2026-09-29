import { test, expect } from '@playwright/test';

test('serves the emulator page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('BBC Micro');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('BBC Micro Model B');
  await expect(page.locator('#screen')).toBeVisible();
});
