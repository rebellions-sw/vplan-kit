import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* ↑ / ↓ beside 복제 / 삭제 move a row one step in the list. The array order IS the order on screen,
   so a move is a swap saved with the document like any other edit. */

async function rows(page, arr) {
  return page.evaluate(a => DATA[a].map(r => r.id), arr);
}
async function five(page) {
  await page.evaluate(() => {
    DATA.features = ['F01', 'F02', 'F03', 'F04', 'F05'].map((id, n) => ({
      id, category: n % 2 ? 'behavior' : 'command', name: 'row ' + n, description: '',
      phase: 'Alpha', status: 'editing', reviewed: false, notes: '',
    }));
    render();
  });
}

test('a row moves one step up and one step down', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await five(page);

  await page.click('[data-act="move"][data-arr="features"][data-i="2"][data-dir="-1"]');
  expect(await rows(page, 'features')).toEqual(['F01', 'F03', 'F02', 'F04', 'F05']);

  await page.click('[data-act="move"][data-arr="features"][data-i="1"][data-dir="1"]');
  expect(await rows(page, 'features')).toEqual(['F01', 'F02', 'F03', 'F04', 'F05']);
});

test('the ends are disabled instead of doing nothing', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await five(page);

  await expect(page.locator('[data-act="move"][data-arr="features"][data-i="0"][data-dir="-1"]')).toBeDisabled();
  await expect(page.locator('[data-act="move"][data-arr="features"][data-i="0"][data-dir="1"]')).toBeEnabled();
  await expect(page.locator('[data-act="move"][data-arr="features"][data-i="4"][data-dir="1"]')).toBeDisabled();
});

test('with a filter on, a move swaps the rows you can actually see', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await five(page);
  // only the command rows are visible: F01, F03, F05
  await page.evaluate(() => { FILTER.features = { category: 'command' }; render(); });

  await page.click('[data-act="move"][data-arr="features"][data-i="2"][data-dir="1"]');
  // F03 and F05 traded places; F02/F04, hidden between them, did not move
  expect(await rows(page, 'features')).toEqual(['F01', 'F02', 'F05', 'F04', 'F03']);
});

test('items reorder the same way, and the order is what gets saved', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    DATA.items = ['VI001', 'VI002'].map(id => ({
      id, category: 'behavior', name: id, description: '', feature_refs: [], oracle: '',
      judged_by: [], stimulus: 'directed', status: 'editing', phase: 'Alpha',
      implemented: 'todo', reviewed: false, notes: '',
    }));
    render();
  });
  await page.click('[data-tab="items"]');

  await page.click('[data-act="move"][data-arr="items"][data-i="0"][data-dir="1"]');
  expect(await rows(page, 'items')).toEqual(['VI002', 'VI001']);

  const saved = await page.evaluate(() => serializeDoc());
  const tag = '<script id="vplan-data" type="application/json">';
  const at = saved.lastIndexOf(tag);
  const data = JSON.parse(saved.slice(at + tag.length, saved.indexOf('</scr' + 'ipt>', at)));
  expect(data.items.map(i => i.id)).toEqual(['VI002', 'VI001']);
});

test('a snapshot cannot reorder rows', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await five(page);
  await page.evaluate(() => { DATA.meta.snapshot = { at: '2026-09-02 10:00:00' }; render(); });

  await page.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.act = 'move'; b.dataset.arr = 'features'; b.dataset.i = '1'; b.dataset.dir = '-1';
    document.querySelector('#app').appendChild(b); b.click();
  });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('수정할 수 없습니다'));
  expect(await rows(page, 'features')).toEqual(['F01', 'F02', 'F03', 'F04', 'F05']);
});
