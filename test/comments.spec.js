import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openVplan, seed, lint, VPLAN_URL } from './helpers.js';

/* Review is two people passing the file back and forth, so the conversation is data: comments[]
   travels with the plan, shows in a rail down the right edge, and can be written on a snapshot —
   the one thing a frozen copy still accepts, because otherwise a reviewer cannot answer. */

async function writeComment(page, target, text, to = []) {
  await page.click(`[data-act="cmt"][data-target="${target}"]`);
  for (const name of to) await page.click(`[data-act="cmt-to"][data-name="${name}"]`);
  await page.fill('#cmt-text', text);
  await page.click('[data-act="cmt-add"]');
}

async function beMe(page, name) {
  const me = page.locator('[data-path="meta.me"]');   // the rail is always on screen
  await me.click();
  await me.evaluate((el, n) => { el.textContent = n; el.dispatchEvent(new Event('input', { bubbles: true })); }, name);
}

test('a comment lands on the row, in the rail, and in the saved file', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => { DATA.meta.people = ['jinsu.kim']; render(); });

  await writeComment(page, 'F01', 'oracle 이거 맞아?', ['jinsu.kim']);

  const thread = page.locator('.thread[data-thread="F01"]');
  await expect(thread).toHaveCount(1);
  await expect(thread.locator('.cmt-txt')).toHaveText('oracle 이거 맞아?');
  await expect(thread.locator('.cmt .mention')).toHaveText('@jinsu.kim');   // the card's chip, not the composer's roster
  await expect(page.locator('[data-act="cmt"][data-target="F01"] .cmt-n')).toHaveText('1');

  const saved = await page.evaluate(() => {
    const tag = '<script id="vplan-data" type="application/json">';
    const doc = serializeDoc();
    const at = doc.lastIndexOf(tag);
    return JSON.parse(doc.slice(at + tag.length, doc.indexOf('</scr' + 'ipt>', at)));
  });
  expect(saved.comments).toHaveLength(1);
  expect(saved.comments[0]).toMatchObject({ target: 'F01', author: 'nara.cho', to: ['jinsu.kim'], resolved: false });
  expect(saved.comments[0].cid).toBe('C001');
  expect(saved.meta.people).toEqual(['jinsu.kim']);
});

test('the rail shows open or resolved, one or the other', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');

  await writeComment(page, 'F01', 'still open');
  await writeComment(page, 'F02', 'about to be resolved');
  await page.click('[data-act="cmt-cancel"]');                    // an open composer pins its thread
  await expect(page.locator('.thread')).toHaveCount(2);

  await page.locator('.thread[data-thread="F02"] [data-act="cmt-resolve"]').click();
  await expect(page.locator('.thread[data-thread="F02"]')).toHaveCount(0);   // open is the default view
  await expect(page.locator('.thread[data-thread="F01"]')).toHaveCount(1);

  await page.click('[data-act="cmt-view"][data-view="resolved"]');
  await expect(page.locator('.thread[data-thread="F01"]')).toHaveCount(0);
  await expect(page.locator('.thread[data-thread="F02"] .cmt.done')).toHaveCount(1);

  await page.click('[data-act="cmt-view"][data-view="open"]');
  await expect(page.locator('.thread[data-thread="F01"]')).toHaveCount(1);
  await expect(page.locator('.thread[data-thread="F02"]')).toHaveCount(0);
  await expect(page.locator('[data-act="cmt-f-mine"]')).toHaveCount(0);      // the @me filter is gone
});

test('an open comment is a lint warning; resolving it clears the line', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await writeComment(page, 'F01', '이거 확인 필요');

  expect((await lint(page)).filter(l => /review comments are still open/.test(l))).toHaveLength(1);
  await page.locator('.thread[data-thread="F01"] [data-act="cmt-resolve"]').click();
  expect((await lint(page)).filter(l => /review comments are still open/.test(l))).toHaveLength(0);
});

