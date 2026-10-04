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

// Stage 11's decimal mode example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the Stage 11 example', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('decimal');
  await expect(page.getByRole('region', { name: 'Program' }).locator('tr.current td.source')).toHaveText('start: SED');
});

test('SED lights D, and then &09 + &01 = &10', async ({ page }) => {
  await expect(flag(page, 'D')).not.toHaveClass(ON);
  await step(page);
  await expect(flag(page, 'D')).toHaveClass(ON);
  await step(page, 2);
  await expect(register(page, 'A')).toHaveText('&10');
});

test('&80 + &80 = &60 in decimal, but Z lights', async ({ page }) => {
  await step(page, 11);
  await expect(register(page, 'A')).toHaveText('&60');
  await expect(flag(page, 'Z')).toHaveClass(ON);
  await expect(flag(page, 'C')).toHaveClass(ON);
});

test('the score borrows down to 0999, then &98 + &01 + 1 = &00 with Z dark and N lit', async ({ page }) => {
  await step(page, 17); // up to STA score+1
  await expect(page.getByRole('region', { name: 'Memory' }).locator('[data-field="writes"]')).toHaveText('Wrote: &0081 ← &09');
  await step(page, 2); // LDA #&98, ADC #&01
  await expect(register(page, 'A')).toHaveText('&00');
  await expect(flag(page, 'Z')).not.toHaveClass(ON);
  await expect(flag(page, 'N')).toHaveClass(ON);
});

test('after CLD, D goes dark and &10 − &01 = &0F', async ({ page }) => {
  await step(page, 20);
  await expect(flag(page, 'D')).not.toHaveClass(ON);
  await step(page, 2);
  await expect(register(page, 'A')).toHaveText('&0F');
});
