import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function program(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Program' });
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

// Since Stage 08 the loads program comes from the assembler's examples,
// behind ?program=loads.
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=loads');
});

test('the Program panel lists the loads and marks &0400 as next', async ({ page }) => {
  await expect(program(page).locator('tbody tr')).toHaveCount(11);
  await expect(program(page).locator('tr.current')).toHaveAttribute('data-address', '0400');
  await expect(program(page).locator('tr.current td.source')).toHaveText('LDA #&00');
  await expect(program(page).locator('tr[data-address="040D"] td.bytes')).toHaveText('B9 08 7B');
});

test('LDA #&00 sets Z; LDA #&80 then sets N and clears Z', async ({ page }) => {
  await step(page);
  await expect(register(page, 'A')).toHaveText('&00');
  await expect(flag(page, 'Z')).toHaveClass(/\bon\b/);
  await expect(flag(page, 'N')).not.toHaveClass(/\bon\b/);
  await step(page);
  await expect(register(page, 'A')).toHaveText('&80');
  await expect(flag(page, 'N')).toHaveClass(/\bon\b/);
  await expect(flag(page, 'Z')).not.toHaveClass(/\bon\b/);
  await expect(program(page).locator('tr.current')).toHaveAttribute('data-address', '0404');
});

test('running all eleven loads leaves A="O", X=&00, Y="E" after 40 cycles', async ({ page }) => {
  await step(page, 11);
  await expect(register(page, 'A')).toHaveText('&4F');
  await expect(register(page, 'X')).toHaveText('&00');
  await expect(register(page, 'Y')).toHaveText('&45');
  await expect(register(page, 'PC')).toHaveText('&0419');
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toHaveText('Cycles: 40 cycles = 20 µs at 2 MHz');
  await expect(program(page).locator('tr.current')).toHaveCount(0);
});

test('the page-crossing LDA &7B08,Y takes 5 cycles', async ({ page }) => {
  await step(page, 6);
  await registersPanel(page).getByRole('button', { name: 'Step one instruction' }).click();
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (5 cycles)');
  await expect(register(page, 'A')).toHaveText('&48');
});

test('poking the operand of LDA #&00 changes what it loads, and the listing says "edited"', async ({ page }) => {
  const memory = page.getByRole('region', { name: 'Memory' });
  await memory.locator('td.byte[data-address="0401"]').click();
  const input = memory.locator('input.byte-edit');
  await input.fill('FF');
  await input.press('Enter');
  await expect(program(page).locator('tr[data-address="0400"]')).toHaveClass(/modified/);
  await expect(program(page).locator('tr[data-address="0400"] td.comment')).toContainText('(edited)');
  await step(page);
  await expect(register(page, 'A')).toHaveText('&FF');
  await expect(flag(page, 'N')).toHaveClass(/\bon\b/);
});
