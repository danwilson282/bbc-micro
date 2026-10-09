import { test, expect, type Page } from '@playwright/test';

function mapPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Memory map' });
}

// Stage 21's memory-map example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows the seven regions of the Model B map, with PC in RAM, and an empty I/O log', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('memory-map');
  const panel = mapPanel(page);
  await expect(panel.locator('tr.region-row')).toHaveCount(7);
  await expect(panel.locator('tr.region-row.pc td.name')).toHaveText('RAM ← PC');
  await expect(panel.locator('[data-field="log-note"]')).toHaveText('No I/O yet: Run or Step a program that touches &FC00-&FEFF.');
});

test('Run logs each I/O access with its device and register, and counts them per slot', async ({ page }) => {
  await page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Run until BRK' }).click();
  const panel = mapPanel(page);
  await expect(panel.locator('[data-field="log-note"]')).toHaveText('7 accesses, oldest first.');
  await expect(panel.locator('.map-log tbody td.text')).toHaveText([
    'System VIA reg 14 (IER)',
    'System VIA reg 14 (IER), mirror of &FE4E',
    'System VIA reg 4 (T1C-L)',
    'JIM (1 MHz bus: nothing connected)',
    'ROMSEL (paged ROM select)',
    'CRTC reg 0 (address register)',
    'CRTC reg 1 (register data)',
  ]);
  const via = panel.locator('tr[data-slot="systemVia"] td.count');
  await expect(via).toHaveText(['1', '2']);
  // The results: RAM kept &48, ROM lost it, and the floating reads at &82-&84.
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  await memory.getByRole('textbox', { name: 'Go to address' }).fill('&0080');
  await memory.getByRole('button', { name: 'Go to address' }).click();
  for (const [address, value] of [['0080', '48'], ['0081', '00'], ['0082', 'FE'], ['0083', 'FD'], ['0084', '80']]) {
    await expect(memory.locator(`td.byte[data-address="${address}"]`)).toHaveText(value);
  }
});

test('Clear empties the log; Go on SHEILA opens page &FE00 in the Memory panel', async ({ page }) => {
  await page.getByRole('region', { name: 'Registers' }).getByRole('button', { name: 'Run until BRK' }).click();
  const panel = mapPanel(page);
  await panel.getByRole('button', { name: 'Clear the I/O log' }).click();
  await expect(panel.locator('.map-log tbody tr')).toHaveCount(0);
  await expect(panel.locator('tr[data-slot="systemVia"] td.count')).toHaveText(['0', '0']);
  await panel.getByRole('button', { name: 'Show &FE00-&FEFF in the Memory panel' }).click();
  await expect(page.getByRole('region', { name: 'Memory', exact: true }).locator('tbody th').first()).toHaveText('FE00');
});
