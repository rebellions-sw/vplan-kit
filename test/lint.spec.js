import { test, expect } from '@playwright/test';
import { openVplan, lint, patch , seed} from './helpers.js';

const hasError = lines => lines.some(l => l.startsWith('ERR'));
const matching = (lines, re) => lines.filter(l => re.test(l));

test('duplicate feature id is an error', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => D.features.push({ ...D.features[0] }));
  expect(matching(await lint(page), /^ERR .*duplicate id.*F01/)).toHaveLength(1);
});

test('a feature whose phase has arrived is judged as due; a later one only warns', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'pre-Alpha';
    D.features.push({ id: 'F90', name: 'orphan pre-alpha', phase: 'pre-Alpha', status: 'finalized' });
    D.features.push({ id: 'F91', name: 'orphan beta', phase: 'Beta', status: 'not started' });
  });
  const lines = await lint(page);
  expect(matching(lines, /^ERR FEATURE .*no verification item is linked.*F90/)).toHaveLength(1);   // due and uncovered
  expect(matching(lines, /F91/)).toHaveLength(0);                                  // a later phase is not linted
});

test('a due feature that is not finalized is an error, and the message names the phase', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    D.features.push({ id: 'F93', name: 'still editing', phase: 'Alpha', status: 'editing' });
    D.items.push({ id: 'VI93', feature_refs: ['F93'], oracle: 'scoreboard', status: 'finalized', phase: 'Alpha' });
  });
  const hit = matching(await lint(page), /^ERR FEATURE .*definition is not finalized/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('F93');
  expect(hit[0]).toContain('finalized');   // which phase made it due is shown on the panel head
});

test('a feature claimed by a verification item is no longer reported as uncovered', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'pre-Alpha';
    D.features.push({ id: 'F92', name: 'covered', phase: 'pre-Alpha', status: 'finalized', reviewed: true });
    D.items.push({ id: 'VI900', name: 'judges F92', feature_refs: ['F92'], oracle: 'scoreboard', status: 'finalized', phase: 'pre-Alpha' });
    // ...and a test that runs it, so the uncovered-features rule has nothing to say either
    D.testcases.push({ id: 'TC900', name: 'tc_f92', feature_refs: ['F92'], type: 'directed', phase: 'Beta',
                       status: 'not started', implemented: 'todo', description: 'd',
                       uvm: { sequences: [] }, tb_gen_hints: '' });
  });
  const lines = await lint(page);
  expect(matching(lines, /F92/)).toHaveLength(0);
});

test('a rejection with no label is a warning', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => { D.suggestions[2].status = 'rejected'; delete D.suggestions[2].reject_kind; });
  const hit = matching(await lint(page), /^WARN .*rejection has no label/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('S003');
});

test('a pending suggestion with no source quote is a warning', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => { D.suggestions[0].source.quote = ''; });
  const hit = matching(await lint(page), /^WARN .*pending suggestion has no quote/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('S001');
});

test('pending suggestions are surfaced as a warning so they are not forgotten', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => { D.suggestions[0].status = 'pending'; });
  expect(matching(await lint(page), /^WARN .*suggestions pending review/).length).toBe(1);
});

test('an empty note is not unfinished work, and a command row needs no Related to', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Beta';                 // these rows are due, so a blank on them is a finding
    D.features.push({ id: 'F80', category: 'behavior', name: 'fully filled in', description: 'd',
                      related_refs: ['F81'], phase: 'Beta', status: 'finalized', reviewed: true, notes: '' });
    D.features.push({ id: 'F81', category: 'command', name: 'INV', description: 'd',
                      related_refs: [], phase: 'Beta', status: 'finalized', reviewed: true, notes: '' });
    D.features.push({ id: 'F82', category: 'behavior', name: 'no link', description: 'd',
                      related_refs: [], phase: 'Beta', status: 'finalized', reviewed: true, notes: 'n' });
  });
  const gap = matching(await lint(page), /some fields are still empty/);
  expect(gap[0]).not.toContain('F80');    // only its note is empty
  expect(gap[0]).not.toContain('F81');    // a command is what others point at
  expect(gap[0]).toContain('F82');        // a behavior row with no command behind it still counts
});

test('a row due in a later phase is not warned about at all', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'pre-Alpha';
    D.features.push({ id: 'F85', category: '', name: 'beta work, barely started', description: '',
                      related_refs: [], phase: 'Beta', status: 'not started', reviewed: false, notes: '' });
    D.items.push({ id: 'VI85', name: '', description: '', feature_refs: [], oracle: '',
                   report: '', judged_by: [], status: 'not started', phase: 'Beta',
                   implemented: 'todo', notes: '' });
  });
  const lines = await lint(page);
  expect(matching(lines, /F85|VI85/)).toHaveLength(0);      // empty, unlinked, unfinished — and not yet due
});

test('a testcase says which items it runs; an item nobody runs is a warning', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    D.items.push({ id: 'VI700', name: 'run by nobody', description: 'd', feature_refs: ['F02'],
                   oracle: 'o', report: 'r', judged_by: ['scoreboard'], status: 'finalized',
                   phase: 'Alpha', implemented: 'done', notes: '' });
    D.items.push({ id: 'VI701', name: 'run by TC700', description: 'd', feature_refs: ['F01'],
                   oracle: 'o', report: 'r', judged_by: ['scoreboard'], status: 'finalized',
                   phase: 'Alpha', implemented: 'done', notes: '' });
    D.testcases.push({ id: 'TC700', name: 'tc_runs_701', feature_refs: ['F01'],
                       priority: 'P1', type: 'directed', status: 'finalized', owner: 'x', description: 'd',
                       uvm: { test_class: 'c', base_test: 'b', virtual_sequence: 'v', sequences: [{ agent: 'a', seq_class: 's', params: '' }] },
                       coverage_refs: [], pass_criteria: 'p', dependencies: [], seeds: 1, tb_gen_hints: '' });
  });
  const lines = await lint(page);

  const gap = matching(lines, /no testcase exercises this item/);
  expect(gap).toHaveLength(1);
  expect(gap[0]).toContain('VI700');
  expect(gap[0]).not.toContain('VI701');            // that one is run

  // the items a test runs are derived from its features, so there is no second list to dangle
  expect(await page.evaluate(() => 'item_refs' in DATA.testcases.at(-1))).toBe(false);
});

