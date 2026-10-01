import { test, expect, type Page } from '@playwright/test';

function explorer(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('region', { name: 'Addressing modes' });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on LDA (&70),Y, following the pointer at &70/&71 to the Mode 7 screen', async ({ page }) => {
  await expect(explorer(page).locator('.explorer-instruction')).toContainText('LDA (&70),Y');
  await expect(explorer(page).locator('.explorer-instruction')).toContainText('&0400: B1 70');
  await expect(explorer(page).getByRole('status')).toHaveText('EA = &7C00, which holds &48');
});

test('LDA &FF,X with X=&01 wraps to &0000 inside page zero', async ({ page }) => {
  await explorer(page).getByRole('button', { name: 'Example: Zero-page wrap: LDA &FF,X' }).click();
  await expect(explorer(page).getByRole('status')).toHaveText('EA = &0000, which holds &7C');
  await expect(explorer(page).locator('li.warn')).toContainText('not &0100');
});

test('a page-crossing LDA &30F8,Y costs an extra cycle', async ({ page }) => {
  await explorer(page).getByRole('button', { name: 'Example: Page cross: LDA &30F8,Y' }).click();
  await expect(explorer(page).locator('.explorer-cycles')).toHaveText('LDA &30F8,Y: 4 + 1 (page crossed) = 5 cycles');
});

test('JMP (&30FF) reads its high byte from &3000 (NMOS bug)', async ({ page }) => {
  await explorer(page).getByRole('button', { name: 'Example: JMP bug: JMP (&30FF)' }).click();
  await expect(explorer(page).getByRole('status')).toHaveText('Jump target = &0400');
});

test('typing a new Y re-explains immediately, and bad input shows an error', async ({ page }) => {
  const y = explorer(page).getByRole('textbox', { name: 'Y' });
  await y.fill('&07');
  await expect(explorer(page).getByRole('status')).toHaveText('EA = &7C07, which holds &42');
  await y.fill('&100');
  await expect(explorer(page).getByRole('status')).toHaveText('Y must be one byte, &00-&FF');
});
