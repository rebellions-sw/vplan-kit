import { test, expect } from '@playwright/test';
import { openVplan, seed, lint } from './helpers.js';

/* A feature row's link area is split in two: Verified by (the items) and Related to — other features,
   and only ones whose category is command. Stored one-way on the feature that points. */

async function threeFeatures(page) {
  await page.evaluate(() => {
    DATA.features = [
      { id:'F01', category:'behavior', name:'a behavior', description:'', related_refs:[], phase:'Alpha', status:'editing', reviewed:false, notes:'' },
      { id:'F02', category:'command',  name:'a command',  description:'', related_refs:[], phase:'Alpha', status:'editing', reviewed:false, notes:'' },
      { id:'F03', category:'command',  name:'another command', description:'', related_refs:[], phase:'Alpha', status:'editing', reviewed:false, notes:'' },
    ];
    DATA.items = [];
    render();
  });
}

test('the picker offers command features only, and command rows have no Related to at all', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);

  const opts = await page.locator('select[data-pick="rel"][data-owner="F01"] option').allTextContents();
  expect(opts.filter(o => o.startsWith('F')).map(o => o.split(' ')[0])).toEqual(['F02', 'F03']);

  // F02/F03 are command rows: they are what others point at, so the half is not rendered for them
  await expect(page.locator('select[data-pick="rel"][data-owner="F02"]')).toHaveCount(0);
  await expect(page.locator('select[data-pick="rel"][data-owner="F03"]')).toHaveCount(0);
  const rows = await page.locator('tr.subrow').filter({ hasText: 'Related to' }).count();
  expect(rows).toBe(1);                                  // only the behavior row has one
});

test('picking one adds a chip, and the × removes it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);

  await page.selectOption('select[data-pick="rel"][data-owner="F01"]', 'F03');
  expect(await page.evaluate(() => DATA.features[0].related_refs)).toEqual(['F03']);
  expect(await page.evaluate(() => DATA.features[2].related_refs)).toEqual([]);   // one-way

  // a Related-to chip is read, not chased: no peek button, and clicking it opens nothing
  await expect(page.locator('[data-act="peek"][data-id="F03"]')).toHaveCount(0);
  await page.locator('.reflink .peek.flat').filter({ hasText: 'another command' }).click();
  await expect(page.locator('.peek-pane')).toHaveCount(0);

  await page.click('[data-act="unlink"][data-kind="rel"][data-owner="F01"][data-id="F03"]');
  expect(await page.evaluate(() => DATA.features[0].related_refs)).toEqual([]);
});

test('Related to starts exactly where the Phase column starts', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);

  const sub = page.locator('tr.subrow').filter({ hasText: 'Related to' }).first();
  await expect(sub).toContainText('Verified by');
  const rel = await sub.locator('td', { hasText: 'Related to' }).boundingBox();
  const phase = await page.locator('thead th', { hasText: 'Phase' }).first().boundingBox();
  expect(Math.abs(rel.x - phase.x)).toBeLessThan(1.5);            // same column boundary

  // a command row has no second cell: Verified by spans the rest of the table
  const cmd = page.locator('tr.subrow').nth(1);
  await expect(cmd).not.toContainText('Related to');
});

test('lint flags a link that no longer points at a command feature, and a dangling one', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.selectOption('select[data-pick="rel"][data-owner="F01"]', 'F02');
  expect((await lint(page)).join('\n')).not.toContain('related-to link');

  await page.evaluate(() => { DATA.features[1].category = 'behavior'; render(); });
  expect((await lint(page)).join('\n')).toContain('related-to link does not point at a category command feature');

  await page.evaluate(() => { DATA.features[0].related_refs = ['F99']; render(); });
  expect((await lint(page)).join('\n')).toContain('F01→F99');
});

test('Refresh carries related-to links through renumbering', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.evaluate(() => { DATA.features[2].id = 'F09'; DATA.features[0].related_refs = ['F09']; render(); });

  await page.click('[data-act="renumber"]');
  expect(await page.evaluate(() => DATA.features[0].related_refs)).toEqual(['F03']);
});

