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

test('an open comment is counted in the rail, not in lint', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await writeComment(page, 'F01', '이거 확인 필요');

  await expect(page.locator('.rail-head .badge').first()).toHaveText('1 open');
  expect((await lint(page)).filter(l => /review comments/.test(l))).toHaveLength(0);

  await page.locator('.thread[data-thread="F01"] [data-act="cmt-resolve"]').click();
  await expect(page.locator('.rail-head .badge').first()).toHaveText('0 open');
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

test('replying starts from the comment itself, beside 해결 and 삭제', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await writeComment(page, 'F01', '여기 확인해줘');
  await page.click('[data-act="cmt-cancel"]');                 // close the composer

  const acts = page.locator('.thread[data-thread="F01"] .cmt .cmt-acts .btn');
  await expect(acts).toHaveText(['답변', '해결', '삭제']);
  await expect(page.locator('.th-head .btn')).toHaveCount(0);  // the head's ＋ is gone

  await acts.first().click();
  await expect(page.locator('.thread[data-thread="F01"] .composer')).toHaveCount(1);
  await page.fill('#cmt-text', '확인했어');
  await page.click('[data-act="cmt-add"]');
  await expect(page.locator('.thread[data-thread="F01"] .cmt-txt')).toHaveText(['여기 확인해줘', '확인했어']);
});

test('the rail scrolls instead of squashing its threads', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => {
    const long = '줄바꿈이 섞인 긴 코멘트\n'.repeat(12);
    DATA.comments = Array.from({ length: 12 }, (_, i) => ({
      cid: 'C' + String(i + 1).padStart(3, '0'), target: i % 2 ? 'F01' : 'F02',
      author: 'nara.cho', to: [], text: long, created: '2026-09-16 10:00:00', resolved: false,
    }));
    DATA.comments.forEach(c => THOPEN.add(c.target));    // threads are folded by default
    render();
  });

  const m = await page.evaluate(() => {
    const body = document.querySelector('.rail-body');
    const clipped = [...document.querySelectorAll('.thread')]
      .filter(t => t.scrollHeight > t.getBoundingClientRect().height + 1).length;
    return { scrolls: body.scrollHeight > body.clientHeight, clipped };
  });
  expect(m.clipped).toBe(0);      // nothing is cut off inside its own box
  expect(m.scrolls).toBe(true);   // the body carries the overflow

  // and it really scrolls
  await page.evaluate(() => { document.querySelector('.rail-body').scrollTop = 99999; });
  expect(await page.evaluate(() => document.querySelector('.rail-body').scrollTop)).toBeGreaterThan(0);
});

test('opening a thread shows its comments in full, and what you write opens its thread', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => {
    DATA.comments = [{ cid: 'C001', target: 'F01', author: 'jinsu.kim', to: [],
      text: '첫 줄 요약\n두 번째 줄도 함께 보여야 한다', created: '2026-09-16 10:00:00', resolved: false }];
    render();
  });

  await expect(page.locator('.thread .cmt')).toHaveCount(0);      // one line per thread
  await page.click('.th-fold');
  await expect(page.locator('.thread .cmt-txt')).toHaveText('첫 줄 요약\n두 번째 줄도 함께 보여야 한다');
  await expect(page.locator('.thread .cmt-acts .btn')).toHaveText(['답변', '해결', '삭제']);

  await writeComment(page, 'F02', '내가 쓴 것');
  await expect(page.locator('.thread[data-thread="F02"] .cmt-txt')).toHaveText('내가 쓴 것');
});

test('a thread is one line until opened, and the rail lists every target', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => {
    DATA.comments = [
      { cid: 'C001', target: 'F01', author: 'a', to: [], text: 'one', created: '2026-09-16 10:00:00', resolved: false },
      { cid: 'C002', target: 'F01', author: 'a', to: [], text: 'two', created: '2026-09-16 10:01:00', resolved: false },
      { cid: 'C003', target: 'plan', author: 'a', to: [], text: 'three', created: '2026-09-16 10:02:00', resolved: false },
    ];
    render();
  });

  await expect(page.locator('.thread')).toHaveCount(2);      // F01 and plan, one line each
  await expect(page.locator('.thread .cmt')).toHaveCount(0);
  expect(await page.$$eval('.th-n', els => els.map(e => e.textContent.trim()))).toEqual(['1', '2']);

  await page.click('.thread[data-thread="F01"] .th-fold');
  await expect(page.locator('.thread[data-thread="F01"] .cmt')).toHaveCount(2);
  await expect(page.locator('.thread[data-thread="plan"] .cmt')).toHaveCount(0);

  await page.click('.thread[data-thread="F01"] .th-fold');
  await expect(page.locator('.thread .cmt')).toHaveCount(0);
});

