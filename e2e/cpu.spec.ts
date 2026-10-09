import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function register(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`tr[data-register="${name}"] td.value`);
}

// Since Stage 08 the playground opens on the assembler's labels example;
// these tests use the Stage 07 stores program.
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=stores');
});

test('after reset, PC comes from the vector at &FFFC and S is &FD', async ({ page }) => {
  await expect(register(page, 'PC')).toHaveText('&0400');
  await expect(register(page, 'S')).toHaveText('&FD');
  await expect(register(page, 'P')).toHaveText('&24');
  await expect(registersPanel(page).locator('[data-flag="I"]')).toHaveClass(/\bon\b/);
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toHaveText('Cycles: 7 cycles = 3.5 µs at 2 MHz');
  await expect(registersPanel(page).locator('[data-field="next"]')).toHaveText('Next: &0400: &BA TSX');
});

test('Step runs TSX: PC advances by 1 and 2 cycles pass', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Step one instruction' }).click();
  await expect(register(page, 'PC')).toHaveText('&0401');
  await expect(registersPanel(page).locator('tr[data-register="PC"]')).toHaveClass(/changed/);
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toContainText('9 cycles');
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  await expect(memory.locator('td.byte.pc')).toHaveAttribute('data-address', '0401');
});

test('stepping off the end of the program page runs the BRK at &0500, through the empty vector to &0000', async ({ page }) => {
  // The 20-line stores program (63 cycles), then 213 NOPs from &042B to &04FF
  // (426 cycles), after the 7-cycle reset: 233 instructions. Then the BRK
  // (7 cycles) jumps through &FFFE/&FFFF = &0000, where &7C is undocumented.
  const step16 = registersPanel(page).getByRole('button', { name: 'Step 16 instructions' });
  for (let i = 0; i < 15; i++) await step16.click();
  await expect(register(page, 'PC')).toHaveText('&0000');
  await expect(registersPanel(page).getByRole('status')).toContainText('unimplemented opcode &7C at &0000');
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toContainText('503 cycles');
});

test('Reset reloads PC from the vector and drops S by 3', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Step one instruction' }).click();
  await registersPanel(page).getByRole('button', { name: 'Reset the CPU' }).click();
  await expect(register(page, 'PC')).toHaveText('&0400');
  await expect(register(page, 'S')).toHaveText('&FA');
});
