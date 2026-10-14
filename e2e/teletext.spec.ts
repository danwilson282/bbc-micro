import { test, expect, type Page } from '@playwright/test';

// Stage 32: teletext colours and mosaic graphics. The test page is poked
// into screen memory by workbench.testPage(), so this runs in the
// playground and needs no ROMs.

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

/** The top-left pixel of a dot: cell (row, column), dot 0-5, line 0-9. */
function dotPixel(row: number, column: number, dot: number, line: number): [number, number] {
  return [column * 12 + dot * 2, row * 20 + line * 2];
}

const RED = '255,0,0';
const GREEN = '0,255,0';
const YELLOW = '255,255,0';
const BLUE = '0,0,255';
const WHITE = '255,255,255';
const BLACK = '0,0,0';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Screen (MODE 7 as text)')).toContainText('HELLO, BBC MICRO');
  // window.workbench is the page's console handle (src/main.ts); the cast describes the one method used.
  await page.evaluate(() => {
    (window as unknown as { workbench: { testPage(): void } }).workbench.testPage();
  });
  await expect(page.getByLabel('Screen (MODE 7 as text)')).toContainText('Teletext colours & graphics');
});

test('the title row is yellow text on a blue background, from the &9D cell on', async ({ page }) => {
  expect(await canvasPixel(page, ...dotPixel(0, 0, 3, 5))).toBe(BLACK); // &84: still black
  expect(await canvasPixel(page, ...dotPixel(0, 1, 3, 5))).toBe(BLUE); // &9D: set-at, already blue
  expect(await canvasPixel(page, ...dotPixel(0, 39, 0, 0))).toBe(BLUE); // to the end of the row
  // T (row 0, column 3): its top bar is ##### on matrix line 0 = cell line 1.
  expect(await canvasPixel(page, ...dotPixel(0, 3, 3, 1))).toBe(YELLOW);
  expect(await canvasPixel(page, ...dotPixel(1, 0, 0, 0))).toBe(BLACK); // the next row starts black again
});

test('text colours are set-after: "Red" is red and its &81 cell is blank', async ({ page }) => {
  expect(await canvasPixel(page, ...dotPixel(3, 0, 1, 2))).toBe(BLACK);
  // R's left stroke: dot 1, every matrix line 0-6.
  expect(await canvasPixel(page, ...dotPixel(3, 1, 1, 3))).toBe(RED);
});

test('a contiguous mosaic fills its whole cell, gap column and line included; separated ones have gaps', async ({ page }) => {
  // Row 10: &91 then four &FF: cells 1-4 solid red.
  expect(await canvasPixel(page, ...dotPixel(10, 1, 0, 0))).toBe(RED);
  expect(await canvasPixel(page, ...dotPixel(10, 1, 5, 9))).toBe(RED);
  // Row 11: &9A &91 then &FF: cell 2 is separated, gaps on the left dot and bottom line of each block.
  expect(await canvasPixel(page, ...dotPixel(11, 2, 1, 0))).toBe(RED);
  expect(await canvasPixel(page, ...dotPixel(11, 2, 0, 0))).toBe(BLACK);
  expect(await canvasPixel(page, ...dotPixel(11, 2, 1, 2))).toBe(BLACK);
});

test('hold graphics fills the colour-change cells: without it there is a gap', async ({ page }) => {
  // Row 22 (no hold): &91 FF FF &92 FF FF ...: cell 3 (&92) is a black gap.
  expect(await canvasPixel(page, ...dotPixel(22, 3, 3, 5))).toBe(BLACK);
  // Row 23 (hold): &91 &9E FF FF &92 FF FF ...: cell 4 (&92) repeats the red block, then green.
  expect(await canvasPixel(page, ...dotPixel(23, 4, 3, 5))).toBe(RED);
  expect(await canvasPixel(page, ...dotPixel(23, 5, 3, 5))).toBe(GREEN);
});

test('the text layer shows mosaics as block sextants, so copying the screen keeps the graphics', async ({ page }) => {
  await expect(page.locator('.text-row').nth(10)).toHaveText(/^ ████ ████/);
  await expect(page.locator('.text-row').nth(19)).toHaveText(/^Blast-through: ██TELETEXT██/);
  expect(await canvasPixel(page, ...dotPixel(19, 17, 3, 3))).toBe('0,255,255'); // T's stem, in cyan: blast-through
  expect(await canvasPixel(page, ...dotPixel(2, 0, 3, 1))).toBe(WHITE); // the T of "Text colours"
});
