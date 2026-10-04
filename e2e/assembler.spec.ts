import { test, expect, type Page } from '@playwright/test';

function assembler(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Assembler' });
}

function program(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Program' });
}

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function register(page: Page, name: string): ReturnType<Page['locator']> {
  return registersPanel(page).locator(`tr[data-register="${name}"] td.value`);
}

async function assembleAndRun(page: Page, source: string): Promise<void> {
  await assembler(page).getByRole('textbox', { name: 'Assembly source' }).fill(source);
  await assembler(page).getByRole('button', { name: 'Assemble and run' }).click();
}

async function step(page: Page, times = 1): Promise<void> {
  const button = registersPanel(page).getByRole('button', { name: 'Step one instruction' });
  for (let i = 0; i < times; i++) await button.click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?program=labels');
});

test('opens on the labels example, already assembled, with PC at &0400', async ({ page }) => {
  await expect(assembler(page).getByRole('status')).toHaveText('Assembled 36 bytes from 15 lines. Runs from &0400.');
  await expect(assembler(page).locator('[data-field="symbols"]')).toContainText('row2 = &7C50');
  await expect(program(page).locator('tr.current td.source')).toHaveText('start: LDA target');
  await expect(program(page).locator('tr.current td.bytes')).toHaveText('AD 1F 04');
  await expect(register(page, 'PC')).toHaveText('&0400');
});

test('the labels example writes "BBC" to row 2 of the screen', async ({ page }) => {
  await step(page, 13);
  const memory = page.getByRole('region', { name: 'Memory' });
  await memory.getByRole('textbox', { name: 'Go to address' }).fill('&7C50');
  await memory.getByRole('button', { name: 'Go to address' }).click();
  await expect(memory.locator('td.byte[data-address="7C50"]')).toHaveText('42');
  await expect(memory.locator('td.byte[data-address="7C52"]')).toHaveText('43');
  // The next byte is the .word's &50: the CPU can't tell data from code.
  await step(page);
  await expect(registersPanel(page).getByRole('status')).toContainText('unimplemented opcode &50 at &041F');
});

test('typing a new program and pressing Assemble & Run loads and resets it', async ({ page }) => {
  await assembleAndRun(page, ['*= &0400', 'LDX #&41', 'TXA', 'STA &7C00'].join('\n'));
  await expect(assembler(page).getByRole('status')).toHaveText('Assembled 6 bytes from 3 lines. Runs from &0400.');
  await expect(program(page).locator('tbody tr')).toHaveCount(3);
  await step(page, 3);
  await expect(register(page, 'A')).toHaveText('&41');
  // 7 (start-up reset) + 7 (Assemble & Run's reset) + 2 + 2 + 4. A reset
  // isn't a power-on: the cycle count keeps going (Stage 04).
  await expect(registersPanel(page).locator('[data-field="cycles"]')).toContainText('22 cycles');
});

test('errors are listed with line numbers, and the old program stays loaded', async ({ page }) => {
  await assembleAndRun(page, ['*= &0400', 'LDQ #1', 'STX &1234,Y', 'JMP nowhere'].join('\n'));
  await expect(assembler(page).getByRole('status')).toHaveText('3 errors: nothing was loaded.');
  await expect(assembler(page).getByRole('list', { name: 'Assembly errors' }).locator('li')).toHaveText([
    'line 2: unknown mnemonic "LDQ"',
    'line 3: STX has no Absolute,Y mode (it has &nn, &nn,Y, &nnnn)',
    'line 4: unknown label "nowhere"',
  ]);
  await expect(program(page).locator('tr.current td.source')).toHaveText('start: LDA target');
});

test('the example picker loads the Stage 07 source, which assembles to the hand-assembled bytes', async ({ page }) => {
  await assembler(page).getByRole('combobox', { name: 'Example program' }).selectOption('stores');
  await assembler(page).getByRole('button', { name: 'Assemble and run' }).click();
  await expect(program(page).locator('tbody tr')).toHaveCount(20);
  await expect(program(page).locator('tr[data-address="0426"] td.bytes')).toHaveText('91 70');
  await expect(program(page).locator('tr.modified')).toHaveCount(0);
});
