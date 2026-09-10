import { test, expect } from '@playwright/test';
import { openVplan, seed } from './helpers.js';

/* A plan can carry a testbench diagram in meta.topology. It renders under Input Source as a fold,
   and it is the one place the document embeds markup — so it is sanitised on every render. */

const SVG = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="98" height="38"/><text x="8" y="24">TB</text></svg>';

test('no topology, no block', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await expect(page.locator('[data-act="topo"]')).toHaveCount(0);
});

test('the fold sits under Input Source and opens and closes', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(s => { DATA.meta.topology = s; render(); }, SVG);

  const head = page.locator('[data-act="topo"]');
  await expect(head).toHaveCount(1);
  await expect(page.locator('.topo-body')).toHaveCount(0);        // closed by default

  // it is below the Input Source box and above the tabs
  const src = await page.locator('.srcbox').boundingBox();
  const topo = await head.boundingBox();
  const tabs = await page.locator('.tabs').boundingBox();
  expect(topo.y).toBeGreaterThan(src.y + src.height - 1);
  expect(topo.y).toBeLessThan(tabs.y);

  await head.click();
  await expect(page.locator('.topo-body svg')).toHaveCount(1);
  await head.click();
  await expect(page.locator('.topo-body')).toHaveCount(0);
});

test('the embedded markup is sanitised', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(() => {
    window.__ran = false;
    DATA.meta.topology = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
      + '<script>window.__ran = true;</scr' + 'ipt>'
      + '<rect width="10" height="10" onclick="window.__ran = true"/>'
      + '<image href="https://example.com/x.png"/>'
      + '<use href="#ok"/></svg>';
    render();
  });
  await page.click('[data-act="topo"]');

  const body = page.locator('.topo-body');
  await expect(body.locator('script')).toHaveCount(0);          // element dropped
  await expect(body.locator('image')).toHaveCount(0);           // not on the allowlist
  expect(await body.locator('rect').getAttribute('onclick')).toBeNull();
  expect(await body.locator('use').getAttribute('href')).toBe('#ok');   // same-document ref survives
  await body.locator('rect').click();
  expect(await page.evaluate(() => window.__ran)).toBe(false);
});

test('the diagram is document content — it round-trips through a save', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(s => { DATA.meta.topology = s; render(); }, SVG);

  const saved = await page.evaluate(() => serializeDoc());
  const tag = '<script id="vplan-data" type="application/json">';
  const at = saved.lastIndexOf(tag);
  const data = JSON.parse(saved.slice(at + tag.length, saved.indexOf('</scr' + 'ipt>', at)));
  expect(data.meta.topology).toBe(SVG);
  expect(saved).toMatch(/<div id="app"><\/div>/);      // the rendered fold itself is not baked in
});

test('a snapshot can still read the diagram', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(s => { DATA.meta.topology = s; DATA.meta.snapshot = { at: '2026-09-15 10:00:00' }; render(); }, SVG);
  await page.click('[data-act="topo"]');
  await expect(page.locator('.topo-body svg')).toHaveCount(1);
});

test('clicking the drawing opens it full-screen, Escape and a click close it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(s => { DATA.meta.topology = s; render(); }, SVG);
  await page.click('[data-act="topo"]');

  const small = await page.locator('.topo-body svg').boundingBox();
  await page.locator('.topo-body svg').click();
  const lens = page.locator('.topo-lens');
  await expect(lens).toHaveCount(1);
  const big = await lens.locator('svg').boundingBox();
  expect(big.width).toBeGreaterThan(small.width);          // the point of the click

  await page.keyboard.press('Escape');
  await expect(lens).toHaveCount(0);
  await expect(page.locator('.topo-body svg')).toHaveCount(1);   // the fold stays open

  await page.locator('.topo-body svg').click();
  await expect(page.locator('.topo-lens')).toHaveCount(1);
  await page.locator('.topo-lens').click({ position: { x: 6, y: 6 } });
  await expect(page.locator('.topo-lens')).toHaveCount(0);
});

test('the zoom is a view, not content — folding closes it and a save never carries it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(s => { DATA.meta.topology = s; render(); }, SVG);
  await page.click('[data-act="topo"]');
  await page.locator('.topo-body svg').click();
  await expect(page.locator('.topo-lens')).toHaveCount(1);

  const saved = await page.evaluate(() => serializeDoc());
  expect(saved).toMatch(/<div id="app"><\/div>/);          // nothing rendered is baked in

  // the overlay covers the fold header, so drive the header the way nothing but a test can
  await page.evaluate(() => document.querySelector('[data-act="topo"]').click());   // fold shut
  await expect(page.locator('.topo-lens')).toHaveCount(0);
  await page.click('[data-act="topo"]');                   // and it does not come back open
  await expect(page.locator('.topo-body')).toHaveCount(1);
  await expect(page.locator('.topo-lens')).toHaveCount(0);
});

test('a snapshot can zoom too — looking is not editing', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await page.evaluate(s => { DATA.meta.topology = s; DATA.meta.snapshot = { at: '2026-09-15 10:00:00' }; render(); }, SVG);
  await page.click('[data-act="topo"]');
  await page.locator('.topo-body svg').click();
  await expect(page.locator('.topo-lens svg')).toHaveCount(1);
});
