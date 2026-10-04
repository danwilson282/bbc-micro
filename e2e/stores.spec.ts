import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function memoryPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Memory' });
}

function byte(page: Page, address: string): ReturnType<Page['locator']> {
  return memoryPanel(page).locator(`td.byte[data-address="${address}"]`);
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

async function goTo(page: Page, address: string): Promise<void> {
  await memoryPanel(page).getByRole('textbox', { name: 'Go to address' }).fill(address);
  await memoryPanel(page).getByRole('button', { name: 'Go to address' }).click();
}

// Since Stage 08 the playground opens on the assembler's labels example;
// these tests use the Stage 07 stores program.
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=stores');
});

test('the Program panel lists the stores program, starting with TSX', async ({ page }) => {
  const program = page.getByRole('region', { name: 'Program' });
  await expect(program.locator('tbody tr')).toHaveCount(20);
  await expect(program.locator('tr.current td.source')).toHaveText('TSX');
});

test('TSX sets N from S=&FD, but TXS leaves the flags alone', async ({ page }) => {
  await step(page);
  await expect(register(page, 'X')).toHaveText('&FD');
  await expect(flag(page, 'N')).toHaveClass(/\bon\b/);
  await step(page, 3); // LDX #&FF, LDA #&00, TXS
  await expect(register(page, 'S')).toHaveText('&FF');
  await expect(flag(page, 'N')).not.toHaveClass(/\bon\b/);
  await expect(flag(page, 'Z')).toHaveClass(/\bon\b/);
});

test('a load writes nothing: the Wrote line says so and no byte is marked', async ({ page }) => {
  await step(page);
  await expect(memoryPanel(page).locator('[data-field="writes"]')).toHaveText('Wrote: nothing in the last run');
  await expect(memoryPanel(page).locator('td.byte.written')).toHaveCount(0);
});

test('STX &7C28 marks the byte it wrote, and the Wrote link jumps to it', async ({ page }) => {
  await step(page, 7);
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (4 cycles), 1 write');
  await memoryPanel(page).getByRole('button', { name: 'Go to &7C28' }).click();
  await expect(memoryPanel(page).locator('tbody th').first()).toHaveText('7C20');
  await expect(byte(page, '7C28')).toHaveText('48');
  await expect(byte(page, '7C28')).toHaveClass(/\bwritten\b/);
  await expect(memoryPanel(page).locator('td.byte.written')).toHaveCount(1);
});

test('STA &7C28,X takes 5 cycles even though no page is crossed', async ({ page }) => {
  await step(page, 14);
  await step(page);
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 1 (5 cycles), 1 write');
  await goTo(page, '&7C00');
  await expect(byte(page, '7C2B')).toHaveClass(/\bwritten\b/);
});

test('storing "O" over "O" at &7C04 is marked written but not changed', async ({ page }) => {
  await goTo(page, '&7C00');
  await step(page, 19);
  await step(page);
  await expect(byte(page, '7C04')).toHaveText('4F');
  await expect(byte(page, '7C04')).toHaveClass(/\bwritten\b/);
  await expect(byte(page, '7C04')).not.toHaveClass(/\bchanged\b/);
  await expect(memoryPanel(page).locator('td.ascii').nth(2)).toHaveText('........HELLO...');
});

test('Step ×16 marks every byte written during the run', async ({ page }) => {
  await goTo(page, '&7C00');
  await registersPanel(page).getByRole('button', { name: 'Step 16 instructions' }).click();
  await expect(registersPanel(page).getByRole('status')).toHaveText('Ran 16 (49 cycles), 4 writes');
  const written = memoryPanel(page).locator('td.byte.written');
  await expect(written).toHaveCount(4);
  await expect(memoryPanel(page).locator('[data-field="writes"]')).toHaveText(
    'Wrote: &7C28 ← &48, &7C29 ← &45, &7C2A ← &4C, &7C2B ← &4C',
  );
});

test('a poke changes a byte but is not a CPU write', async ({ page }) => {
  await goTo(page, '&7C00');
  await byte(page, '7C05').click();
  const input = memoryPanel(page).locator('input.byte-edit');
  await input.fill('21');
  await input.press('Enter');
  await expect(byte(page, '7C05')).toHaveClass(/\bchanged\b/);
  await expect(byte(page, '7C05')).not.toHaveClass(/\bwritten\b/);
});
