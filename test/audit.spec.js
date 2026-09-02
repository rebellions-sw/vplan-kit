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

test('accepting an insufficient finding edits the row in place and keeps its id', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);

  await page.click('[data-act="audit-accept"][data-i="0"]');
  const st = await page.evaluate(() => ({
    row: DATA.features.find(f => f.id === 'F01'),
    rows: DATA.features.length,
    card: DATA.audits[0],
  }));
  expect(st.rows).toBe(2);                                  // edited, not appended
  expect(st.row.description).toBe('tightened description');
  expect(st.row.name).toBe('first feature');                // untouched fields survive
  expect(st.card.status).toBe('accepted');
  expect(st.card.accepted_as).toBe('F01');
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
    card: DATA.audits[2],
  }));
  expect(st.rows).toBe(3);
  expect(st.last.id).toBe('F03');
  expect(st.last.name).toBe('uncovered behavior');
  expect(st.last.status).toBe('editing');
  expect(st.card.accepted_as).toBe('F03');
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

test('rejecting records the label, and reopening keeps what was already applied', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);

  await page.click('[data-act="audit-reject"][data-i="1"][data-k="waived"]');
  expect(await page.evaluate(() => DATA.audits[1].reject_kind)).toBe('waived');
  expect(await page.evaluate(() => DATA.features.find(f => f.id === 'F02').name)).toBe('second feature');

  await page.click('[data-act="audit-accept"][data-i="0"]');
  await page.click('[data-act="sug-group"][data-g="audit:feature:accepted"]');   // decided cards fold away
  await page.click('[data-act="audit-reopen"][data-i="0"]');
  const st = await page.evaluate(() => ({ card: DATA.audits[0], row: DATA.features.find(f => f.id === 'F01') }));
  expect(st.card.status).toBe('pending');
  expect(st.card.accepted_as).toBeUndefined();
  expect(st.row.description).toBe('tightened description');   // the edit is the user's now
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

test('a snapshot shows audit findings but cannot act on them', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await seedAudits(page);
  await page.evaluate(() => { DATA.meta.snapshot = { at: '2026-09-02 10:00:00' }; render(); });

  await expect(page.locator('h2', { hasText: 'Audit from AI' })).toHaveCount(1);
  await expect(page.locator('[data-act="audit-accept"]').first()).toBeHidden();

  const before = await page.evaluate(() => DATA.features.find(f => f.id === 'F01').description);
  await page.evaluate(() => document.querySelector('[data-act="audit-accept"]').click());
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('수정할 수 없습니다'));
  expect(await page.evaluate(() => DATA.features.find(f => f.id === 'F01').description)).toBe(before);
});
