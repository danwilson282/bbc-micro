import { test, expect, type Page } from '@playwright/test';

function viaPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'VIA', exact: true });
}

function timerCell(page: Page, timer: 'T1' | 'T2', column: string): ReturnType<Page['locator']> {
  return viaPanel(page).locator(`.via-timers tr[data-timer="${timer}"] td.${column}`);
}

async function step(page: Page, times: number): Promise<void> {
  const button = page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < times; i++) await button.click();
}

/** A byte of memory, through the console handle (peek: no side effects). */
async function peek(page: Page, address: number): Promise<string> {
  return page.evaluate((a) => {
    // The console handle main.ts puts on window; typed here because the page isn't.
    const handle = (window as unknown as { workbench: { peek(address: number): string } }).workbench;
    return handle.peek(a);
  }, address);
}

// Stage 25's VIA timers example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the timers example, with a Timers table for T1 and T2', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('via-timers');
  await expect(viaPanel(page).locator('.via-timers tbody tr')).toHaveCount(2);
  await expect(timerCell(page, 'T1', 'mode')).toHaveText('one-shot');
});

test('a write to T1C-L lands in the latch; writing T2C-H loads T2 and it counts down as you step', async ({ page }) => {
  await step(page, 2); // LDA #&34, STA t1cl
  await expect(timerCell(page, 'T1', 'latch')).toHaveText('&0034');
  await step(page, 5); // ... LDA #&FF, STA t2cl, STA t2ch
  await expect(timerCell(page, 'T2', 'armed')).toHaveText('yes');
  await expect(timerCell(page, 'T2', 'counter')).toHaveText('&FFFE = 65,534');
  await step(page, 1); // LDX #50: 2 CPU cycles = 1 count
  await expect(timerCell(page, 'T2', 'counter')).toHaveText('&FFFD = 65,533');
});

test('Run: T1 free-runs at 50 ms, drives PB7, and the program counts 100 timeouts at &80', async ({ page }) => {
  await page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Run until BRK' }).click();
  await expect(timerCell(page, 'T1', 'mode')).toContainText('free-running; PB7 =');
  await expect(timerCell(page, 'T1', 'latch')).toHaveText('&C34E');
  await expect(viaPanel(page).locator('.via-port[data-port="b"] tr[data-row="ddr"] td').first()).toHaveText('T1');
  // While it runs the counter moves on between frames.
  const first = await timerCell(page, 'T1', 'counter').textContent();
  await expect(timerCell(page, 'T1', 'counter')).not.toHaveText(first ?? '');
  // 100 x 50 ms = 5 seconds of emulated time.
  await expect(page.getByRole('region', { name: 'Registers' })).toContainText('Stopped at BRK', { timeout: 15_000 });
  expect(await peek(page, 0x80)).toBe('&64');
  expect(await peek(page, 0x82)).toBe('&7E');
  // T2 was never re-armed: it ran out once, 65 ms in, and its flag is still set.
  await expect(timerCell(page, 'T2', 'ifr-flag')).toHaveText('bit 5 = 1');
});
