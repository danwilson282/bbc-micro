import { test, expect, type Page } from '@playwright/test';

function registersPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Registers' });
}

function interruptsPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Interrupts' });
}

function stackPanel(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Stack' });
}

async function step(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await registersPanel(page).getByRole('button', { name: 'Step one instruction' }).click();
}

/** A byte in the Memory panel, after going to &0000. */
async function zeroPage(page: Page, address: number): Promise<ReturnType<Page['locator']>> {
  const memory = page.getByRole('region', { name: 'Memory' });
  await memory.getByRole('textbox', { name: 'Go to address' }).fill('&0000');
  await memory.getByRole('button', { name: 'Go to address' }).click();
  return memory.locator(`td.byte[data-address="${address.toString(16).toUpperCase().padStart(4, '0')}"]`);
}

// Stage 17's interrupts example is the playground's default.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the interrupts example, with the three vectors listed', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Assembler' }).getByRole('combobox', { name: 'Example program' })).toHaveValue('interrupts');
  const vectors = interruptsPanel(page).getByRole('table', { name: 'Vectors' });
  await expect(vectors.locator('tr[data-vector="NMI"] td.handler')).toHaveText('→ &0428');
  await expect(vectors.locator('tr[data-vector="RESET"] td.handler')).toHaveText('→ &0400');
  await expect(vectors.locator('tr[data-vector="IRQ/BRK"] td.handler')).toHaveText('→ &040F');
});

test('an IRQ pressed before CLI waits, and is taken the moment I clears: pushes &0404 and P with B = 0', async ({ page }) => {
  await interruptsPanel(page).getByRole('button', { name: 'Ring the doorbell: hold IRQ until the handler answers' }).click();
  await expect(interruptsPanel(page).locator('[data-field="verdict"]')).toHaveText('IRQ waiting: I = 1 holds it off until CLI or RTI clears I.');
  await step(page, 3); // LDX, TXS, CLI
  await expect(registersPanel(page).locator('[data-field="next"]')).toHaveText('Next: IRQ → &040F (vector &FFFE), before &0404: &00 BRK');
  await step(page, 1);
  await expect(registersPanel(page).locator('tr[data-register="PC"] td.value')).toHaveText('&040F');
  for (const [address, value] of [
    ['01FF', '04'],
    ['01FE', '04'],
    ['01FD', 'A0'], // N (from LDX #&FF), bit 5; B = 0
  ] as const) {
    await expect(stackPanel(page).locator(`tr[data-address="${address}"] td.hex`)).toHaveText(value);
  }
});

test('BRK pushes P with B = 1 and skips its padding byte', async ({ page }) => {
  await step(page, 4); // LDX, TXS, CLI, BRK
  await expect(registersPanel(page).locator('tr[data-register="PC"] td.value')).toHaveText('&040F');
  await expect(stackPanel(page).locator('tr[data-address="01FE"] td.hex')).toHaveText('06');
  await expect(stackPanel(page).locator('tr[data-address="01FD"] td.hex')).toHaveText('B0');
});

test('Run stops at the BRK; Run again goes through it, and IRQ and NMI presses are counted at &80 and &81', async ({ page }) => {
  const run = registersPanel(page).getByRole('button', { name: 'Run until BRK' });
  await run.click();
  await expect(registersPanel(page).getByRole('status')).toContainText('Stopped at BRK (&0404) after 3 instructions, 6 cycles');
  await run.click();
  await expect(registersPanel(page).getByRole('status')).toContainText('Running…');
  await expect(await zeroPage(page, 0x82)).toHaveText('01');
  await interruptsPanel(page).getByRole('button', { name: 'Ring the doorbell: hold IRQ until the handler answers' }).click();
  await expect(await zeroPage(page, 0x80)).toHaveText('01');
  await expect(interruptsPanel(page).locator('dd[data-input="IRQ line"]')).toHaveText('released');
  const nmi = interruptsPanel(page).getByRole('button', { name: 'Pulse NMI: one falling edge' });
  await nmi.click();
  await nmi.click();
  await expect(await zeroPage(page, 0x81)).toHaveText('02');
  await registersPanel(page).getByRole('button', { name: 'Stop running' }).click();
});