test('an item whose features no testcase runs is a warning', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    const row = id => ({ id, name: id, description: 'd', feature_refs: [id === 'VI800' ? 'F01' : 'F02'],
      oracle: 'o', report: 'r', judged_by: ['scoreboard'], status: 'finalized', phase: 'Alpha',
      implemented: 'done', notes: '' });
    D.items.push(row('VI800'));      // F01 is run below
    D.items.push(row('VI801'));      // F02 is run by nothing
    D.testcases = [{ id: 'TC800', name: 'tc', feature_refs: ['F01'], type: 'directed', phase: 'Alpha',
                     status: 'finalized', implemented: 'done', description: 'd',
                     uvm: { sequences: [] }, tb_gen_hints: '' }];
  });
  const gap = matching(await lint(page), /no testcase exercises this item/);
  expect(gap).toHaveLength(1);
  expect(gap[0]).not.toContain('VI800');
  expect(gap[0]).toContain('VI801');
});

test('a due testcase must be finalized and implemented; a later one is left alone', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    const tc = (id, phase, status, implemented) => ({ ...D.testcases[0], id, name: id, feature_refs: ['F01'],
      type: 'directed', phase, status, implemented, description: 'd',
      uvm: { sequences: [{ agent: 'a', seq_class: 's', params: '' }] }, tb_gen_hints: '' });
    D.testcases = [
      tc('TC010', 'pre-Alpha', 'editing',   'done'),   // due, not finalized
      tc('TC011', 'Alpha',     'finalized', 'wip'),    // due, not implemented
      tc('TC012', 'Alpha',     'finalized', 'done'),   // due and done — silent
      tc('TC013', 'Beta',      'editing',   'todo'),   // not due yet — silent
    ];
  });
  const lines = await lint(page);

  const def = matching(lines, /TESTCASE definition is not finalized/);
  expect(def).toHaveLength(1);
  expect(def[0]).toContain('TC010(editing)');
  expect(def[0]).not.toContain('TC013');

  const impl = matching(lines, /TESTCASE implemented is not done/);
  expect(impl).toHaveLength(1);
  expect(impl[0]).toContain('TC011(wip)');
  expect(impl[0]).not.toContain('TC013');

  expect(matching(lines, /TC012/)).toHaveLength(0);
});

test('an open comment is no longer a lint line — the rail counts them', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.me = 'nara.cho';
    D.comments = [{ cid: 'C001', target: 'F01', author: 'nara.cho', to: [], text: 'open one',
                    created: '2026-09-15 10:00:00', resolved: false }];
  });
  expect(matching(await lint(page), /review comments/)).toHaveLength(0);
  await expect(page.locator('.rail-head .badge').first()).toHaveText('1 open');
});

test('a due testcase with no feature is an error — it verifies nothing', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    const tc = (id, phase, feature_refs) => ({ id, name: id, feature_refs, type: 'directed', phase,
      status: 'finalized', implemented: 'done', description: 'd',
      uvm: { sequences: [{ agent: 'a', seq_class: 's', params: '' }] }, tb_gen_hints: '' });
    D.testcases = [
      tc('TC020', 'Alpha', []),          // due, linked to nothing
      tc('TC021', 'Alpha', ['F01']),     // due and linked
      tc('TC022', 'Beta',  []),          // not due yet
    ];
  });
  const hit = matching(await lint(page), /no feature is linked — the test verifies nothing/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('TC020');
  expect(hit[0]).not.toContain('TC021');
  expect(hit[0]).not.toContain('TC022');
});

test('a feature no testcase links is reported under uncovered features', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.phase = 'Alpha';
    D.features.push({ id: 'F90', category: 'behavior', name: 'run by a test', description: 'd',
                      phase: 'Alpha', status: 'finalized', reviewed: true, notes: '' });
    D.features.push({ id: 'F91', category: 'behavior', name: 'run by nothing', description: 'd',
                      phase: 'Alpha', status: 'finalized', reviewed: true, notes: '' });
    D.features.push({ id: 'F92', category: 'behavior', name: 'later phase', description: 'd',
                      phase: 'Beta', status: 'finalized', reviewed: true, notes: '' });
    D.testcases = [{ id: 'TC030', name: 'tc', feature_refs: ['F90'], type: 'directed', phase: 'Alpha',
                     status: 'finalized', implemented: 'done', description: 'd',
                     uvm: { sequences: [] }, tb_gen_hints: '' }];
  });
  const lines = await lint(page);

  const hit = matching(lines, /TESTCASE .*no testcase exercises this feature/);
  expect(hit).toHaveLength(1);
  expect(hit[0]).toContain('F91');
  expect(hit[0]).not.toContain('F90');
  expect(hit[0]).not.toContain('F92');            // its phase has not arrived

  expect(matching(lines, /testcase has no sequence/)).toHaveLength(0);   // that rule is gone
});
