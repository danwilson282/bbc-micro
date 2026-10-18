import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /(boot|typing|basic-program|crtc|scroll-cursor|video-ula|bitmap-modes)\.spec\.ts/ },
    // Stage 30: the real-time frame loop's tests measure speed, and a free-running
    // machine competes for CPU with the Run tests (one slice per animation frame).
    // So they run on their own, after everything else.
    { name: 'real-time', use: { ...devices['Desktop Chrome'] }, testMatch: /(boot|typing|basic-program|crtc|scroll-cursor|video-ula|bitmap-modes)\.spec\.ts/, dependencies: ['chromium'] },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
