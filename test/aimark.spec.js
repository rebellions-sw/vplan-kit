import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* vplan_fill_description marks what it wrote with description_ai. The mark is a claim about
   authorship, so the first human keystroke in that description retires it. */

test('a marked description shows the badge; an unmarked one does not', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    DATA.features[0].description = 'written by the agent';
    DATA.features[0].description_ai = true;
    DATA.features[1].description = 'written by a person';
    render();
  });

  const rows = page.locator('tr.subrow').filter({ hasText: 'Description' });
  await expect(rows.nth(0)).toContainText('AI가 채움');
  await expect(rows.nth(1)).not.toContainText('AI가 채움');
});

test('editing the description drops the mark', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    DATA.features[0].description = 'written by the agent';
    DATA.features[0].description_ai = true;
    render();
  });

  const cell = page.locator('.cell[data-path="features.0.description"]');
  await cell.click();
  await page.keyboard.type('!');
  expect(await page.evaluate(() => 'description_ai' in DATA.features[0])).toBe(false);
  expect(await page.evaluate(() => DATA.features[0].description)).toContain('written by the agent');

  await page.evaluate(() => render());                       // the badge is gone on the next render
  await expect(page.locator('tr.subrow').filter({ hasText: 'Description' }).first()).not.toContainText('AI가 채움');
});

test('editing another field leaves the mark alone', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    DATA.features[0].description = 'written by the agent';
    DATA.features[0].description_ai = true;
    render();
  });

  await page.locator('.cell[data-path="features.0.notes"]').click();
  await page.keyboard.type('a note');
  expect(await page.evaluate(() => DATA.features[0].description_ai)).toBe(true);
});

test('the mark is saved with the plan, so it survives a reload', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    DATA.items[0].description = 'agent text';
    DATA.items[0].description_ai = true;
    render();
  });

  const saved = await page.evaluate(() => serializeDoc());
  const tag = '<script id="vplan-data" type="application/json">';
  const at = saved.lastIndexOf(tag);
  const data = JSON.parse(saved.slice(at + tag.length, saved.indexOf('</scr' + 'ipt>', at)));
  expect(data.items[0].description_ai).toBe(true);
});
