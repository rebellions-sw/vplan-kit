import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* The two long tables keep their panel head (with + add) and their column row on screen while the
   page scrolls — anything else means losing track of which column you are reading halfway down. */

async function manyRows(page) {
  await page.evaluate(() => {
    for (let n = 0; n < 40; n++) {
      DATA.features.push({ id: 'F' + String(n + 10), category: 'behavior', name: 'row ' + n,
        description: '', phase: 'Alpha', status: 'editing', reviewed: false, notes: '' });
      DATA.items.push({ id: 'VI' + String(n + 100), category: 'behavior', name: 'item ' + n,
        description: '', feature_refs: [], oracle: '', judged_by: [], stimulus: 'directed',
        status: 'editing', phase: 'Alpha', implemented: 'todo', reviewed: false, notes: '' });
    }
    render();
  });
}

for (const [tab, panel] of [['features', 'Feature list'], ['items', 'Verification items']]) {
  test(`${tab}: the panel head and column row stay pinned while the page scrolls`, async ({ page }) => {
    await openVplan(page);
    await seed(page);
    await manyRows(page);
    await page.click(`[data-tab="${tab}"]`);

    const head = page.locator('.panel.stick > .panel-head', { hasText: panel });
    const th = page.locator('.panel.stick thead th').first();

    await page.mouse.wheel(0, 4000);
    await page.waitForFunction(() => window.scrollY > 1000);

    const headBox = await head.boundingBox();
    const thBox = await th.boundingBox();
    const topbar = await page.locator('.topbar').boundingBox();
    const under = topbar.y + topbar.height;

    // pinned in the gap right under the top bar, rows scrolling behind it
    expect(headBox.y).toBeGreaterThanOrEqual(under - 2);
    expect(headBox.y).toBeLessThanOrEqual(under + 2);
    // the column row sits directly below the panel head, stacked rather than overlapping
    expect(thBox.y).toBeGreaterThanOrEqual(headBox.y + headBox.height - 2);
    expect(thBox.y + thBox.height).toBeLessThan(page.viewportSize().height);
    await expect(page.locator(`[data-act="add"][data-arr="${tab}"]`)).toBeInViewport();
  });
}

test('the measured sticky offsets never reach the saved file', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  // they are live measurements written onto #app, not document content
  expect(await page.evaluate(() => document.querySelector('#app').getAttribute('style'))).toContain('--topbar-h');
  const saved = await page.evaluate(() => serializeDoc());
  expect(saved).toMatch(/<div id="app"><\/div>/);
});
