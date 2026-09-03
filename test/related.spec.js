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

test('the picker offers only command features, never the row itself', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);

  const opts = await page.locator('select[data-pick="rel"][data-owner="F01"] option').allTextContents();
  expect(opts.filter(o => o.startsWith('F')).map(o => o.split(' ')[0])).toEqual(['F02', 'F03']);

  const own = await page.locator('select[data-pick="rel"][data-owner="F02"] option').allTextContents();
  expect(own.join()).not.toContain('F02');       // not itself
  expect(own.join()).not.toContain('F01');       // not a behavior feature
});

test('picking one adds a chip, and the × removes it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);

  await page.selectOption('select[data-pick="rel"][data-owner="F01"]', 'F03');
  expect(await page.evaluate(() => DATA.features[0].related_refs)).toEqual(['F03']);
  expect(await page.evaluate(() => DATA.features[2].related_refs)).toEqual([]);   // one-way

  // the chip's id opens the peek drawer; its × unlinks
  await page.click('[data-act="peek"][data-id="F03"]');
  await expect(page.locator('.peek-pane')).toContainText('another command');
  await page.keyboard.press('Escape');

  await page.click('[data-act="unlink"][data-kind="rel"][data-owner="F01"][data-id="F03"]');
  expect(await page.evaluate(() => DATA.features[0].related_refs)).toEqual([]);
});

test('Verified by and Related to sit side by side, halving the row', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);

  const half = page.locator('.halfrow').first();
  await expect(half).toContainText('Verified by');
  await expect(half).toContainText('Related to');
  const [a, b] = await half.locator(':scope > .field').all();
  const boxA = await a.boundingBox(), boxB = await b.boundingBox();
  expect(boxB.x).toBeGreaterThan(boxA.x + boxA.width - 20);       // side by side, not stacked
  expect(Math.abs(boxA.width - boxB.width)).toBeLessThan(20);      // and roughly equal halves
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

test('chips read as names, with the id in the tooltip and a fallback when there is none', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await threeFeatures(page);
  await page.selectOption('select[data-pick="rel"][data-owner="F01"]', 'F02');

  const chip = page.locator('[data-act="peek"][data-id="F02"]');
  await expect(chip).toHaveText('a command');                 // the name, not F02
  await expect(chip).toHaveAttribute('title', /^F02/);         // the id is still one hover away

  await page.evaluate(() => { DATA.features[1].name = '   '; render(); });
  await expect(page.locator('[data-act="peek"][data-id="F02"]')).toHaveText('F02');   // never blank
});

test("an item's Link to chips stay ids", async ({ page }) => {
  await openVplan(page);
  await seed(page);            // VI001 links F01 "first feature"
  await page.click('[data-tab="items"]');

  const chip = page.locator('[data-act="peek"][data-id="F01"]');
  await expect(chip).toHaveText('F01');
  await expect(chip).toHaveAttribute('title', /^F01/);
});
