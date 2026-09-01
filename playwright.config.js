import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    // vplan.html is opened straight off disk — no server, same as a user double-clicking it
    viewport: { width: 1500, height: 1000 },
    // Normally Playwright uses the browser it downloaded (`npx playwright install chromium`).
    // Set VPLAN_CHROMIUM to point at an existing binary in sandboxes that ship one.
    launchOptions: process.env.VPLAN_CHROMIUM ? { executablePath: process.env.VPLAN_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
