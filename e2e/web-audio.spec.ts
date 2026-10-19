import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Stage 46: the chip's samples reach the sound card through an AudioWorklet.
// We can't listen in a test, so we read what the worklet says it played (its
// stats: peak level, and pitch from rising zero crossings). In the real-time
// project, because sound needs the machine running.

async function hasRoms(request: APIRequestContext): Promise<boolean> {
  for (const path of ['/roms/os12.rom', '/roms/basic2.rom']) {
    const rom = await request.get(path);
    // Vite answers a missing file with index.html, so a 200 isn't enough.
    if (!rom.ok() || (rom.headers()['content-type'] ?? '').includes('text/html')) return false;
  }
  return true;
}

async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(60);
}

async function typeLine(page: Page, text: string): Promise<void> {
  await page.locator('.screen-frame').click();
  for (const char of text) await tap(page, char);
  await tap(page, 'Enter');
}

interface Heard {
  peak: number;
  pitch: number;
  underruns: number;
}

/** Samples the worklet's reports every 50 ms for `ms`, keeping the audible ones. */
async function listen(page: Page, ms: number): Promise<Heard[]> {
  return page.evaluate(async (duration) => {
    const handle: unknown = Reflect.get(window, 'workbench');
    const audio: unknown = typeof handle === 'object' && handle !== null ? Reflect.get(handle, 'audio') : undefined;
    const heard: { peak: number; pitch: number; underruns: number }[] = [];
    const end = performance.now() + duration;
    let last: unknown;
    while (performance.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stats: unknown = typeof audio === 'object' && audio !== null ? Reflect.get(audio, 'stats') : undefined;
      if (stats === last || typeof stats !== 'object' || stats === null) continue;
      last = stats;
      const peak = Number(Reflect.get(stats, 'peak'));
      if (peak > 0.01) heard.push({ peak, pitch: Number(Reflect.get(stats, 'pitch')), underruns: Number(Reflect.get(stats, 'underruns')) });
    }
    return heard;
  }, ms);
}

const SKIP = 'roms/os12.rom or roms/basic2.rom is missing (Acorn copyright, so you supply them)';

test.beforeEach(async ({ page, request }) => {
  test.skip(!(await hasRoms(request)), SKIP);
  await page.goto('/?machine=mos&roms=mos,basic');
  await expect(page.locator('.text-row').nth(5)).toHaveText(/^>/);
});

test('sound starts off, and the button (a user gesture) switches the audio thread on', async ({ page }) => {
  const toggle = page.locator('button[data-field="sound"]');
  await expect(toggle).toHaveText('🔇 Sound off');
  await toggle.click();
  await expect(toggle).toHaveText('🔊 Sound on');
  await expect(page.locator('.sound-status')).toHaveText(/kHz · \d+ ms buffered · \d+ underruns? .*silent/);
});

test('Power on with sound on plays the boot bleep: 523 Hz at peak 0.158 (attenuation 4, one channel of four)', async ({ page }) => {
  await page.locator('button[data-field="sound"]').click();
  await expect(page.locator('.sound-status')).toContainText('silent');
  await page.getByRole('button', { name: 'Switch off and on again (reset every chip)' }).click();
  const heard = await listen(page, 1500);
  expect(heard.length).toBeGreaterThan(0);
  const loudest = Math.max(...heard.map((h) => h.peak));
  expect(loudest).toBeCloseTo(0.158, 2);
  // Pitch is measured between a window's first and last zero crossing, so a partly filled window reads true too.
  expect(heard.some((h) => Math.abs(h.pitch - 523) < 3)).toBe(true);
});

test('SOUND 1,-15,53,20 plays 266.5 Hz at peak 0.25, and an ENVELOPE pitch sweep rises', async ({ page }) => {
  await page.locator('button[data-field="sound"]').click();
  await expect(page.locator('.sound-status')).toContainText('silent');
  await typeLine(page, 'SOUND 1,-15,53,20');
  const tone = await listen(page, 1200);
  expect(Math.max(...tone.map((h) => h.peak))).toBeCloseTo(0.25, 2);
  expect(tone.some((h) => Math.abs(h.pitch - 266.5) < 2)).toBe(true);

  // Pitch +1 (a quarter semitone) every 2 centiseconds, full volume at once: a rising siren.
  await typeLine(page, 'ENVELOPE 1,2,1,0,0,100,0,0,126,0,0,-126,126,0');
  await typeLine(page, 'SOUND 1,1,100,40');
  const sweep = await listen(page, 2500);
  const pitches = sweep.filter((h) => h.peak > 0.2).map((h) => h.pitch);
  expect(pitches.length).toBeGreaterThan(4);
  expect(pitches[pitches.length - 2] ?? 0).toBeGreaterThan((pitches[1] ?? 0) * 1.5);
});
