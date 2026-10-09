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

// Stage 14's fill example (the default until Stage 15).
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=fill');
});

test('opens on the Stage 14 fill example', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('fill');
  await expect(page.getByRole('region', { name: 'Program' }).locator('tr.current td.source')).toHaveText('start: LDA #&41');
});

test('BNE back to fill is taken (3 cycles) while Y has not wrapped', async ({ page }) => {
  await step(page, 11); // 8 set-up instructions, STA (ptr),Y, INY, then the first BNE fill
  await expect(register(page, 'PC')).toHaveText('&0410');
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (3 cycles)');
  await expect(flag(page, 'Z')).not.toHaveClass(ON);
});

test('Run stops at the BRK with the screen full of "Z", and the cycle counter tells the whole story', async ({ page }) => {
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  await memory.getByRole('textbox', { name: 'Go to address' }).fill('&7C00');
  await memory.getByRole('button', { name: 'Go to address' }).click();

  await registersPanel(page).getByRole('button', { name: 'Run until BRK' }).click();
  // While it runs, the button is Stop and the counter climbs.
  await expect(registersPanel(page).getByRole('button', { name: 'Stop running' })).toBeVisible();
  await expect(registersPanel(page).getByRole('status')).toContainText('Running…');

  // About 4.4 s of BBC time at roughly real speed.
  const status = registersPanel(page).getByRole('status');
  await expect(status).toHaveText(
    'Stopped at BRK (&0430) after 3,501,762 instructions, 8,841,075 cycles = 4.42 s at 2 MHz',
    { timeout: 20_000 },
  );
  await expect(register(page, 'PC')).toHaveText('&0430');
  await expect(memory.locator('td.byte[data-address="7C00"]')).toHaveText('5A');
  await expect(memory.locator('td.byte[data-address="7CFF"]')).toHaveText('5A');
  await expect(registersPanel(page).getByRole('button', { name: 'Run until BRK' })).toBeVisible();
});

test('Stop halts a Run part-way, and Step works again', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Run until BRK' }).click();
  await registersPanel(page).getByRole('button', { name: 'Stop running' }).click();
  await expect(registersPanel(page).getByRole('status')).toContainText('Stopped by you at &');
  await expect(registersPanel(page).getByRole('button', { name: 'Step one instruction' })).toBeEnabled();
});
