import { test, expect, type Page } from '@playwright/test';

function viaPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'VIA', exact: true });
}

function sourceRow(page: Page, name: string): ReturnType<Page['locator']> {
  return viaPanel(page).locator(`.via-interrupts tr[data-source="${name}"]`);
}

/** A byte of memory, through the console handle (peek: no side effects). */
async function peek(page: Page, address: number): Promise<number> {
  const text = await page.evaluate((a) => {
    // The console handle main.ts puts on window; typed here because the page isn't.
    const handle = (window as unknown as { workbench: { peek(address: number): string } }).workbench;
    return handle.peek(a);
  }, address);
  return parseInt(text.slice(1), 16);
}

function registers(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

// Stage 26's VIA interrupts example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the interrupts example, showing the System VIA with an Interrupts table and control lines', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('via-interrupts');
  const panel = viaPanel(page);
  await expect(panel.getByRole('button', { name: 'Show the System VIA' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.via-interrupts tbody tr')).toHaveCount(7);
  await expect(sourceRow(page, 'CA1').locator('td.wired')).toHaveText('vertical sync (6845 CRTC)');
  await expect(panel.locator('.via-control-lines tbody tr')).toHaveCount(4);
});

test('Run: Timer 1 interrupts 100 times a second, and the handler ticks &80 and &81 while the main loop counts at &84', async ({ page }) => {
  await registers(page).getByRole('button', { name: 'Run until BRK' }).click();
  await expect(viaPanel(page).locator('.via-interrupts caption')).toContainText('IER &C2');
  await expect(sourceRow(page, 'T1').locator('td.ier-bit')).toHaveText('1');
  // Over a second of emulated time, the seconds byte goes up.
  await expect.poll(() => peek(page, 0x81), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  const cs = await peek(page, 0x80);
  await expect.poll(() => peek(page, 0x80)).not.toBe(cs);
  expect(await peek(page, 0x84)).toBeGreaterThan(0);
  await registers(page).getByRole('button', { name: 'Stop running' }).click();
});

test('pulling CA1 low is one falling edge: one interrupt, counted at &82', async ({ page }) => {
  await registers(page).getByRole('button', { name: 'Run until BRK' }).click();
  await expect.poll(() => peek(page, 0x80)).toBeGreaterThan(0);
  const panel = viaPanel(page);
  await panel.getByRole('button', { name: 'Pull CA1 low' }).click();
  await expect.poll(() => peek(page, 0x82)).toBe(1);
  await panel.getByRole('button', { name: 'Let go of CA1' }).click();
  await panel.getByRole('button', { name: 'Pull CA1 low' }).click();
  await expect.poll(() => peek(page, 0x82)).toBe(2);
  await registers(page).getByRole('button', { name: 'Stop running' }).click();
});

test('the Interrupts panel names the System VIA when it holds the IRQ line', async ({ page }) => {
  // Step to just after STA ier (13 instructions in, before CLI): CA1 is enabled, I is still set.
  const step = registers(page).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < 13; i++) await step.click();
  await viaPanel(page).getByRole('button', { name: 'Pull CA1 low' }).click();
  await expect(sourceRow(page, 'CA1')).toHaveClass(/firing/);
  await expect(page.getByRole('region', { name: 'Interrupts' })).toContainText('held by the System VIA');
});
