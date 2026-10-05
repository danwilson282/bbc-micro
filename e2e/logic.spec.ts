import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function register(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`tr[data-register="${name}"] td.value`);
}

function binary(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`tr[data-register="${name}"] td.binary`);
}

function flag(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`[data-flag="${name}"]`);
}

async function step(page: Page, times = 1): Promise<void> {
  const button = registersPanel(page).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < times; i++) await button.click();
}

const ON = /\bon\b/;

// Stage 12's logic example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the Stage 12 example', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('logic');
  await expect(page.getByRole('region', { name: 'Program' }).locator('tr.current td.source')).toHaveText('start: LDA #&B5');
});

test('A is shown in binary, and AND #&0F marks the three bits it cleared', async ({ page }) => {
  await step(page);
  await expect(binary(page, 'A')).toHaveText('%1011 0101');
  await step(page);
  await expect(register(page, 'A')).toHaveText('&05');
  await expect(binary(page, 'A')).toHaveText('%0000 0101');
  const changed = binary(page, 'A').locator('.bit.changed');
  await expect(changed).toHaveCount(3);
  await expect(changed.nth(0)).toHaveAttribute('data-bit', '7');
});

test('EOR #&20 on "H" flips only bit 5', async ({ page }) => {
  await step(page, 8);
  await expect(register(page, 'A')).toHaveText('&68');
  const changed = binary(page, 'A').locator('.bit.changed');
  await expect(changed).toHaveCount(1);
  await expect(changed).toHaveAttribute('data-bit', '5');
});

test('BIT sets N and V from memory and leaves A alone', async ({ page }) => {
  await step(page, 19); // up to BIT flags, with A=&01 and &80 holding &C1
  await expect(register(page, 'A')).toHaveText('&01');
  await expect(flag(page, 'N')).toHaveClass(ON);
  await expect(flag(page, 'V')).toHaveClass(ON);
  await expect(flag(page, 'Z')).not.toHaveClass(ON);
  await step(page, 4); // LDA #&02, BIT flags, LDA #&FF, BIT screen+6
  await expect(register(page, 'A')).toHaveText('&FF');
  await expect(flag(page, 'N')).not.toHaveClass(ON);
  await expect(flag(page, 'V')).not.toHaveClass(ON);
});
