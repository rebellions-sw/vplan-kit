import { test, expect } from '@playwright/test';
import { openVplan, data, setCell, patch , seed} from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('loads with no console or page errors', async ({ page }) => {
  const errors = await openVplan(page);
  await seed(page);
  expect(errors).toEqual([]);
});

test('every tab renders at least one panel', async ({ page }) => {
  const errors = await openVplan(page);
  await seed(page);
  const tabs = await page.$$eval('.tab', els => els.map(e => e.dataset.tab));
  expect(tabs).toEqual(['features', 'items', 'testcases', 'coverage']);
  for (const t of tabs) {
    await page.click(`[data-tab="${t}"]`);
    await expect(page.locator('#tabbody .panel').first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('editing a cell writes through to DATA and raises the unsaved flag', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await expect(page.locator('#dirty')).not.toHaveClass(/on/);
  await setCell(page, 'meta.owner', 'tester');
  expect((await data(page)).meta.owner).toBe('tester');
  await expect(page.locator('#dirty')).toHaveClass(/on/);
});

test('the IP name is editable from the title bar', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await setCell(page, 'meta.ip_name', 'RBL_NPU');
  expect((await data(page)).meta.ip_name).toBe('RBL_NPU');
});

const ARRAYS = [
  ['features', 'features', 'feature'],
  ['testcases', 'testcases', 'testcase'],
  ['coverage', 'coverage.functional', 'covergroup'],
  ['coverage', 'coverage.assertions', 'assertion'],
];

for (const [tab, arr] of ARRAYS) {
  test(`add / duplicate / delete rows in ${arr}`, async ({ page }) => {
    const errors = await openVplan(page);
  await seed(page);
    page.on('dialog', d => d.accept());
    await page.click(`[data-tab="${tab}"]`);
    const len = async () => (await data(page)) && page.evaluate(a => a.split('.').reduce((o, k) => o[k], DATA).length, arr);

    const n0 = await len();
    await page.click(`[data-act="add"][data-arr="${arr}"]`);
    expect(await len()).toBe(n0 + 1);

    // the new row got a fresh, non-colliding ID
    const ids = await page.evaluate(a => a.split('.').reduce((o, k) => o[k], DATA).map(x => x.id), arr);
    expect(new Set(ids).size).toBe(ids.length);

    await page.click(`[data-act="dup"][data-arr="${arr}"][data-i="0"]`);
    expect(await len()).toBe(n0 + 2);

    await page.locator(`[data-act="del"][data-arr="${arr}"]`).last().click();
    await page.waitForFunction(([a, n]) => a.split('.').reduce((o, k) => o[k], DATA).length === n, [arr, n0 + 1]);
    expect(errors).toEqual([]);
  });
}

test('a row can be dragged into a new order, and that order is what gets saved', async ({ page, browser }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => { DATA.items = []; render(); });   // this test builds its own items
  await page.click('[data-tab="items"]');
  for (let i = 0; i < 3; i++) await page.click('[data-act="add"][data-arr="items"]');
  for (const [i, name] of [[0, 'first'], [1, 'second'], [2, 'third']]) await setCell(page, `items.${i}.name`, name);

  const rows = page.locator('#tabbody tbody tr.row');
  await rows.nth(2).scrollIntoViewIfNeeded();      // each item spans four rows; the third can sit below the fold
  const box = await rows.nth(2).boundingBox();
  // grab the first row by its grip and drop it below the last one
  await rows.nth(0).locator('.grip').dragTo(rows.nth(2), { targetPosition: { x: 20, y: box.height - 3 } });
  expect((await data(page)).items.map(i => i.name)).toEqual(['second', 'third', 'first']);

  // the new order is the array order, so it comes back with the saved file
  const html = await page.evaluate(() => serializeDoc());
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vplan-')), 'saved.html');
  fs.writeFileSync(tmp, html);
  const page2 = await browser.newPage();
  await page2.goto('file://' + tmp);
  await page2.waitForFunction(() => typeof DATA === 'object');
  expect((await data(page2)).items.map(i => i.name)).toEqual(['second', 'third', 'first']);
  await page2.close();
});

test('a row cannot be dragged into a different table', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="items"]');
  await page.click('[data-act="add"][data-arr="items"]');
  await page.click('[data-tab="coverage"]');
  await page.click('[data-act="add"][data-arr="coverage.functional"]');
  await page.click('[data-act="add"][data-arr="coverage.assertions"]');
  const before = await data(page);
  const cg = page.locator('#tabbody tbody tr.row').first();
  const sva = page.locator('#tabbody tbody tr.row').last();
  await cg.locator('.grip').dragTo(sva);
  const after = await data(page);
  expect(after.coverage.functional.length).toBe(before.coverage.functional.length);
  expect(after.coverage.assertions.length).toBe(before.coverage.assertions.length);
});

