import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openVplan, seed, VPLAN_URL } from './helpers.js';

/* Save's contract: it NEVER opens a picker. It POSTs the document to the local vplan-save helper
   (127.0.0.1:8790), and only falls back to a download if the helper is unreachable. Save As is the
   one deliberate picker, and what it writes is a dated SNAPSHOT — a fork that, reopened, has no Save
   buttons at all, only the stamp of when it was made. Nothing is remembered between sessions and
   nothing lives in browser storage. The tests stub both the picker and fetch — no real helper. */

/** Replace the OS picker with a fake that records every file it hands out and everything written to it. */
async function stubPicker(page) {
  await page.evaluate(() => {
    window.__picks = [];
    window.__writes = [];
    window.showSaveFilePicker = async ({ suggestedName }) => {
      const name = 'picked-' + (window.__picks.length + 1) + '-' + suggestedName;
      window.__picks.push(suggestedName);
      return {
        name,
        createWritable: async () => ({
          write: c => { window.__writes.push({ name, content: c }); },
          close: async () => {},
        }),
      };
    };
  });
}

/** Replace fetch with a fake helper that records every save posted to it. */
async function stubHelper(page, { ok = true, reject = false } = {}) {
  await page.evaluate(([ok, reject]) => {
    window.__fetches = [];
    window.fetch = async (url, opts) => {
      window.__fetches.push({ url: String(url), body: opts && opts.body });
      if (reject) throw new TypeError('Failed to fetch');
      return { ok, status: ok ? 200 : 500 };
    };
  }, [ok, reject]);
}

/* A click returns as soon as the event dispatches, but saveHtml is async — wait for the effect. */
async function saveViaHelper(page, expectedFetches) {
  await page.click('[data-act="save"]');
  await page.waitForFunction(n => window.__fetches.length === n, expectedFetches);
}
async function snapshotViaPicker(page, expectedWrites) {
  await page.click('[data-act="save-as"]');
  await page.waitForFunction(n => window.__writes.length === n, expectedWrites);
}

/** Write a snapshot-marked copy of the template to a temp dir, as Save As would. */
function makeSnapshotFile(at) {
  const src = fs.readFileSync(fileURLToPath(new URL(VPLAN_URL)), 'utf-8');
  const tag = '<script id="vplan-data" type="application/json">';
  const i = src.lastIndexOf(tag), j = src.indexOf('</script>', i);
  const data = JSON.parse(src.slice(i + tag.length, j));
  data.meta.snapshot = { at };
  const out = src.slice(0, i + tag.length) + '\n' + JSON.stringify(data, null, 2) + '\n' + src.slice(j);
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vplan-')), 'vplan_SNAP.html');
  fs.writeFileSync(p, out);
  return p;
}

test('Save never opens a picker — it posts to the local helper every time', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await stubPicker(page);
  await stubHelper(page);

  await saveViaHelper(page, 1);
  await saveViaHelper(page, 2);
  await saveViaHelper(page, 3);

  const { picks, fetches } = await page.evaluate(() => ({ picks: window.__picks, fetches: window.__fetches }));
  expect(picks).toEqual([]);                                            // no dialog, ever
  expect(fetches.length).toBe(3);
  for (const f of fetches) {
    expect(f.url).toBe('http://127.0.0.1:8790/save?name=vplan_template.html');
  }
});

test('Save As writes a dated snapshot and moves nothing — the next Save still goes to the helper', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await stubPicker(page);
  await stubHelper(page);

  await snapshotViaPicker(page, 1);
  await saveViaHelper(page, 1);

  const { picks, writes, fetches, live } = await page.evaluate(() => ({
    picks: window.__picks, writes: window.__writes, fetches: window.__fetches,
    live: DATA.meta.snapshot || null,
  }));
  expect(picks.length).toBe(1);
  expect(picks[0]).toMatch(/^vplan_template_\d{8}-\d{6}\.html$/);   // dated name steers off the original
  expect(writes[0].content).toContain('"snapshot"');                // the copy is marked...
  expect(live).toBeNull();                                          // ...the live document is not
  expect(fetches[0].body).not.toContain('"snapshot"');              // and neither is what Save writes
});

test('a cancelled Save As writes nothing, and Save is unaffected', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await stubPicker(page);
  await stubHelper(page);

  await page.evaluate(() => {
    window.__aborted = false;
    window.showSaveFilePicker = async () => {
      window.__aborted = true;
      const e = new Error('cancel'); e.name = 'AbortError'; throw e;
    };
  });
  await page.click('[data-act="save-as"]');
  await page.waitForFunction(() => window.__aborted === true);
  await saveViaHelper(page, 1);

  const writes = await page.evaluate(() => window.__writes);
  expect(writes.length).toBe(0);
});

test('the saved bytes are the serialized document, not the rendered page', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await stubHelper(page);
  await saveViaHelper(page, 1);
  const saved = await page.evaluate(() => window.__fetches[0].body);
  expect(saved.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(saved).toContain('"ip_name": "SEED"');
  expect(saved).not.toContain('class="sug"');     // no rendered DOM baked in
});

