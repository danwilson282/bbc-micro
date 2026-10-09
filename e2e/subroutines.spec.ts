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

/** Steps n instructions, using Step ×16 where it can. */
async function step(page: Page, times: number): Promise<void> {
  const panel = registersPanel(page);
  for (let i = 0; i < Math.floor(times / 16); i++) await panel.getByRole('button', { name: 'Step 16 instructions' }).click();
  for (let i = 0; i < times % 16; i++) await panel.getByRole('button', { name: 'Step one instruction' }).click();
}

// Since Stage 17 the playground opens on the interrupts example.
test.beforeEach(async ({ page }) => {
  await page.goto('/?program=subroutines');
});

test('opens the Stage 16 subroutines example, with no RTS hint until two bytes are in use', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('subroutines');
  await step(page, 2); // LDX #&FF, TXS
  await expect(stackPanel(page).locator('[data-field="rts"]')).toBeHidden();
});

test('the first JSR pushes &0409, its own last byte, and the panel says RTS will go to &040A', async ({ page }) => {
  await step(page, 5); // LDX, TXS, LDA, LDX, JSR multiply
  await expect(registersPanel(page).locator('tr[data-register="PC"] td.value')).toHaveText('&0428');
  await expect(stackRow(page, '01FF').locator('td.hex')).toHaveText('04');
  await expect(stackRow(page, '01FE').locator('td.hex')).toHaveText('09');
  await expect(stackPanel(page).locator('[data-field="rts"]')).toHaveText('RTS now → &040A (pulls 09 04, + 1)');
});

test('square calling multiply leaves two return addresses on the stack', async ({ page }) => {
  await step(page, 72); // into the second multiply, via square
  await expect(stackPanel(page).locator('[data-field="summary"]')).toHaveText('S = &FB · 4 bytes in use · next push → &01FB · next pull ← &01FC');
  for (const [address, value] of [
    ['01FF', '04'],
    ['01FE', '12'],
    ['01FD', '04'],
    ['01FC', '26'],
  ] as const) {
    await expect(stackRow(page, address).locator('td.hex')).toHaveText(value);
  }
  await expect(stackPanel(page).locator('[data-field="rts"]')).toHaveText('RTS now → &0427 (pulls 26 04, + 1)');
});

test('Run stops at the BRK with 143, 144 and 30000 at &90-&95', async ({ page }) => {
  await registersPanel(page).getByRole('button', { name: 'Run until BRK' }).click();
  await expect(registersPanel(page).getByRole('status')).toContainText('Stopped at BRK (&0422) after 202 instructions, 640 cycles');
  const memory = page.getByRole('region', { name: 'Memory', exact: true });
  await memory.getByRole('textbox', { name: 'Go to address' }).fill('&0000');
  await memory.getByRole('button', { name: 'Go to address' }).click();
  const bytes = ['8F', '00', '90', '00', '30', '75'];
  for (const [i, value] of bytes.entries()) {
    await expect(memory.locator(`td.byte[data-address="${(0x90 + i).toString(16).toUpperCase().padStart(4, '0')}"]`)).toHaveText(value);
  }
  await expect(stackPanel(page).locator('[data-field="summary"]')).toHaveText('S = &FF · empty · next push → &01FF');
});
