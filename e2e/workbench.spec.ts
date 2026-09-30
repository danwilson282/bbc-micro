import { test, expect, type Page } from '@playwright/test';

function memoryPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Memory' });
}

function byte(page: Page, address: string): ReturnType<Page['locator']> {
  return memoryPanel(page).locator(`td.byte[data-address="${address}"]`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the memory panel shows page &7C00 with the preloaded message', async ({ page }) => {
  const panel = memoryPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(16);
  await expect(panel.locator('tbody th').first()).toHaveText('7C00');
  await expect(panel.locator('tbody th').last()).toHaveText('7CF0');
  await expect(byte(page, '7C00')).toHaveText('48');
  await expect(panel.locator('td.ascii').first()).toHaveText('HELLO, BBC MICRO');
});

test('clicking a byte and typing a value pokes it and highlights the change', async ({ page }) => {
  await byte(page, '7C05').click();
  const input = page.getByRole('textbox', { name: 'Edit byte at &7C05' });
  await input.fill('&21');
  await input.press('Enter');
  await expect(byte(page, '7C05')).toHaveText('21');
  await expect(byte(page, '7C05')).toHaveClass(/changed/);
  await expect(byte(page, '7C04')).not.toHaveClass(/changed/);
  await expect(memoryPanel(page).locator('td.ascii').first()).toHaveText('HELLO! BBC MICRO'); // &2C "," became &21 "!"
});

test('an invalid byte is rejected and memory is unchanged', async ({ page }) => {
  await byte(page, '7C00').click();
  const input = page.getByRole('textbox', { name: 'Edit byte at &7C00' });
  await input.fill('123');
  await input.press('Enter');
  await expect(page.getByRole('status')).toContainText("isn't a byte");
  await input.press('Escape');
  await expect(byte(page, '7C00')).toHaveText('48');
});

test('Go jumps to the page containing an address, and pages wrap at &FFFF', async ({ page }) => {
  const panel = memoryPanel(page);
  await panel.getByRole('textbox', { name: 'Go to address' }).fill('&FF1D');
  await panel.getByRole('button', { name: 'Go to address' }).click();
  await expect(panel.locator('tbody th').first()).toHaveText('FF10');
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.locator('tbody th').first()).toHaveText('0010');
});

test('a poke from the console updates the panel', async ({ page }) => {
  await page.evaluate(() => {
    // The console handle set up in src/main.ts; not part of the page's types.
    const wb = (window as unknown as { workbench: { poke(a: number, v: number): void } }).workbench;
    wb.poke(0x7c10, 0x41);
  });
  await expect(byte(page, '7C10')).toHaveText('41');
  await expect(byte(page, '7C10')).toHaveClass(/changed/);
});
