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

// Stage 10's binary arithmetic example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the Stage 10 example', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('arithmetic');
  await expect(page.getByRole('region', { name: 'Program' }).locator('tr.current td.source')).toHaveText('start: LDA #&E8');
});

test('the low-byte ADC carries out, and the high-byte ADC takes the carry in', async ({ page }) => {
  await step(page, 2); // LDA #&E8, ADC #&2C
  await expect(register(page, 'A')).toHaveText('&14');
  await expect(flag(page, 'C')).toHaveClass(ON);
  await step(page, 3); // STA sum, LDA #&03, ADC #&01
  await expect(register(page, 'A')).toHaveText('&05');
  await expect(flag(page, 'C')).not.toHaveClass(ON);
});

test('&50 + &50 overflows: V lights but C does not', async ({ page }) => {
  await step(page, 8);
  await expect(register(page, 'A')).toHaveText('&A0');
  await expect(flag(page, 'V')).toHaveClass(ON);
  await expect(flag(page, 'N')).toHaveClass(ON);
  await expect(flag(page, 'C')).not.toHaveClass(ON);
});

test('the 16-bit subtraction borrows, then stores &012C low byte first', async ({ page }) => {
  await step(page, 12); // up to SBC #&E8
  await expect(register(page, 'A')).toHaveText('&2C');
  await expect(flag(page, 'C')).not.toHaveClass(ON);
  await step(page, 4); // STA diff, LDA sum+1, SBC #&03, STA diff+1
  await expect(flag(page, 'C')).toHaveClass(ON);
  await expect(page.getByRole('region', { name: 'Memory' }).locator('[data-field="writes"]')).toHaveText('Wrote: &0083 ← &01');
});