test('a feature and a verification item can be linked from either side, several at a time', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => { DATA.items = []; render(); });   // this test builds its own items
  await page.click('[data-tab="items"]');
  for (let i = 0; i < 3; i++) await page.click('[data-act="add"][data-arr="items"]');
  const refs = async () => (await data(page)).items.map(i => i.id + ':' + (i.feature_refs || []).join('/'));
  // the link widgets live on their own row now, so address them by owner rather than by position
  const picker = owner => page.locator(`select[data-pick][data-owner="${owner}"]`);
  const chips  = owner => page.locator(`.reflink:has([data-owner="${owner}"])`);

  // from the item side
  await picker('VI001').selectOption('F01');
  expect(await refs()).toEqual(['VI001:F01', 'VI002:', 'VI003:']);

  // from the feature side — same stored list, written from the other end
  await page.click('[data-tab="features"]');
  await picker('F01').selectOption('VI002');
  expect(await refs()).toEqual(['VI001:F01', 'VI002:F01', 'VI003:']);
  await expect(chips('F01')).toHaveText(['VI001×', 'VI002×']);

  // the × on a chip drops that link, from either side
  await chips('F01').first().locator('.x').click();
  expect(await refs()).toEqual(['VI001:', 'VI002:F01', 'VI003:']);

  // one item may serve several features
  await page.click('[data-tab="items"]');
  await picker('VI002').selectOption('F02');
  expect((await data(page)).items[1].feature_refs.sort()).toEqual(['F01', 'F02']);
});

test('Refresh renumbers ids in list order and carries every reference with them', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.features = [
      { id: 'F07', name: 'a', category: '', description: '', phase: 'pre-Alpha', status: 'editing', reviewed: false, notes: '' },
      { id: 'F02', name: 'b', category: '', description: '', phase: 'pre-Alpha', status: 'editing', reviewed: false, notes: '' },
    ];
    D.items = [
      { id: 'VI009', name: 'x', feature_refs: ['F07'], oracle: '', judged_by: [], stimulus: 'directed', status: 'editing', phase: 'pre-Alpha', implemented: 'todo', reviewed: false, category: '', description: '', notes: '' },
      { id: 'VI003', name: 'y', feature_refs: ['F02', 'F07'], oracle: '', judged_by: [], stimulus: 'directed', status: 'editing', phase: 'pre-Alpha', implemented: 'todo', reviewed: false, category: '', description: '', notes: '' },
    ];
    D.suggestions = [{ sid: 'S1', kind: 'feature', status: 'accepted', accepted_as: 'F07', confidence: 'high',
                       created: '2026-08-28', source: {}, rationale: '', payload: {}, reject_reason: '' }];
  });

  await page.click('[data-act="renumber"]');
  const d = await data(page);
  expect(d.features.map(f => f.id)).toEqual(['F01', 'F02']);
  expect(d.items.map(i => i.id)).toEqual(['VI001', 'VI002']);
  // F07 became F01 while F02 kept its id — the references must follow, without colliding
  expect(d.items[0].feature_refs).toEqual(['F01']);
  expect(d.items[1].feature_refs).toEqual(['F02', 'F01']);
  expect(d.suggestions[0].accepted_as).toBe('F01');
});
