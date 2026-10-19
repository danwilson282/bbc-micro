import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 39: the screen is drawn from the CRTC's addresses. LIST of a long
// program scrolls (the MOS moves R12/R13; nothing is copied), and the
// cursor, drawn from R14/R15 and blinked by the 6845's own field count,
// flashes under the > prompt. In the real-time project: the machine must be
// running for keys and fields to happen.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

/** The parts of the page's console handle (src/main.ts) these tests use. */
interface Handle {
  workbench: {
    machine: { peek(a: number): number; poke(a: number, v: number): void };
    crtc: { displayStart: number; cursorAddress: number; register(n: number): number };
  };
}

/** One PC key held for 60 ms, then 60 ms up: long enough for the MOS's keyboard scan. */
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(60);
}

/**
 * Over about 1.5 s (75 fields: two of the cursor's 32-field blinks), whether
 * the cursor cell's two bottom pixel rows were ever lit and ever dark. The
 * cell comes from the CRTC: (R14/R15 - start) characters on, 40 a row.
 */
async function cursorPhases(page: Page): Promise<{ lit: boolean; dark: boolean; row: number; column: number }> {
  return page.evaluate(async () => {
    // The console handle (src/main.ts) and the canvas (index.html); the casts describe what's used.
    const { workbench } = window as unknown as Handle;
    const canvas = document.querySelector('#screen') as HTMLCanvasElement;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const offset = (workbench.crtc.cursorAddress - workbench.crtc.displayStart) & 0x3fff;
    const row = Math.floor(offset / 40);
    const column = offset % 40;
    let lit = false;
    let dark = false;
    for (let i = 0; i < 30; i++) {
      const data = context?.getImageData(column * 12, row * 20 + 18, 12, 2).data ?? new Uint8ClampedArray();
      let on = 0;
      for (let p = 0; p < data.length; p += 4) if ((data[p] ?? 0) > 128) on++;
      if (on === 24) lit = true;
      if (on === 0) dark = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { lit, dark, row, column };
  });
}

test.describe('CRTC addressing, scrolling and the cursor', () => {
  test.beforeEach(async ({ page, request }) => {
    test.skip(!(await hasRoms(request)), 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)');
    await page.goto('/?machine=mos&roms=mos,basic');
    await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
    await page.locator('.screen-frame').click();
  });

  test('the cursor flashes under the > prompt: lit and dark within a second and a half', async ({ page }) => {
    const phases = await cursorPhases(page);
    expect(phases).toEqual({ lit: true, dark: true, row: 5, column: 1 });
  });

  test('LIST of a 40-line program scrolls: the start address moves on and the cursor follows to the bottom row', async ({ page }) => {
    // A tokenised BASIC program poked in at PAGE (quicker than typing it):
    // each line is &0D, the line number high and low, its length, REM (&F4) and text.
    await page.evaluate(() => {
      // The console handle (src/main.ts); the cast describes the parts used.
      const { machine } = (window as unknown as Handle).workbench;
      let a = machine.peek(0x18) << 8;
      for (let n = 10; n <= 400; n += 10) {
        const text = ` LINE ${String(n)}`;
        for (const byte of [0x0d, n >> 8, n & 0xff, 5 + text.length, 0xf4]) machine.poke(a++, byte);
        for (const c of text) machine.poke(a++, c.charCodeAt(0));
      }
      machine.poke(a++, 0x0d);
      machine.poke(a, 0xff);
    });
    for (const key of ['O', 'L', 'D', 'Enter', 'L', 'I', 'S', 'T', 'Enter']) await tap(page, key);
    await expect(page.locator('.text-row').nth(23)).toHaveText(/^ {2}400REM LINE 400/);
    await expect(page.locator('.text-row').nth(24)).toHaveText(/^>/);
    await expect(page.locator('.text-row').nth(0)).toHaveText(/^ {2}170REM LINE 170/);
    // The console handle again: the cast describes the parts used.
    const start = await page.evaluate(() => (window as unknown as Handle).workbench.crtc.displayStart);
    expect(start).not.toBe(0x2800);
    expect(((start - 0x2800) & 0x3ff) % 40).toBe(0);
    const phases = await cursorPhases(page);
    expect(phases).toEqual({ lit: true, dark: true, row: 24, column: 1 });
  });
});
