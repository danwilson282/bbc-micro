import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 30: MOS mode runs by itself in real time, and MODE 7's screen
// memory shows as text over the canvas.
// Stage 31: the canvas shows it as SAA5050 dots (the text is transparent).

/** The colour of one canvas pixel, as 'r,g,b'. The canvas is 480 × 500: a cell is 12 × 20, a dot 2 × 2. */
async function canvasPixel(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector('#screen');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no #screen canvas');
      const data = canvas.getContext('2d')?.getImageData(px, py, 1, 1).data;
      return data ? `${String(data[0])},${String(data[1])},${String(data[2])}` : 'none';
    },
    [x, y] as const,
  );
}

/** How many white pixels the canvas has in text row r (20 pixel lines). */
async function whitePixelsInRow(page: Page, row: number): Promise<number> {
  return page.evaluate((r) => {
    const canvas = document.querySelector('#screen');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no #screen canvas');
    const data = canvas.getContext('2d')?.getImageData(0, r * 20, canvas.width, 20).data;
    let count = 0;
    if (data) for (let i = 0; i < data.length; i += 4) if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) count++;
    return count;
  }, row);
}

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

// Each MOS page runs flat out until its test ends, competing with the other
// workers' tests for CPU. So each test pauses the machine once it has its answer.
async function pause(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Pause the machine' });
  if ((await toggle.count()) > 0) await toggle.click();
}

test('the boot text appears live in the browser, with nobody pressing Run', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  const screen = page.getByLabel('Screen (MODE 7 as text)');
  await expect(screen).toContainText('BBC Computer 32K');
  await expect(screen).toContainText('BASIC');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
  await pause(page);
  // Stage 31: the same text, as dots. The MOS starts with a blank line, so
  // row 0 is empty and row 1 ("BBC Computer 32K") has white dots, and so
  // does row 5 (the prompt's >).
  expect(await whitePixelsInRow(page, 0)).toBe(0);
  expect(await whitePixelsInRow(page, 1)).toBeGreaterThan(100);
  expect(await whitePixelsInRow(page, 5)).toBeGreaterThan(0);
});

test('it never runs faster than real time, whatever the display rate, and Pause, Step frame and Run work', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  const controls = page.getByRole('group', { name: 'Machine' });
  const status = controls.getByRole('status');
  // The speed is measured over a whole second. On a 60 Hz display, one frame
  // per callback would say 60 frames/s (120%). Under a busy test run the page
  // may get fewer callbacks and run slower (the slow-motion guard), so only
  // the upper bound is checked here; the exact 50 is checked in Jest.
  await expect(status).toContainText(/frames\/s/, { timeout: 5000 });
  const percent = Number(/\((\d+)%\)/.exec((await status.textContent()) ?? '')?.[1]);
  expect(percent).toBeGreaterThan(0);
  expect(percent).toBeLessThanOrEqual(102);

  await controls.getByRole('button', { name: 'Pause the machine' }).click();
  // Since Stage 38 the status also gives the field rate the CRTC measures.
  await expect(status).toHaveText(/^Paused at frame [\d,]+ · VSYNC 50\.00 Hz$/);
  const frameOf = async (): Promise<number> => Number(/frame ([\d,]+)/.exec((await status.textContent()) ?? '')?.[1]?.replace(/,/g, ''));
  const paused = await frameOf();
  await page.waitForTimeout(300);
  expect(await frameOf()).toBe(paused);

  await controls.getByRole('button', { name: /Run one 20 ms frame/ }).click();
  expect(await frameOf()).toBe(paused + 1);

  await controls.getByRole('button', { name: 'Run the machine in real time' }).click();
  await expect(status).toContainText('Running');
  await pause(page);
});

test('Step in the Registers panel pauses the frame loop first: one driver at a time', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos');
  const status = page.getByRole('group', { name: 'Machine' }).getByRole('status');
  await expect(status).toContainText('Running');
  await page.getByRole('button', { name: 'Step one instruction' }).click();
  await expect(status).toHaveText(/^Paused/);
});

test('?paused powers on and waits at the reset vector, to step through the MOS from its first instruction', async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
  await page.goto('/?machine=mos&paused');
  await expect(page.getByRole('group', { name: 'Machine' }).getByRole('status')).toHaveText('Paused at frame 0');
  // The MOS's reset vector at &FFFC/&FFFD points at &D9CD.
  await expect(page.locator('[data-register="PC"] .value')).toHaveText('&D9CD');
});

test('the playground shows its screen memory as text too: the "HELLO, BBC MICRO" at &7C00', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Screen (MODE 7 as text)')).toContainText('HELLO, BBC MICRO');
  await expect(page.getByRole('group', { name: 'Machine' })).toHaveCount(0);
});

test('the canvas draws the playground\'s H as SAA5050 dots: a 2 × 2 square per dot, after a blank gap column', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Screen (MODE 7 as text)')).toContainText('HELLO, BBC MICRO');
  // H's top line is #...# (data sheet Fig. 11, 4/8). Its first dot is dot 1
  // of the cell (dot 0 is the gap) on line 1 (line 0 is the gap): x 2-3, y 2-3.
  expect(await canvasPixel(page, 2, 2)).toBe('255,255,255');
  expect(await canvasPixel(page, 3, 3)).toBe('255,255,255');
  expect(await canvasPixel(page, 0, 2)).toBe('0,0,0'); // the gap column
  expect(await canvasPixel(page, 2, 0)).toBe('0,0,0'); // the gap line
  expect(await canvasPixel(page, 4, 2)).toBe('0,0,0'); // H's second dot is background
  expect(await canvasPixel(page, 10, 2)).toBe('255,255,255'); // and its fifth is lit
});