test('when the helper is unreachable, Save falls back to a download — still no picker', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await stubPicker(page);
  await stubHelper(page, { reject: true });
  await page.evaluate(() => {
    window.__dl = null;
    window.download = (name, content) => { window.__dl = { name, len: content.length }; };
  });

  await page.click('[data-act="save"]');
  await page.waitForFunction(() => window.__dl !== null);

  const { picks, dl } = await page.evaluate(() => ({ picks: window.__picks, dl: window.__dl }));
  expect(picks).toEqual([]);
  expect(dl.name).toBe('vplan_template.html');
  expect(dl.len).toBeGreaterThan(0);
});

test('a snapshot reopened has no Save buttons — the stamp sits where they were', async ({ page }) => {
  const snap = makeSnapshotFile('2026-09-01 10:30:00');
  await page.goto('file://' + snap);
  await page.waitForFunction(() => typeof DATA === 'object');

  expect(await page.locator('[data-act="save"]').count()).toBe(0);
  expect(await page.locator('[data-act="save-as"]').count()).toBe(0);
  await expect(page.locator('#save-target')).toHaveText('저장됨: 2026-09-01 10:30:00');

  // the buttons live inside render()'s output — they must stay gone across re-renders too
  await page.evaluate(() => render());
  expect(await page.locator('[data-act="save"]').count()).toBe(0);
  expect(await page.locator('[data-act="save-as"]').count()).toBe(0);
  await expect(page.locator('#save-target')).toHaveText('저장됨: 2026-09-01 10:30:00');
});

test('a snapshot is read-only — cells refuse edits, selects are disabled, mutations bounce', async ({ page }) => {
  const snap = makeSnapshotFile('2026-09-01 10:30:00');
  await page.goto('file://' + snap);
  await page.waitForFunction(() => typeof DATA === 'object');

  const cell = page.locator('.cell[data-path="meta.ip_name"]');
  expect(await cell.getAttribute('contenteditable')).toBe('false');
  expect(await page.locator('select[data-path="meta.status"]').isDisabled()).toBe(true);

  const before = await page.evaluate(() => DATA.features.length);
  await page.click('[data-tab="features"]');
  // add-row buttons are hidden by CSS; drive the delegated handler directly to prove the guard holds
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.act = 'add'; b.dataset.arr = 'features'; b.dataset.kind = 'feature';
    document.querySelector('#app').appendChild(b); b.click();
  });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('수정할 수 없습니다'));
  expect(await page.evaluate(() => DATA.features.length)).toBe(before);

  // the feature↔item link editors are gone too: no pickers rendered, and none would render
  expect(await page.locator('select[data-pick]').count()).toBe(0);
  expect(await page.evaluate(() => linkPicker('vref', 'F1', [{ id: 'VI1' }], '+'))).toBe('');
  expect(await page.locator('[data-act="load"]').count()).toBe(0);
});

/** Stub the open-file picker to hand back the given file text. */
async function stubOpenPicker(page, fname, text) {
  await page.evaluate(([fname, text]) => {
    window.showOpenFilePicker = async () => [{
      getFile: async () => ({ name: fname, text: async () => text }),
    }];
  }, [fname, text]);
}

test('Load pulls a snapshot onto the screen, strips the marker, and leaves saving to Save', async ({ page }) => {
  const snapText = fs.readFileSync(makeSnapshotFile('2026-09-01 11:00:00'), 'utf-8')
    .replace('"ip_name": ""', '"ip_name": "SNAPIP"');
  await openVplan(page);
  await seed(page);
  await stubHelper(page);
  await stubOpenPicker(page, 'vplan_SNAP.html', snapText);

  await page.click('[data-act="load"]');
  await page.waitForFunction(() => DATA.meta.ip_name === 'SNAPIP');

  const st = await page.evaluate(() => ({
    snap: DATA.meta.snapshot || null, dirty: DIRTY,
    saveBtns: document.querySelectorAll('[data-act="save"]').length,
  }));
  expect(st.snap).toBeNull();                 // loading can never turn the original read-only
  expect(st.dirty).toBe(true);                // on screen only until the user saves
  expect(st.saveBtns).toBe(1);

  await saveViaHelper(page, 1);               // and Save still posts to the helper as usual
  const body = await page.evaluate(() => window.__fetches[0].body);
  expect(body).toContain('"ip_name": "SNAPIP"');
  expect(body).not.toContain('"snapshot"');
});

test('Load refuses a file that is not a snapshot', async ({ page }) => {
  const originalText = fs.readFileSync(fileURLToPath(new URL(VPLAN_URL)), 'utf-8');
  await openVplan(page);
  await seed(page);
  await stubOpenPicker(page, 'vplan_other.html', originalText);

  await page.click('[data-act="load"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('스냅샷 파일이 아닙니다'));
  expect(await page.evaluate(() => DATA.meta.ip_name)).toBe('SEED');   // untouched
});

test('a snapshot never saves, even by keyboard', async ({ page }) => {
  const snap = makeSnapshotFile('2026-09-01 10:30:00');
  await page.goto('file://' + snap);
  await page.waitForFunction(() => typeof DATA === 'object');
  await stubPicker(page);
  await stubHelper(page);
  await page.evaluate(() => { window.__dl = null; window.download = () => { window.__dl = true; }; });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+s' : 'Control+Shift+s');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('스냅샷 파일'));

  const { picks, writes, fetches, dl } = await page.evaluate(() => ({
    picks: window.__picks, writes: window.__writes, fetches: window.__fetches, dl: window.__dl,
  }));
  expect(picks.length).toBe(0);
  expect(writes.length).toBe(0);
  expect(fetches.length).toBe(0);
  expect(dl).toBeNull();
});
