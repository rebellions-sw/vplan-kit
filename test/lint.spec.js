import { test, expect } from '@playwright/test';
import { openVplan, lint, patch , seed} from './helpers.js';

const hasError = lines => lines.some(l => l.startsWith('ERR'));
const matching = (lines, re) => lines.filter(l => re.test(l));

test('duplicate feature id is an error', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => D.features.push({ ...D.features[0] }));
  expect(matching(await lint(page), /^ERR .*duplicate id.*F01/)).toHaveLength(1);
});

test('a feature whose phase has arrived is judged as due; a later one only warns', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'pre-Alpha';
    D.features.push({ id: 'F90', name: 'orphan pre-alpha', phase: 'pre-Alpha', status: 'finalized' });
    D.features.push({ id: 'F91', name: 'orphan beta', phase: 'Beta', status: 'not started' });
  });
  const lines = await lint(page);
  expect(matching(lines, /^ERR FEATURE .*no verification item is linked.*F90/)).toHaveLength(1);   // due and uncovered
  expect(matching(lines, /F91/)).toHaveLength(0);                                  // a later phase is not linted
});

test('a due feature that is not finalized is an error, and the message names the phase', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    D.features.push({ id: 'F93', name: 'still editing', phase: 'Alpha', status: 'editing' });
    D.items.push({ id: 'VI93', feature_refs: ['F93'], oracle: 'scoreboard', status: 'finalized', phase: 'Alpha' });
  });
  const hit = matching(await lint(page), /^ERR FEATURE .*definition is not finalized/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('F93');
  expect(hit[0]).toContain('finalized');   // which phase made it due is shown on the panel head
});

test('a feature claimed by a verification item is no longer reported as uncovered', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'pre-Alpha';
    D.features.push({ id: 'F92', name: 'covered', phase: 'pre-Alpha', status: 'finalized', reviewed: true });
    D.items.push({ id: 'VI900', name: 'judges F92', feature_refs: ['F92'], oracle: 'scoreboard', status: 'finalized', phase: 'pre-Alpha', reviewed: true });
  });
  const lines = await lint(page);
  expect(matching(lines, /F92/)).toHaveLength(0);
});

test('a rejection with no label is a warning', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => { D.suggestions[2].status = 'rejected'; delete D.suggestions[2].reject_kind; });
  const hit = matching(await lint(page), /^WARN .*rejection has no label/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('S003');
});

test('a pending suggestion with no source quote is a warning', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => { D.suggestions[0].source.quote = ''; });
  const hit = matching(await lint(page), /^WARN .*pending suggestion has no quote/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('S001');
});

test('pending suggestions are surfaced as a warning so they are not forgotten', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => { D.suggestions[0].status = 'pending'; });
  expect(matching(await lint(page), /^WARN .*suggestions pending review/).length).toBe(1);
});
