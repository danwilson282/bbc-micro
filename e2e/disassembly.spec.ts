import { test, expect, type Page } from '@playwright/test';

function disassembly(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Disassembly' });
}

async function step(page: Page, times: number): Promise<void> {
  const button = page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < times; i++) await button.click();
}

// Stage 18's trace example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the trace example, decoding forwards from PC = &0400 with labels', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('trace');
  const panel = disassembly(page);
  await expect(panel.locator('[data-field="next-heading"]')).toHaveText('Coming up: disassembled from memory, following PC (&0400)');
  const current = panel.locator('.disasm-next tr.current');
  await expect(current).toHaveAttribute('data-address', '0400');
  await expect(current.locator('td.text')).toHaveText('LDX #&FF');
  await expect(panel.locator('.disasm-next tr[data-address="0403"] td.text')).toHaveText('JSR one');
  await expect(panel.getByText('Nothing yet: the trace starts at reset. Press Step.')).toBeVisible();
});

test('follows PC into "one", where the &2C turns LDA #2 into a BIT', async ({ page }) => {
  await step(page, 3);
  const panel = disassembly(page);
  await expect(panel.locator('.disasm-next tr.current td.text')).toHaveText('LDA #&01');
  await expect(panel.locator('.disasm-next tr[data-address="0419"] td.text')).toHaveText('BIT &02A9');
  await expect(panel.locator('.disasm-ran tbody tr')).toHaveCount(3);
  await expect(panel.locator('.disasm-ran tbody tr').last().locator('td.text')).toHaveText('JSR one');
});

test('the trace keeps each version of the self-modified STA, struck through once memory changes', async ({ page }) => {
  await step(page, 19);
  const stores = disassembly(page).locator('.disasm-ran tbody tr.changed-since');
  await expect(stores).toHaveCount(2);
  await expect(stores.nth(0).locator('td.bytes')).toHaveText('8D 28 7C');
  await expect(stores.nth(1).locator('td.text')).toHaveText('STA &7C29');
});

test('Go decodes from any address: mid-instruction &0418 is nonsense, then back in step at "two"', async ({ page }) => {
  const panel = disassembly(page);
  await panel.getByRole('textbox', { name: 'Disassemble from address' }).fill('0418');
  await panel.getByRole('button', { name: 'Disassemble from address' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Follow PC' })).not.toBeChecked();
  const rows = panel.locator('.disasm-next tbody tr');
  await expect(rows.nth(0).locator('td.text')).toHaveText('ORA (&2C,X)');
  await expect(rows.nth(1).locator('td.label')).toHaveText('two');
  await expect(rows.nth(1).locator('td.text')).toHaveText('LDA #&02');
  await panel.getByRole('checkbox', { name: 'Follow PC' }).check();
  await expect(panel.locator('.disasm-next tr.current')).toHaveAttribute('data-address', '0400');
});
