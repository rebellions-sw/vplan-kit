import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* vplan_fill_description writes below a marker line, leaving whatever the user wrote above it. The
   marker is the label: the badge is on whenever the description contains it, so deleting the AI half
   takes the badge with it and no flag can go stale. */

const MARK = '=== AI ===';
const descRows = page => page.locator('tr.subrow').filter({ hasText: 'Description' });

test('the badge follows the marker, not a flag', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate((m) => {
    DATA.features[0].description = `사람이 쓴 줄\n${m}\n- agent가 붙인 줄`;
    DATA.features[1].description = 'written by a person only';
    render();
  }, MARK);

  await expect(descRows(page).nth(0)).toContainText('AI 채움');
  await expect(descRows(page).nth(0)).toContainText('사람이 쓴 줄');
  await expect(descRows(page).nth(1)).not.toContainText('AI 채움');
});

test('deleting the AI half takes the badge with it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate((m) => {
    DATA.features[0].description = `mine\n${m}\n- theirs`;
    render();
  }, MARK);
  await expect(descRows(page).nth(0)).toContainText('AI 채움');

  // the user keeps their own text and drops the marker section
  await page.evaluate(() => { DATA.features[0].description = 'mine'; render(); });
  await expect(descRows(page).nth(0)).not.toContainText('AI 채움');
});

test('editing above the marker keeps the badge', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate((m) => { DATA.features[0].description = `mine\n${m}\n- theirs`; render(); }, MARK);

  const cell = page.locator('.cell[data-path="features.0.description"]');
  await cell.click();
  await page.keyboard.type('!');                       // a human keystroke in their own half
  await page.evaluate(() => render());
  await expect(descRows(page).nth(0)).toContainText('AI 채움');
  expect(await page.evaluate(() => DATA.features[0].description)).toContain(await page.evaluate(() => AI_MARK));
});

test('the marker is plain document text and round-trips through a save', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate((m) => { DATA.items[0].description = `mine\n${m}\n- theirs`; render(); }, MARK);

  const saved = await page.evaluate(() => serializeDoc());
  const tag = '<script id="vplan-data" type="application/json">';
  const at = saved.lastIndexOf(tag);
  const data = JSON.parse(saved.slice(at + tag.length, saved.indexOf('</scr' + 'ipt>', at)));
  expect(data.items[0].description).toContain(MARK);
  expect('description_ai' in data.items[0]).toBe(false);      // no flag field any more
});

test('deleting the marker line clears the badge as you type, with no re-render', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate((m) => { DATA.features[0].description = `mine\n${m}\n- theirs`; render(); }, MARK);
  const badge = page.locator('[data-aibadge="features.0.description"]');
  await expect(badge).toHaveText(/AI 채움/);

  // select the whole cell and retype only the human half — the badge must go without a render()
  const cell = page.locator('.cell[data-path="features.0.description"]');
  await cell.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('mine only');
  await expect(badge).toHaveText('');                       // cleared live
  expect(await page.evaluate(() => DATA.features[0].description)).toBe('mine only');

  // and typing a marker back brings it straight back
  await page.keyboard.press('Enter');
  await page.keyboard.type(MARK);
  await expect(badge).toHaveText(/AI 채움/);
});

test('the badge element is there even when a description has no marker', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await expect(page.locator('[data-aibadge="features.0.description"]')).toHaveCount(1);
  await expect(page.locator('[data-aibadge="features.0.description"]')).toHaveText('');
});
