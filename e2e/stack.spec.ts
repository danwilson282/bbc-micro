import { test, expect, type Page } from '@playwright/test';

function stackPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Stack' });
}

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function stackRow(page: Page, address: string): ReturnType<Page['locator']> {
  return stackPanel(page).locator(`tr[data-address="${address}"]`);
}

async function step(page: Page, times = 1): Promise<void> {
  const button = registersPanel(page).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < times; i++) await button.click();
}

// Stage 15's stack example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the Stage 15 stack example, with the Stack panel showing S after reset', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('stack');
  // Reset's three dummy pushes took S from &00 to &FD.
  await expect(stackPanel(page).locator('[data-field="summary"]')).toHaveText('S = &FD · 2 bytes in use · next push → &01FD · next pull ← &01FE');
});

test('three pushes fill &01FF down to &01FD, and S marks the next free slot', async ({ page }) => {
  await step(page, 2); // LDX #&FF, TXS
  await expect(stackPanel(page).locator('[data-field="summary"]')).toHaveText('S = &FF · empty · next push → &01FF');
  await step(page, 6); // three LDA/PHA pairs
  await expect(stackPanel(page).locator('[data-field="summary"]')).toHaveText('S = &FC · 3 bytes in use · next push → &01FC · next pull ← &01FD');
  await expect(stackRow(page, '01FF').locator('td.hex')).toHaveText('11');
  await expect(stackRow(page, '01FE').locator('td.hex')).toHaveText('22');
  await expect(stackRow(page, '01FD').locator('td.hex')).toHaveText('33');
  await expect(stackRow(page, '01FD').locator('td.hex')).toHaveClass(/written/);
  await expect(stackRow(page, '01FD').locator('td.note')).toHaveText('next pull');
  await expect(stackRow(page, '01FC')).toHaveClass('next-push');
  await expect(stackRow(page, '01FC').locator('td.note')).toHaveText('← S (next push)');
});

test('PLA takes the last byte pushed, and leaves it in memory as a free slot', async ({ page }) => {
  await step(page, 9);
  await expect(registersPanel(page).locator('tr[data-register="A"] td.value')).toHaveText('&33');
  await expect(stackRow(page, '01FD')).toHaveClass('next-push');
  await expect(stackRow(page, '01FD').locator('td.hex')).toHaveText('33');
});

test('PHP pushes &3D: bits 5 and 4 come out as 1', async ({ page }) => {
  await step(page, 14);
  await expect(stackRow(page, '01FF').locator('td.hex')).toHaveText('3D');
  await expect(stackRow(page, '01FF').locator('td').nth(1)).toHaveText('%0011 1101');
});

test('Run follows JMP (&10FF) into the page-boundary bug and stops at &0487', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Run until BRK' }).click();
  await expect(registersPanel(page).getByRole('status')).toContainText('Stopped at BRK (&0487) after 33 instructions, 93 cycles');
  // The wrap: &0100 then &01FF, so &01FF's &11 has become &AA.
  await expect(stackRow(page, '01FF').locator('td.hex')).toHaveText('AA');
  await expect(stackPanel(page).locator('[data-field="summary"]')).toHaveText('S = &FE · 1 byte in use · next push → &01FE · next pull ← &01FF');
});
