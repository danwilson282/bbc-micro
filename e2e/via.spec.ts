import { test, expect, type Page } from '@playwright/test';

function viaPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'VIA', exact: true });
}

function portRow(page: Page, port: 'a' | 'b', row: string): ReturnType<Page['locator']> {
  return viaPanel(page).locator(`.via-port[data-port="${port}"] tr[data-row="${row}"] td`);
}

// Stage 24's VIA ports example (the default until Stage 25). It uses the User
// VIA; the panel opens on the System VIA since Stage 26.
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=via-ports');
  await viaPanel(page).getByRole('button', { name: 'Show the User VIA' }).click();
});

test('the User VIA after reset: every line an input, reading &FF', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('via-ports');
  const panel = viaPanel(page);
  await expect(panel.getByRole('button', { name: 'Show the User VIA' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.via-registers tbody tr')).toHaveCount(16);
  await expect(panel.locator('tr[data-register="0"] td.value')).toHaveText('&FF');
  await expect(portRow(page, 'b', 'ddr')).toHaveText(['in', 'in', 'in', 'in', 'in', 'in', 'in', 'in', '&00']);
});

test('stepping shows DDRB deciding which ORB bits reach the pins: IRB reads &F5', async ({ page }) => {
  const step = page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < 6; i++) await step.click();
  await expect(portRow(page, 'b', 'ddr')).toHaveText(['in', 'in', 'in', 'in', 'out', 'out', 'out', 'out', '&0F']);
  await expect(portRow(page, 'b', 'or').last()).toHaveText('&A5');
  await expect(portRow(page, 'b', 'pins').last()).toHaveText('&F5');
  await expect(portRow(page, 'b', 'read').last()).toHaveText('&F5');
  await expect(viaPanel(page).locator('tr[data-register="0"] td.value')).toHaveText('&F5');
});

test('pulling an input line low changes what the CPU reads; port B outputs read ORB, port A reads the pin', async ({ page }) => {
  const panel = viaPanel(page);
  await panel.getByRole('button', { name: 'Pull PB4 low' }).click();
  await expect(portRow(page, 'b', 'read').last()).toHaveText('&EF');
  await expect(panel.getByRole('button', { name: 'Let go of PB4' })).toHaveAttribute('aria-pressed', 'true');
  // Run: the program's first part sets PA7-PA4 as outputs driving 0011 (ORA = &3C), then port B counts.
  await page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Run until BRK' }).click();
  await expect(portRow(page, 'a', 'or').last()).toHaveText('&3C');
  await expect(portRow(page, 'a', 'read').last()).toHaveText('&3F');
  await panel.getByRole('button', { name: 'Pull PA5 low' }).click();
  await expect(portRow(page, 'a', 'read').last()).toHaveText('&1F'); // PA5 drives 1 but reads the dragged pin
});

test('the picker switches to the System VIA', async ({ page }) => {
  const panel = viaPanel(page);
  await panel.getByRole('button', { name: 'Show the System VIA' }).click();
  await expect(panel.locator('tr[data-register="2"] td.mono').nth(1)).toHaveText('&FE42');
});
