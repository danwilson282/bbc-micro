import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function register(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`tr[data-register="${name}"] td.value`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('after reset, PC comes from the vector at &FFFC and S is &FD', async ({ page }) => {
  await expect(register(page, 'PC')).toHaveText('&0400');
  await expect(register(page, 'S')).toHaveText('&FD');
  await expect(register(page, 'P')).toHaveText('&24');
  await expect(registersPanel(page).locator('[data-flag="I"]')).toHaveClass(/\bon\b/);
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toHaveText('Cycles: 7 cycles = 3.5 µs at 2 MHz');
  await expect(registersPanel(page).locator('[data-field="next"]')).toHaveText('Next: &0400: &A9 LDA');
});

test('Step runs LDA #&00: PC advances by 2 and 2 cycles pass', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Step one instruction' }).click();
  await expect(register(page, 'PC')).toHaveText('&0402');
  await expect(registersPanel(page).locator('tr[data-register="PC"]')).toHaveClass(/changed/);
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toContainText('9 cycles');
  const memory = page.getByRole('region', { name: 'Memory' });
  await expect(memory.locator('td.byte.pc')).toHaveAttribute('data-address', '0402');
});

test('stepping off the end of the program page stops at the unimplemented BRK at &0500', async ({ page }) => {
  // 11 loads (33 cycles) then 231 NOPs from &0419 to &04FF (462 cycles), after the 7-cycle reset.
  const step16 = registersPanel(page).getByRole('button', { name: 'Step 16 instructions' });
  for (let i = 0; i < 17; i++) await step16.click();
  await expect(register(page, 'PC')).toHaveText('&0500');
  await expect(registersPanel(page).getByRole('status')).toContainText('unimplemented opcode &00 at &0500');
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toContainText('502 cycles');
});

test('Reset reloads PC from the vector and drops S by 3', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Step one instruction' }).click();
  await registersPanel(page).getByRole('button', { name: 'Reset the CPU' }).click();
  await expect(register(page, 'PC')).toHaveText('&0400');
  await expect(register(page, 'S')).toHaveText('&FA');
});
