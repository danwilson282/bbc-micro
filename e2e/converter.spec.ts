import { test, expect, type Page } from '@playwright/test';

function converter(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Number converter' });
}

function field(page: Page, name: string): ReturnType<Page['getByRole']> {
  return converter(page).getByRole('textbox', { name, exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on &41: 65, %0100 0001 and the letter A', async ({ page }) => {
  await expect(field(page, 'Hex')).toHaveValue('&41');
  await expect(field(page, 'Decimal')).toHaveValue('65');
  await expect(field(page, 'Binary')).toHaveValue('%0100 0001');
  await expect(field(page, 'ASCII')).toHaveValue('A');
});

test('typing a negative decimal shows its two\'s-complement byte', async ({ page }) => {
  await field(page, 'Decimal').fill('-56');
  await expect(field(page, 'Hex')).toHaveValue('&C8');
  await expect(field(page, 'Binary')).toHaveValue('%1100 1000');
  await expect(field(page, 'ASCII')).toHaveAttribute('placeholder', 'not ASCII');
  await expect(converter(page).locator('.converter-notes')).toContainText('As a signed byte: -56');
});

test('typing a character in ASCII converts it, and a control code is named', async ({ page }) => {
  await field(page, 'ASCII').fill('z');
  await expect(field(page, 'Hex')).toHaveValue('&7A');
  await field(page, 'Hex').fill('0d');
  await expect(field(page, 'ASCII')).toHaveValue('');
  await expect(field(page, 'ASCII')).toHaveAttribute('placeholder', 'CR');
});

test('a 16-bit hex value lists its bytes in 6502 memory order', async ({ page }) => {
  await field(page, 'Hex').fill('&7C00');
  await expect(field(page, 'Decimal')).toHaveValue('31744');
  await expect(converter(page).locator('.converter-notes')).toContainText('low byte first (6502 order): 00 7C');
});

test('bad input marks the field and says why, leaving the others alone', async ({ page }) => {
  await field(page, 'Binary').fill('%102');
  await expect(converter(page).getByRole('status')).toHaveText('Binary is digits 0 and 1, e.g. %0100 0001');
  await expect(field(page, 'Binary')).toHaveAttribute('aria-invalid', 'true');
  await expect(field(page, 'Hex')).toHaveValue('&41');
});