test('a new feature row starts with an empty related list', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-act="add"][data-arr="features"]');
  const last = await page.evaluate(() => DATA.features[DATA.features.length - 1].related_refs);
  expect(last).toEqual([]);
});

test('a Related-to chip reads as the name, with the id in its tooltip', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.selectOption('select[data-pick="rel"][data-owner="F01"]', 'F02');

  const chip = page.locator('.reflink .peek.flat').first();
  await expect(chip).toHaveText('a command');                  // the name, not F02
  await expect(chip).toHaveAttribute('title', /^F02/);          // the id is still one hover away

  await page.evaluate(() => { DATA.features[1].name = '   '; render(); });
  await expect(page.locator('.reflink .peek.flat').first()).toHaveText('F02');   // never blank
});

test("Verified by and Link to chips are ids that open the drawer", async ({ page }) => {
  await openVplan(page);
  await seed(page);
  const vi = page.locator('[data-act="peek"][data-id="VI001"]');
  await expect(vi).toHaveText('VI001');                        // the id, not 'first item'
  await vi.click();
  await expect(page.locator('.peek-pane')).toContainText('first item');
});

test("an item's Link to chips stay ids", async ({ page }) => {
  await openVplan(page);
  await seed(page);            // VI001 links F01 "first feature"
  await page.click('[data-tab="items"]');

  const chip = page.locator('[data-act="peek"][data-id="F01"]');
  await expect(chip).toHaveText('F01');
  await expect(chip).toHaveAttribute('title', /^F01/);
});

test('the Feature list filters by related-to, the way it filters by verified-by', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.evaluate(() => {
    DATA.features.push({ id:'F04', category:'behavior', name:'another behavior', description:'',
      related_refs:['F03'], phase:'Alpha', status:'editing', reviewed:false, notes:'' });
    DATA.features[0].related_refs = ['F02'];
    render();
  });

  const shown = async () => page.$$eval('tr.row .cell.id', els => els.map(e => e.textContent.trim()));
  const sel = 'select[data-filter="features"][data-key="rel"]';

  // the options are the command features, listed by name
  expect(await page.locator(`${sel} option`).allTextContents()).toEqual(['all', '— none —', 'a command', 'another command']);

  await page.selectOption(sel, 'F02');
  expect(await shown()).toEqual(['F01']);

  await page.selectOption(sel, 'F03');
  expect(await shown()).toEqual(['F04']);

  await page.selectOption(sel, '__none__');
  expect(await shown()).toEqual(['F02', 'F03']);      // the command rows relate to nothing themselves

  await page.selectOption(sel, '');
  expect(await shown()).toEqual(['F01', 'F02', 'F03', 'F04']);
});

test('the related-to filter composes with the others rather than replacing them', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.evaluate(() => {
    DATA.features.push({ id:'F04', category:'parameter', name:'a parameter', description:'',
      related_refs:['F02'], phase:'Alpha', status:'editing', reviewed:false, notes:'' });
    DATA.features[0].related_refs = ['F02'];
    render();
  });

  await page.selectOption('select[data-filter="features"][data-key="rel"]', 'F02');
  await page.selectOption('select[data-filter="features"][data-key="category"]', 'behavior');
  expect(await page.$$eval('tr.row .cell.id', els => els.map(e => e.textContent.trim()))).toEqual(['F01']);
});

test('Refresh keeps an active related-to filter pointing at the same row', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.evaluate(() => { DATA.features[1].id = 'F08'; DATA.features[0].related_refs = ['F08']; render(); });
  await page.selectOption('select[data-filter="features"][data-key="rel"]', 'F08');

  await page.click('[data-act="renumber"]');
  expect(await page.evaluate(() => FILTER.features.rel)).toBe('F02');
  expect(await page.$$eval('tr.row .cell.id', els => els.map(e => e.textContent.trim()))).toEqual(['F01']);
});