test('a snapshot takes comments but still refuses to edit a row', async ({ page }) => {
  const src = fs.readFileSync(fileURLToPath(new URL(VPLAN_URL)), 'utf-8');
  const tag = '<script id="vplan-data" type="application/json">';
  const i = src.lastIndexOf(tag), j = src.indexOf('</script>', i);
  const data = JSON.parse(src.slice(i + tag.length, j));
  data.meta.snapshot = { at: '2026-09-01 10:30:00' };
  data.meta.people = ['nara.cho'];
  data.features = [{ id: 'F01', category: 'command', name: 'frozen row', description: 'd', phase: 'Alpha', status: 'editing', reviewed: false, notes: '' }];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vplan-')), 'snap.html');
  fs.writeFileSync(file, src.slice(0, i + tag.length) + '\n' + JSON.stringify(data, null, 2) + '\n' + src.slice(j));

  await page.goto('file://' + file);
  await page.waitForFunction(() => typeof DATA === 'object');
  await beMe(page, 'reviewer');
  await writeComment(page, 'F01', '여기 값이 이상해요');

  await expect(page.locator('.thread[data-thread="F01"] .cmt-txt')).toHaveText('여기 값이 이상해요');
  expect(await page.evaluate(() => DATA.meta.me)).toBe('reviewer');

  // the rows themselves are still frozen
  const cell = page.locator('[data-path="features.0.name"]');
  expect(await cell.getAttribute('contenteditable')).toBe('false');
  await page.evaluate(() => {
    const el = document.querySelector('[data-path="features.0.description"]');
    if (el) { el.textContent = 'hacked'; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  expect(await page.evaluate(() => DATA.features[0].description)).toBe('d');
});

test('the rail is always on screen, and the page is laid out beside it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await expect(page.locator('.rail')).toHaveCount(1);          // no toggle to forget
  expect(await page.evaluate(() => document.querySelector('#app').classList.contains('railed'))).toBe(true);

  const rail = await page.locator('.rail').boundingBox();
  const table = await page.locator('.panel table').first().boundingBox();
  expect(table.x + table.width).toBeLessThanOrEqual(rail.x + 1);   // the rail never covers a row

  await page.evaluate(() => render());
  await expect(page.locator('.rail')).toHaveCount(1);          // and it survives a re-render
});

test('a name can be taken off the tag roster; comments already written keep it', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => { DATA.meta.people = ['jinsu.kim', 'leaving.soon']; render(); });

  await writeComment(page, 'F01', '확인 부탁', ['leaving.soon']);
  await expect(page.locator('.cmp-to .men')).toHaveCount(2);

  await page.click('[data-act="cmt-person-del"][data-name="leaving.soon"]');
  await expect(page.locator('.cmp-to .men')).toHaveCount(1);
  expect(await page.evaluate(() => DATA.meta.people)).toEqual(['jinsu.kim']);
  // the comment that already tagged them is untouched — it is a record of what was said
  expect(await page.evaluate(() => DATA.comments[0].to)).toEqual(['leaving.soon']);
  await expect(page.locator('.thread[data-thread="F01"] .cmt .mention')).toHaveText('@leaving.soon');
});

test('the table stays inside its panel beside the rail, header and body aligned', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  for (const width of [1180, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['features', 'items']) {
      await page.click(`[data-tab="${tab}"]`);
      const m = await page.evaluate(() => {
        const t = document.querySelector('.panel.stick table');
        const panel = document.querySelector('.panel.stick');
        const rail = document.querySelector('.rail');
        const lefts = sel => [...t.querySelectorAll(sel)].map(e => Math.round(e.getBoundingClientRect().left));
        return {
          th: lefts('thead th'),
          td: lefts('tbody tr.row:first-of-type > td'),
          spill: t.getBoundingClientRect().right - panel.getBoundingClientRect().right,
          overRail: t.getBoundingClientRect().right - rail.getBoundingClientRect().left,
        };
      });
      expect(m.th, `${tab} @${width}px`).toEqual(m.td);     // a column header sits over its column
      expect(m.spill, `${tab} @${width}px`).toBeLessThanOrEqual(1);   // and the table inside its panel
      expect(m.overRail, `${tab} @${width}px`).toBeLessThanOrEqual(1);
    }
  }
});
