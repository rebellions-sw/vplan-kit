import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* A keyword box beside the link filters. It reads every string the row stores, narrows with each word,
   and composes with the other filters. Typing must not cost the caret. */

const SEARCH = '[data-search="features"]';
const shown = page => page.$$eval('tr.row .cell.id', els => els.map(e => e.textContent.trim()));

async function rows(page) {
  await page.evaluate(() => {
    DATA.features = [
      { id:'F01', category:'behavior', name:'L0 TLB miss handling', description:'issues an ATQ request',
        related_refs:[], phase:'pre-Alpha', status:'editing', reviewed:false, notes:'' },
      { id:'F02', category:'command',  name:'Fetch command', description:'',
        related_refs:[], phase:'Alpha', status:'editing', reviewed:false, notes:'merge rule lives here' },
      { id:'F03', category:'behavior', name:'Invalidation completion', description:'gating on CPL',
        related_refs:[], phase:'Alpha', status:'editing', reviewed:false, notes:'' },
    ];
    DATA.items = [];
    render();
  });
}

test('a keyword narrows the list, and every stored string is searchable', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await rows(page);

  await page.fill(SEARCH, 'tlb');                       // name, case-insensitive
  expect(await shown(page)).toEqual(['F01']);

  await page.fill(SEARCH, 'merge');                     // notes
  expect(await shown(page)).toEqual(['F02']);

  await page.fill(SEARCH, 'atq request');               // description
  expect(await shown(page)).toEqual(['F01']);

  await page.fill(SEARCH, 'command');                   // category value
  expect(await shown(page)).toEqual(['F02']);

  await page.fill(SEARCH, 'F03');                       // the id itself
  expect(await shown(page)).toEqual(['F03']);

  await page.fill(SEARCH, '');
  expect(await shown(page)).toEqual(['F01', 'F02', 'F03']);
});

test('several words all have to match, in any field and any order', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await rows(page);

  await page.fill(SEARCH, 'invalidation gating');
  expect(await shown(page)).toEqual(['F03']);

  await page.fill(SEARCH, 'gating invalidation');        // order does not matter
  expect(await shown(page)).toEqual(['F03']);

  await page.fill(SEARCH, 'invalidation merge');         // one word missing → nothing
  expect(await shown(page)).toEqual([]);
});

test('typing keeps the caret in the box', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await rows(page);

  await page.click(SEARCH);
  await page.keyboard.type('tlb');
  expect(await page.evaluate(() => document.activeElement.dataset.search)).toBe('features');
  expect(await page.evaluate(() => document.activeElement.selectionStart)).toBe(3);

  // and a caret in the middle survives a keystroke
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('X');
  expect(await page.inputValue(SEARCH)).toBe('tlXb');
  expect(await page.evaluate(() => document.activeElement.selectionStart)).toBe(3);
});

test('search composes with the other filters, and clear filter drops it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await rows(page);

  await page.fill(SEARCH, 'a');                                     // matches all three
  await page.selectOption('select[data-filter="features"][data-key="category"]', 'behavior');
  expect(await shown(page)).toEqual(['F01', 'F03']);

  await expect(page.locator('.panel-head', { hasText: 'Feature list' })).toContainText('filtered: 2 / 3');
  await page.click('[data-act="filter-clear"][data-arr="features"]');
  expect(await page.inputValue(SEARCH)).toBe('');
  expect(await shown(page)).toEqual(['F01', 'F02', 'F03']);
});

test('the keyword is UI state and never reaches the file', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await rows(page);
  await page.fill(SEARCH, 'tlb');

  const saved = await page.evaluate(() => serializeDoc());
  const tag = '<script id="vplan-data" type="application/json">';
  const at = saved.lastIndexOf(tag);
  const data = JSON.parse(saved.slice(at + tag.length, saved.indexOf('</scr' + 'ipt>', at)));
  expect(JSON.stringify(data)).not.toContain('tlb');
  expect(data.features.length).toBe(3);
});
