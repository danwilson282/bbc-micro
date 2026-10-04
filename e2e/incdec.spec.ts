import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function register(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`tr[data-register="${name}"] td.value`);
}

function flag(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`[data-flag="${name}"]`);
}

async function step(page: Page, times = 1): Promise<void> {
  const button = registersPanel(page).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < times; i++) await button.click();
}

const ON = /\bon\b/;

// Stage 09's increment & decrement example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the Stage 09 example', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('incdec');
  await expect(page.getByRole('region', { name: 'Program' }).locator('tr.current td.source')).toHaveText('start: LDX #&FE');
});

test('INX wraps X from &FF to &00: Z lights, N goes out, C stays off', async ({ page }) => {
  await step(page, 2); // LDX #&FE, INX
  await expect(register(page, 'X')).toHaveText('&FF');
  await expect(flag(page, 'N')).toHaveClass(ON);
  await step(page); // INX
  await expect(register(page, 'X')).toHaveText('&00');
  await expect(flag(page, 'Z')).toHaveClass(ON);
  await expect(flag(page, 'N')).not.toHaveClass(ON);
  await expect(flag(page, 'C')).not.toHaveClass(ON);
  await step(page); // DEX
  await expect(register(page, 'X')).toHaveText('&FF');
  await expect(flag(page, 'N')).toHaveClass(ON);
  await expect(flag(page, 'Z')).not.toHaveClass(ON);
});

test('INC on memory takes 5 cycles and writes twice: the old value, then the new', async ({ page }) => {
  await step(page, 11); // up to the second INC count: &FF → &00
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (5 cycles), 2 writes');
  await expect(page.getByRole('region', { name: 'Memory' }).locator('[data-field="writes"]')).toHaveText(
    'Wrote: &0080 ← &FF, &0080 ← &00',
  );
  await expect(flag(page, 'Z')).toHaveClass(ON);
  await expect(register(page, 'A')).toHaveText('&FE');
});

test('DEC &nnnn,X takes 7 cycles even across a page boundary', async ({ page }) => {
  await step(page, 15);
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (7 cycles), 2 writes');
  await expect(page.getByRole('region', { name: 'Memory' }).locator('[data-field="writes"]')).toHaveText(
    'Wrote: &7C00 ← &49, &7C00 ← &48',
  );
});
