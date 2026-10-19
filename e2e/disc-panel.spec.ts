import { test, expect } from '@playwright/test';
import { buildTestDisc } from '../src/disc/test-disc';

// Stage 48: the Disc panel shows a disc image's DFS catalogue. The disc is
// the Stage 48 test disc, built here by our own writer (no files needed),
// handed to the panel's file chooser as if picked from the computer. A drop
// goes through the same load().

test('choosing the Stage 48 test disc shows its catalogue as *CAT would, and each file\'s *INFO numbers', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('[data-panel="Disc"]');
  await panel.locator('input[type="file"]').setInputFiles({ name: 'stage48.ssd', mimeType: 'application/octet-stream', buffer: Buffer.from(buildTestDisc()) });

  await expect(panel.getByRole('status')).toHaveText('stage48.ssd: ssd, single-sided, 40 tracks');
  await expect(panel.locator('.disc-cat')).toHaveText(
    ['STAGE 48 (00)', 'Drive 0             Option 3 (EXEC)', 'Directory :0.$      Library :0.$', '', '    !BOOT               EMPTY', '    HELLO   L           README', '  E.DATA'].join('\n'),
  );
  const hello = panel.locator('.disc-files tbody tr', { hasText: '$.HELLO' });
  await expect(hello.locator('td')).toHaveText(['$.HELLO', 'L', 'FF1900', 'FF1900', '&0021', '&003', '1']);
  await expect(panel.locator('.disc-summary')).toHaveText('5 of 31 files · 6 of 398 sectors used · 392 free');
});

test('a file that is not a disc image gets a message, not a catalogue', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('[data-panel="Disc"]');
  await panel.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(panel.getByRole('status')).toHaveText(/notes\.txt: the name must end \.ssd or \.dsd/);
  await expect(panel.locator('.disc-cat')).toHaveCount(0);
});

test('a disc dropped anywhere on the page is shown in the Disc panel', async ({ page }) => {
  await page.goto('/');
  const bytes = [...buildTestDisc()];
  // A synthetic drop with a real File in its DataTransfer, on the page body, not the panel.
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], 'dropped.ssd'));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, bytes);
  await expect(page.locator('[data-panel="Disc"]').getByRole('status')).toHaveText('dropped.ssd: ssd, single-sided, 40 tracks');
});
