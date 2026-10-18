import { test, expect, type Locator, type Page } from '@playwright/test';

// Stage 41: the Byte explorer decodes one screen byte as MODE 0, 1 and 2
// would draw it. The playground is enough: no ROMs needed.

function explorer(page: Page): Locator {
  return page.locator('[data-panel="Byte explorer"]');
}

function pixels(page: Page, mode: 0 | 1 | 2): Locator {
  return explorer(page).locator(`.explorer-mode[data-mode="${String(mode)}"] .explorer-pixel`);
}

async function colours(page: Page, mode: 0 | 1 | 2): Promise<(string | null)[]> {
  return pixels(page, mode).evaluateAll((els) => els.map((e) => e.getAttribute('data-colour')));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on &A5: MODE 1 is yellow red yellow red, MODE 2 is 12 then 3', async ({ page }) => {
  await expect(explorer(page).locator('[data-field="summary"]')).toHaveText('&A5 = %1010 0101 = 165');
  await expect(pixels(page, 1)).toHaveText(['2', '1', '2', '1']);
  expect(await colours(page, 1)).toEqual(['3', '1', '3', '1']);
  await expect(pixels(page, 2)).toHaveText(['12', '3']);
  await expect(pixels(page, 0)).toHaveText(['1', '0', '1', '0', '0', '1', '0', '1']);
});

test('the owner strip shows the interleave: MODE 1 bits belong to pixels 0 1 2 3 0 1 2 3', async ({ page }) => {
  await expect(explorer(page).locator('.explorer-mode[data-mode="1"] .explorer-owners span')).toHaveText(['p0', 'p1', 'p2', 'p3', 'p0', 'p1', 'p2', 'p3']);
  await expect(explorer(page).locator('.explorer-mode[data-mode="2"] .explorer-owners span')).toHaveText(['p0', 'p1', 'p0', 'p1', 'p0', 'p1', 'p0', 'p1']);
});

test('typing &0F gives colour 1 in every MODE 1 pixel, and &3F is white in MODE 2', async ({ page }) => {
  const input = explorer(page).getByRole('textbox', { name: 'Byte' });
  await input.fill('&0F');
  await expect(pixels(page, 1)).toHaveText(['1', '1', '1', '1']);
  await input.fill('3F');
  await expect(pixels(page, 2)).toHaveText(['7', '7']);
  expect(await colours(page, 2)).toEqual(['7', '7']);
});

test('flipping bit 7 and clicking a pixel both rewrite the byte', async ({ page }) => {
  const input = explorer(page).getByRole('textbox', { name: 'Byte' });
  await explorer(page).locator('.explorer-bits button[data-bit="7"]').click();
  await expect(input).toHaveValue('&25');
  // MODE 1 pixel 0 is now b7 b3 = %00; one click makes it 1 (b3 set): &2D.
  await pixels(page, 1).first().click();
  await expect(input).toHaveValue('&2D');
  await expect(pixels(page, 1).first()).toHaveText('1');
});

test('the live row decodes with the playground ULA\'s control byte, MODE 7\'s &4B', async ({ page }) => {
  await expect(explorer(page).locator('.explorer-live .explorer-heading')).toHaveText(/^The ULA now \(&4B, MODE 7\): 8 pixels a byte/);
  await expect(explorer(page).locator('.explorer-live .explorer-pixel')).toHaveCount(8);
});
