import { test, expect } from '@playwright/test';
import { openVplan, seed, lint } from './helpers.js';

/* The audit inbox judges rows that already exist: `missing` adds one, `insufficient` / `mismatch`
   edit the row the card names. Like suggestions, nothing reaches the plan without Accept. */

/** Seed audit cards against the rows seed() created (F01/F02, VI001). */
async function seedAudits(page) {
  await page.evaluate(() => {
    const card = (aid, extra) => Object.assign({
      aid, kind: 'feature', target: 'F01', finding: 'insufficient', status: 'pending',
      created: '2026-09-02', confidence: 'high',
      source: { doc: 'MAS', section: '5.5', url: 'https://example.com/mas#5-5', quote: 'a verbatim sentence' },
      rationale: 'the row stops at the happy path',
      fix: { description: 'tightened description' },
      reject_reason: '',
    }, extra || {});
    DATA.audits = [
      card('A001'),
      card('A002', { finding: 'mismatch', target: 'F02', fix: { name: 'corrected name', phase: 'Beta' } }),
      card('A003', { finding: 'missing', target: '', fix: { name: 'uncovered behavior', category: 'behavior' } }),
      card('A004', { kind: 'item', target: 'VI001', fix: { oracle: 'compare against ref-model' } }),
    ];
    render();
  });
}

test('the audit panel sits under each table and counts its findings', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);

  await expect(page.locator('h2', { hasText: 'Audit from AI' })).toHaveCount(1);   // feature tab
  await expect(page.locator('.sid', { hasText: 'A001' })).toBeVisible();
  await expect(page.locator('.sid', { hasText: 'A004' })).toHaveCount(0);          // that one is an item card

  await page.click('[data-tab="items"]');
  await expect(page.locator('h2', { hasText: 'Audit from AI' })).toHaveCount(1);
  await expect(page.locator('.sid', { hasText: 'A004' })).toBeVisible();
  await expect(page.locator('.sid', { hasText: 'A001' })).toHaveCount(0);
});

test('the audit panel is there before any audit has run, like the suggestion inbox', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  for (const tab of ['features', 'items']) {
    await page.click(`[data-tab="${tab}"]`);
    await expect(page.locator('h2', { hasText: 'Audit from AI' })).toHaveCount(1);
    await expect(page.locator('.panel-body', { hasText: 'No pending findings.' })).toBeVisible();
  }
});

test('accepting an insufficient finding edits the row in place and consumes the card', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);

  await page.click('[data-act="audit-accept"][data-i="0"]');
  const st = await page.evaluate(() => ({
    row: DATA.features.find(f => f.id === 'F01'),
    rows: DATA.features.length,
    aids: DATA.audits.map(a => a.aid),
  }));
  expect(st.rows).toBe(2);                                  // edited, not appended
  expect(st.row.description).toBe('tightened description');
  expect(st.row.name).toBe('first feature');                // untouched fields survive
  expect(st.aids).toEqual(['A002', 'A003', 'A004']);        // the card is gone, applied or not kept
});

test('accepting a missing finding adds a row with a fresh id, never the proposed one', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);
  await page.evaluate(() => { DATA.audits[2].fix.id = 'F99'; });   // a card must not choose its own id

  await page.click('[data-act="audit-accept"][data-i="2"]');
  const st = await page.evaluate(() => ({
    rows: DATA.features.length,
    last: DATA.features[DATA.features.length - 1],
    aids: DATA.audits.map(a => a.aid),
  }));
  expect(st.rows).toBe(3);
  expect(st.last.id).toBe('F03');
  expect(st.last.name).toBe('uncovered behavior');
  expect(st.last.status).toBe('editing');
  expect(st.aids).toEqual(['A001', 'A002', 'A004']);
});

test('a card whose target row is gone refuses to apply', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);
  await page.evaluate(() => { DATA.features = DATA.features.filter(f => f.id !== 'F01'); render(); });

  await page.click('[data-act="audit-accept"][data-i="0"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('찾을 수 없습니다'));
  expect(await page.evaluate(() => DATA.audits[0].status)).toBe('pending');
});

test('declining throws the card away, and neither outcome leaves a record', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);

  // Decline discards: the card is gone from the file, no status and no reason kept
  await page.click('[data-act="audit-decline"][data-i="1"]');
  expect(await page.evaluate(() => DATA.audits.map(a => a.aid))).toEqual(['A001', 'A003', 'A004']);
  expect(await page.evaluate(() => DATA.audits.some(a => a.status === 'rejected'))).toBe(false);
  expect(await page.evaluate(() => DATA.features.find(f => f.id === 'F02').name)).toBe('second feature');

  // accepting the next one also consumes it — audits[] only ever holds open findings
  await page.click('[data-act="audit-accept"][data-i="0"]');
  const st = await page.evaluate(() => ({
    aids: DATA.audits.map(a => a.aid),
    states: DATA.audits.map(a => a.status),
    row: DATA.features.find(f => f.id === 'F01'),
  }));
  expect(st.aids).toEqual(['A003', 'A004']);
  expect(st.states.every(x => x === 'pending')).toBe(true);
  expect(st.row.description).toBe('tightened description');   // the edit stays; the card does not
  await expect(page.locator('[data-act="audit-reopen"]')).toHaveCount(0);
  await expect(page.locator('.panel-head', { hasText: 'Audit from AI' })).not.toContainText('accepted');
});

test('lint reports pending findings and a card pointing at a row that is gone', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);
  const clean = await lint(page);
  expect(clean.join('\n')).toContain('audit findings pending review');

  await page.evaluate(() => { DATA.features = DATA.features.filter(f => f.id !== 'F01'); render(); });
  const broken = (await lint(page)).join('\n');
  expect(broken).toContain('audit card points at a row that does not exist');
  expect(broken).toContain('A001');
});

test('Refresh carries an audit target along with the row it renumbers', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);
  await page.evaluate(() => { DATA.features[0].id = 'F07'; DATA.audits[0].target = 'F07'; render(); });

  await page.click('[data-act="renumber"]');
  const st = await page.evaluate(() => ({ row: DATA.features[0].id, target: DATA.audits[0].target }));
  expect(st.row).toBe('F01');
  expect(st.target).toBe('F01');
});

test('only Accept and Decline are offered — no reject labels, no reject note', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);

  const card = page.locator('.sug').filter({ hasText: 'A001' });   // seed() also renders suggestion cards
  await expect(card.locator('[data-act="audit-accept"]')).toHaveCount(1);
  await expect(card.locator('[data-act="audit-decline"]')).toHaveCount(1);
  await expect(card.locator('.btn.sm')).toHaveCount(2);
  await expect(page.locator('[data-act="audit-reject"]')).toHaveCount(0);
  const head = page.locator('.panel-head', { hasText: 'Audit from AI' });
  await expect(head).not.toContainText('rejected');
  await expect(head).not.toContainText('accepted');
});

test('a snapshot shows audit findings but cannot act on them', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);
  await page.evaluate(() => { DATA.meta.snapshot = { at: '2026-09-02 10:00:00' }; render(); });

  await expect(page.locator('h2', { hasText: 'Audit from AI' })).toHaveCount(1);
  await expect(page.locator('[data-act="audit-accept"]').first()).toBeHidden();
  await expect(page.locator('[data-act="audit-decline"]').first()).toBeHidden();

  const before = await page.evaluate(() => DATA.features.find(f => f.id === 'F01').description);
  await page.evaluate(() => document.querySelector('[data-act="audit-accept"]').click());
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('수정할 수 없습니다'));
  expect(await page.evaluate(() => DATA.features.find(f => f.id === 'F01').description)).toBe(before);
});
