import { test, expect, type Page } from '@playwright/test';

// Stage 27: the workbench runs on a BbcModelB. "/" is the playground (your
// program instead of the MOS); "/?machine=mos" powers on into MOS 1.20 from roms/.

interface Handle {
  peek(address: number): string;
  step(): number;
  machine: { runFrame(): number; readonly irqHolders: readonly string[] };
}

/** Runs frames through the console handle (much faster than Run's 10 s), then one step so the panels redraw. */
async function runFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => {
    // The console handle main.ts puts on window; typed here because the page isn't.
    const handle = (window as unknown as { workbench: Handle }).workbench;
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

test('MOS mode powers on into MOS 1.20 and stalls with the System VIA holding /IRQ, unanswered', async ({ page, request }) => {
  const rom = await request.get('/roms/os12.rom');
  const isRom = rom.ok() && !(rom.headers()['content-type'] ?? '').includes('text/html');
  test.skip(!isRom, 'roms/os12.rom is missing (Acorn copyright, so you supply it)');

  await page.goto('/?machine=mos');
  await expect(page.locator('.rom-status')).toContainText('os12.rom');
  await expect(page.getByRole('region', { name: 'Assembler' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Interrupts' })).toContainText('&FFFC');

  // The MOS has set the VIA up and T1 has run out by frame 14 (demo:boot Part 2). Only 20, so the
  // synchronous run doesn't starve the other specs' Run tests running alongside.
  await runFrames(page, 20);
  expect(await peek(page, 0x028d)).toBe('&01'); // power-on: IER read &80
  expect(await peek(page, 0x028e)).toBe('&80'); // 32K
  expect(await peek(page, 0xfe4e)).toBe('&F2'); // the MOS's IER
  const interrupts = page.getByRole('region', { name: 'Interrupts' });
  await expect(interrupts).toContainText('held by the System VIA');
  await expect(interrupts).toContainText('1: IRQs held off');
});
