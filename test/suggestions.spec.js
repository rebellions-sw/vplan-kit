import { test, expect } from '@playwright/test';
import { openVplan, data, setCell , seed} from './helpers.js';

test('the inbox sits under the Features tab and shows the pending cards', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="features"]');
  // the panel comes after the feature table, not on a tab of its own
  const order = await page.$$eval('#tabbody .panel h2', hs => hs.map(h => h.textContent));
  expect(order[0]).toBe('Feature list');
  expect(order).toContain('Suggestions from AI');
  await expect(page.locator('.sug')).toHaveCount(2);          // pending filter is the default
});

test('every pending card shows its source quote and a link back to the MAS', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="features"]');
  const cards = page.locator('.sug');
  for (let i = 0; i < await cards.count(); i++) {
    await expect(cards.nth(i).locator('.evi-q')).not.toBeEmpty();
    await expect(cards.nth(i).locator('.evi a')).toHaveAttribute('href', /^https?:/);
  }
});

test('accepting a suggestion appends a feature with a fresh id and marks the card accepted', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  const before = await data(page);
  await page.click('[data-tab="features"]');
  await page.click('[data-act="sug-accept"][data-i="0"]');

  const after = await data(page);
  expect(after.features.length).toBe(before.features.length + 1);

  const f = after.features.at(-1);
  expect(f.id).toBe('F03');                                     // continues the seeded F01/F02
  expect(before.features.map(x => x.id)).not.toContain(f.id);   // never collides
  expect(f.name).toBe(before.suggestions[0].payload.name);
  expect(f.status).toBe('editing');        // a card arrives described — accept puts it past 'not started'

  expect(after.suggestions[0].status).toBe('accepted');
  expect(after.suggestions[0].accepted_as).toBe(f.id);
  await expect(page.locator('.sug')).toHaveCount(1);             // the accepted card leaves the pending list
});

test('edits made on the card before accepting are carried into the feature', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="features"]');
  await setCell(page, 'suggestions.0.payload.name', 'Renamed before accept');
  await setCell(page, 'suggestions.0.payload.category', 'behavior');
  await page.click('[data-act="sug-accept"][data-i="0"]');
  const f = (await data(page)).features.at(-1);
  expect(f.name).toBe('Renamed before accept');
  expect(f.category).toBe('behavior');
});

test('a reject label is recorded on one click, with no dialog, and the note is typed on the card', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', async d => { dialogs++; await d.dismiss(); });
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="features"]');
  await page.click('[data-act="sug-reject"][data-k="hallucinated"][data-i="0"]');

  const s = (await data(page)).suggestions[0];
  expect(s.status).toBe('rejected');
  expect(s.reject_kind).toBe('hallucinated');
  expect(dialogs).toBe(0);

  // the optional note is an ordinary editable cell on the folded card
  await page.locator('.sug-fold', { hasText: 'Rejected' }).click();
  await setCell(page, 'suggestions.0.reject_reason', 'the quote does not say this');
  expect((await data(page)).suggestions[0].reject_reason).toBe('the quote does not say this');
  expect(await page.evaluate(() => serializeDoc())).toContain('the quote does not say this');
});

test('a pre-rejected suggestion keeps its reason so the agent will not re-propose it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  const s = (await data(page)).suggestions.find(x => x.status === 'rejected');
  expect(s).toBeTruthy();
  expect(s.reject_reason.length).toBeGreaterThan(10);
});

test('a decided card folds away but stays in the file, and the fold opens it again', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="features"]');
  const pending = await page.locator('.sug').count();

  await page.click('[data-act="sug-reject"][data-k="duplicated"][data-i="0"]');

  // gone from the pending list, but recorded — with its reason
  await expect(page.locator('.sug')).toHaveCount(pending - 1);
  const stored = (await data(page)).suggestions[0];
  expect(stored.status).toBe('rejected');
  expect(stored.reject_kind).toBe('duplicated');

  const fold = page.locator('.sug-fold', { hasText: 'Rejected' });
  await expect(fold).toBeVisible();
  await fold.click();
  // 1 still pending + 2 rejected: the one just rejected and the one the seed starts rejected
  await expect(page.locator('.sug')).toHaveCount(pending + 1);
  await expect(page.locator('.sug.done')).toHaveCount(2);
});

test('reopening an accepted suggestion keeps the feature it created', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="features"]');
  await page.click('[data-act="sug-accept"][data-i="0"]');
  const created = (await data(page)).suggestions[0].accepted_as;

  await page.locator('.sug-fold', { hasText: 'Accepted' }).click();
  await page.click('[data-act="sug-reopen"][data-i="0"]');

  const d2 = await data(page);
  expect(d2.suggestions[0].status).toBe('pending');
  expect(d2.suggestions[0].accepted_as).toBeUndefined();
  expect(d2.features.some(f => f.id === created)).toBe(true);   // the feature is NOT rolled back
});

test('suggestions never mutate features/testcases/coverage on their own', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  const before = await data(page);
  await page.click('[data-tab="features"]');
  // merely viewing must not touch the plan
  const after = await data(page);
  expect(after.features).toEqual(before.features);
  expect(after.testcases).toEqual(before.testcases);
  expect(after.coverage).toEqual(before.coverage);
});