test('a comment can mention a row, and Refresh rewrites the mention', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => {
    DATA.comments = [{ cid: 'C001', target: 'plan', author: 'a', to: [],
      text: '#F02 와 #VI001 은 같이 봐야 함, #TC900 은 없는 행', created: '2026-09-16 10:00:00', resolved: false }];
    THOPEN.add('plan');
    render();
  });

  const tags = page.locator('.cmt-txt .rowtag');
  await expect(tags).toHaveText(['F02', 'VI001', 'TC900']);
  await expect(page.locator('.cmt-txt .rowtag.gone')).toHaveText('TC900');   // no such row

  // a feature mention opens the drawer on that feature
  await tags.first().click();
  await expect(page.locator('.peek-pane .sid')).toHaveText('F02');
  await page.click('[data-act="peek-close"]');

  // Refresh renumbers rows and carries the mentions with it
  await page.evaluate(() => { DATA.features.reverse(); render(); });   // F02 now sits first
  await page.click('[data-act="renumber"]');
  expect(await page.evaluate(() => DATA.comments[0].text)).toContain('#F01');
  expect(await page.evaluate(() => DATA.comments[0].text)).toContain('#VI001');
  expect(await page.evaluate(() => DATA.comments[0].text)).toContain('#TC900');
});

test('a reply lands under the comment it answers, not at the end of the thread', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await beMe(page, 'nara.cho');
  await page.evaluate(() => {
    DATA.comments = [
      { cid: 'C001', target: 'plan', author: 'a', to: [], text: '첫째', created: '2026-09-16 10:00:00', resolved: false },
      { cid: 'C002', target: 'plan', author: 'a', to: [], text: '둘째', created: '2026-09-16 10:01:00', resolved: false },
      { cid: 'C003', target: 'plan', author: 'a', to: [], text: '셋째', created: '2026-09-16 10:02:00', resolved: false },
    ];
    THOPEN.add('plan');
    render();
  });

  // answer the first one
  await page.locator('.thread[data-thread="plan"] .cmt').first().locator('[data-act="cmt"]').click();
  await expect(page.locator('.cmp-reply')).toContainText('답변');
  await page.fill('#cmt-text', '첫째에 대한 답');
  await page.click('[data-act="cmt-add"]');

  const texts = await page.$$eval('.thread[data-thread="plan"] .cmt-txt', els => els.map(e => e.textContent.trim()));
  expect(texts).toEqual(['첫째', '첫째에 대한 답', '둘째', '셋째']);
  await expect(page.locator('.cmt.reply .cmt-txt')).toHaveText('첫째에 대한 답');
  expect(await page.evaluate(() => DATA.comments.find(c => c.text === '첫째에 대한 답').reply_to)).toBe('C001');

  // a second reply to the same comment stacks under the first
  await page.locator('.thread[data-thread="plan"] .cmt').first().locator('[data-act="cmt"]').click();
  await page.fill('#cmt-text', '첫째에 대한 답 2');
  await page.click('[data-act="cmt-add"]');
  expect(await page.$$eval('.thread[data-thread="plan"] .cmt-txt', els => els.map(e => e.textContent.trim())))
    .toEqual(['첫째', '첫째에 대한 답', '첫째에 대한 답 2', '둘째', '셋째']);

  // and a fresh comment from the row button still goes to the end
  await writeComment(page, 'plan', '맨 끝');
  expect(await page.$$eval('.thread[data-thread="plan"] .cmt-txt', els => els.map(e => e.textContent.trim())))
    .toEqual(['첫째', '첫째에 대한 답', '첫째에 대한 답 2', '둘째', '셋째', '맨 끝']);
});
