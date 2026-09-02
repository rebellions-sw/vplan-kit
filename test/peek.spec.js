import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* A feature row lists the items that verify it by id. Clicking one opens a read-only drawer over the
   table's right side, so you can read the item without leaving the feature you are working on. */

test('clicking a linked VI id opens the drawer over the table with that item in it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    DATA.items[0].description = 'the claim that must hold';
    DATA.items[0].oracle = 'compared against the ref-model';
    render();
  });

  await expect(page.locator('.peek-pane')).toHaveCount(0);
  await page.click('[data-act="peek"][data-id="VI001"]');

  const pane = page.locator('.peek-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText('VI001');
  await expect(pane).toContainText('first item');
  await expect(pane).toContainText('the claim that must hold');
  await expect(pane).toContainText('compared against the ref-model');
  await expect(pane).toContainText('F01');                       // what it verifies

  // it overlaps rather than reflowing: the feature row it came from has not moved
  const table = await page.locator('table').first().boundingBox();
  const box = await pane.boundingBox();
  expect(box.x).toBeGreaterThan(table.x);
  expect(await page.locator('[data-tab="features"].active').count()).toBe(1);   // still on the same tab
});

test('the drawer is read-only and closes with the ✕ or Esc', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-act="peek"][data-id="VI001"]');
  await expect(page.locator('.peek-pane [contenteditable="plaintext-only"]')).toHaveCount(0);
  await expect(page.locator('.peek-pane select')).toHaveCount(0);

  await page.click('[data-act="peek-close"]');
  await expect(page.locator('.peek-pane')).toHaveCount(0);

  await page.click('[data-act="peek"][data-id="VI001"]');
  await page.keyboard.press('Escape');
  await expect(page.locator('.peek-pane')).toHaveCount(0);
});

test('Open ↗ jumps to the row on its own tab and closes the drawer', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-act="peek"][data-id="VI001"]');
  await page.click('[data-act="peek-goto"]');

  await expect(page.locator('.peek-pane')).toHaveCount(0);
  await expect(page.locator('[data-tab="items"].active')).toHaveCount(1);
  await expect(page.locator('.cell.id', { hasText: 'VI001' })).toBeInViewport();
});

test('the × on a chip still unlinks, and a chip for a deleted row says so', async ({ page }) => {
  await openVplan(page);
  await seed(page);

  await page.click('[data-act="unlink"][data-id="VI001"]');
  expect(await page.evaluate(() => DATA.items[0].feature_refs)).toEqual([]);
  await expect(page.locator('.peek-pane')).toHaveCount(0);      // unlinking is not peeking

  await page.evaluate(() => { DATA.items[0].feature_refs = ['F01']; render(); });
  await page.click('[data-act="peek"][data-id="VI001"]');
  await page.evaluate(() => { DATA.items = []; render(); });
  await expect(page.locator('.peek-pane')).toContainText('더 이상 플랜에 없습니다');
});

test('the drawer never reaches the saved file', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-act="peek"][data-id="VI001"]');
  const saved = await page.evaluate(() => serializeDoc());
  expect(saved).not.toContain('role="dialog"');     // the CSS stays; the open drawer does not
  expect(saved).toMatch(/<div id="app"><\/div>/);
});
