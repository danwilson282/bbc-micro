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

// Stage 13's shifts example (the default until Stage 14).
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=shifts');
});

test('opens on the Stage 13 example', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('shifts');
  await expect(page.getByRole('region', { name: 'Program' }).locator('tr.current td.source')).toHaveText('start: LDA #23');
});

test('ASL A slides every bit one place left: 23 becomes 46', async ({ page }) => {
  await step(page, 2); // LDA #23, STA num
  await expect(binary(page, 'A')).toHaveText('%0001 0111');
  await step(page); // ASL A
  await expect(register(page, 'A')).toHaveText('&2E');
  await expect(binary(page, 'A')).toHaveText('%0010 1110');
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (2 cycles)');
});

test('three ASLs and one ADC multiply 23 by 10', async ({ page }) => {
  await step(page, 7); // up to ADC times2
  await expect(register(page, 'A')).toHaveText('&E6'); // 230
  await expect(flag(page, 'C')).not.toHaveClass(ON);
});

test('LSR halves, and the remainder lands in C', async ({ page }) => {
  await step(page, 9); // first LSR A: 230 → 115
  await expect(register(page, 'A')).toHaveText('&73');
  await expect(flag(page, 'C')).not.toHaveClass(ON);
  await step(page); // second LSR A: 115 → 57, remainder 1
  await expect(register(page, 'A')).toHaveText('&39');
  await expect(flag(page, 'C')).toHaveClass(ON);
});

test('ASL on memory takes 5 cycles and writes twice, like INC', async ({ page }) => {
  await step(page, 11); // ASL num
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (5 cycles), 2 writes');
  await expect(page.getByRole('region', { name: 'Memory' }).locator('[data-field="writes"]')).toHaveText(
    'Wrote: &0080 ← &17, &0080 ← &2E',
  );
});

test('ROR and ROL walk one bit through C and back into A', async ({ page }) => {
  await step(page, 19); // LDA #&01, LSR A: the bit is in C
  await expect(register(page, 'A')).toHaveText('&00');
  await expect(flag(page, 'C')).toHaveClass(ON);
  await step(page); // ROR A: C comes in at bit 7
  await expect(binary(page, 'A')).toHaveText('%1000 0000');
  await expect(flag(page, 'C')).not.toHaveClass(ON);
  await expect(flag(page, 'N')).toHaveClass(ON);
  await step(page, 2); // ROL A, ROL A: out to C, then in at bit 0
  await expect(binary(page, 'A')).toHaveText('%0000 0001');
  await expect(flag(page, 'C')).not.toHaveClass(ON);
});
