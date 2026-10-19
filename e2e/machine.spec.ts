import { test, expect, type Page } from '@playwright/test';

// Stage 27: the workbench runs on a BbcModelB. "/" is the playground (your
// program instead of the MOS); "/?machine=mos" powers on into MOS 1.20 from roms/.
// Stage 29: and boots it to BASIC's prompt.

interface Handle {
  peek(address: number): string;
  step(): number;
  pause(): void;
  machine: { runFrame(): number; readonly irqHolders: readonly string[] };
}

/**
 * Pauses the frame loop (Stage 30) so nothing else drives the machine, then
 * runs frames through the console handle as fast as it can, then one step so the panels redraw.
 */
async function runFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => {
    // The console handle main.ts puts on window; typed here because the page isn't.
    const handle = (window as unknown as { workbench: Handle }).workbench;
    handle.pause();
    for (let i = 0; i < n; i++) handle.machine.runFrame();
    handle.step();
  }, frames);
}

async function peek(page: Page, address: number): Promise<string> {
  // The console handle again: the page's window isn't typed, so it's cast at this boundary.
  return page.evaluate((a) => (window as unknown as { workbench: Handle }).workbench.peek(a), address);
}

test('the playground runs on the machine, and the header links to MOS mode', async ({ page }) => {
  await page.goto('/');
  const modes = page.getByRole('navigation', { name: 'Machine' });
  await expect(modes.getByRole('link', { name: 'Playground' })).toHaveAttribute('aria-current', 'page');
  await expect(modes.getByRole('link', { name: 'MOS 1.20' })).toHaveAttribute('href', '/?machine=mos');
  await expect(page.locator('.workbench-target')).toContainText('BBC Model B, playground');
  await expect(page.getByRole('region', { name: 'Assembler' })).toBeVisible();
});

test('MOS mode boots MOS 1.20 and BASIC II to the > prompt in MODE 7 screen memory (Stage 29)', async ({ page, request }) => {
  const isRom = async (path: string): Promise<boolean> => {
    const rom = await request.get(path);
    return rom.ok() && !(rom.headers()['content-type'] ?? '').includes('text/html');
  };
  test.skip(!(await isRom('/roms/os12.rom')) || !(await isRom('/roms/basic2.rom')), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');

  // Paused (Stage 30), so this test drives the machine itself and doesn't compete for CPU while it loads.
  await page.goto('/?machine=mos&roms=mos,basic&paused');
  await expect(page.locator('.rom-status')).toContainText('os12.rom');
  await expect(page.getByRole('region', { name: 'Assembler' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Interrupts' })).toContainText('&FFFC');

  // ">" is printed in frame 14 (demo:boot Part 1). Only 20 frames, so the
  // synchronous run doesn't starve the other specs' Run tests running alongside.
  await runFrames(page, 20);
  expect(await peek(page, 0x028d)).toBe('&01'); // power-on: IER read &80
  expect(await peek(page, 0x028e)).toBe('&80'); // 32K
  expect(await peek(page, 0xfe4e)).toBe('&F3'); // the MOS's IER: T1, T2, CB1, CA1 (vsync), CA2 (keyboard)
  expect(await peek(page, 0x7c28)).toBe('&42'); // "B" of "BBC Computer 32K", row 1
  expect(await peek(page, 0x7c78)).toBe('&42'); // "B" of "BASIC", row 3
  expect(await peek(page, 0x7cc8)).toBe('&3E'); // ">", row 5
});
