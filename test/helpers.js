import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// the suite runs against the blank template — it must not depend on anyone's plan
export const VPLAN_URL = 'file://' + path.resolve(here, '..', 'vplan_template.html');

/** Open vplan.html and fail the test on any page/console error. */
export async function openVplan(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(VPLAN_URL);
  // DATA is a top-level `let` in a classic script — it is a global *binding*, not a property of window
  await page.waitForFunction(() => typeof DATA === 'object' && !!document.querySelector('.tab'));
  return errors;
}

/** Read the live in-page DATA object. */
export const data = page => page.evaluate(() => JSON.parse(JSON.stringify(DATA)));

/** Type into a contenteditable/select cell the same way a user does (fires 'input'). */
export async function setCell(page, dataPath, value) {
  await page.evaluate(([p, v]) => {
    const el = document.querySelector(`[data-path="${p}"]`);
    if (!el) throw new Error('no cell at ' + p);
    // a real select fires input (which is what writes to DATA) and then change (which re-renders)
    if (el.tagName === 'SELECT') {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    else { el.textContent = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, [dataPath, value]);
}

/** Mutate DATA directly and re-render — for setting up fault-injection cases. */
export async function patch(page, fn) {
  await page.evaluate(`(() => { (${fn.toString()})(DATA); render(); })()`);
}

/** Run the UI's own lint and return its findings as text lines. */
export async function lint(page) {
  await page.click('[data-act="lint"]');
  await page.waitForSelector('.lintbox');
  // one line per finding group: "ERR <title> :: <id> <id> …"
  return page.$$eval('.lintbox .lint-group', els => els.map(g => {
    const sev = g.querySelector('.badge')?.textContent.trim() || '';
    const scope = (g.dataset.scope || '').toUpperCase();
    const title = g.querySelector('.lg-title')?.innerText.replace(/\s+/g, ' ').trim() || g.innerText.trim();
    const ids = Array.from(g.querySelectorAll('.chips .badge')).map(x => x.textContent.trim());
    return `${sev} ${scope} ${title} :: ${ids.join(' ')}`;
  }));
}

/** Intercept clipboard writes so we can assert on what a button copied. */
export async function captureClipboard(page) {
  await page.evaluate(() => { window.__CLIP = ''; navigator.clipboard.writeText = async t => { window.__CLIP = t; }; });
  return () => page.evaluate(() => window.__CLIP);
}

/** A minimal plan to test against: two features, one item, three suggestions (one already rejected).
 *  The suite runs on the blank template, so anything that needs rows seeds them here. */
export async function seed(page) {
  await page.evaluate(() => {
    DATA.meta.ip_name = 'SEED';
    DATA.meta.phase = 'pre-Alpha';
    DATA.features = [
      { id: 'F01', category: 'command', name: 'first feature', description: 'd1', phase: 'pre-Alpha', status: 'editing', reviewed: false, notes: '' },
      { id: 'F02', category: 'behavior', name: 'second feature', description: 'd2', phase: 'Alpha', status: 'editing', reviewed: false, notes: '' },
    ];
    DATA.items = [
      { id: 'VI001', category: 'command', name: 'first item', description: '', feature_refs: ['F01'], oracle: 'scoreboard',
        judged_by: ['sva'], stimulus: 'directed', status: 'editing', phase: 'pre-Alpha', implemented: 'todo', reviewed: false, notes: '' },
    ];
    const card = (sid, name, extra) => Object.assign({
      sid, kind: 'feature', status: 'pending', created: '2026-08-31', confidence: 'high',
      source: { doc: 'MAS', section: '5.5', url: 'https://example.com/mas#5-5', quote: 'a verbatim sentence' },
      rationale: 'closest is F01, which stops short of this',
      payload: { name, category: '', description: 'proposed', phase: 'pre-Alpha', status: 'not started', notes: '' },
      reject_reason: '',
    }, extra || {});
    DATA.suggestions = [
      card('S001', 'pending one'),
      card('S002', 'pending two'),
      card('S003', 'already rejected', { status: 'rejected', reject_kind: 'waived', reject_reason: 'PREFETCH_EN=0 in this config' }),
    ];
    render();
  });
}
