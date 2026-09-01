import { test, expect } from '@playwright/test';
import yaml from 'js-yaml';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openVplan, data, setCell, captureClipboard, patch , seed} from './helpers.js';

test('Save HTML round-trips: the saved file reloads with identical data and no errors', async ({ page, browser }) => {
  await openVplan(page);
  await seed(page);
  await setCell(page, 'meta.owner', 'roundtrip-owner');
  await page.click('[data-tab="features"]');
  await page.click('[data-act="sug-accept"][data-i="0"]');
  const expected = await data(page);

  const html = await page.evaluate(() => serializeDoc());
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vplan-')), 'saved.html');
  fs.writeFileSync(tmp, html);

  const page2 = await browser.newPage();
  const errors = [];
  page2.on('pageerror', e => errors.push(e.message));
  page2.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page2.goto('file://' + tmp);
  await page2.waitForFunction(() => typeof DATA === 'object');

  expect(await data(page2)).toEqual(expected);
  expect(errors).toEqual([]);
  // the saved file must be a clean shell — no rendered DOM baked into it
  expect(html).not.toContain('class="sug"');
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  await page2.close();
});

test('the saved file opens on the default tab, not whatever tab was active', async ({ page, browser }) => {
  await openVplan(page);
  await seed(page);
  await page.click('[data-tab="coverage"]');
  const html = await page.evaluate(() => serializeDoc());
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vplan-')), 'saved.html');
  fs.writeFileSync(tmp, html);
  const page2 = await browser.newPage();
  await page2.goto('file://' + tmp);
  await page2.waitForSelector('.tab.active');
  await expect(page2.locator('.tab.active')).toHaveAttribute('data-tab', 'features');
  await page2.close();
});

test('YAML export is valid YAML and preserves the whole document', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  const [text, expected] = await Promise.all([
    page.evaluate(() => toYaml(DATA)),
    data(page),
  ]);
  const parsed = yaml.load(text);
  expect(Object.keys(parsed)).toEqual(Object.keys(expected));
  expect(parsed.features.length).toBe(expected.features.length);
  expect(parsed.meta).toEqual(expected.meta);
});

test('YAML quoting survives values that look like YAML syntax', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await patch(page, D => {
    D.meta.ip_name = 'yes';                       // bare `yes` would parse as boolean
    D.features[0].notes = 'ratio 3:1 # not a comment';
    D.features[1].notes = '- leading dash';
    D.features[1].description = '1.20';           // must stay a string
  });
  const parsed = yaml.load(await page.evaluate(() => toYaml(DATA)));
  expect(parsed.meta.ip_name).toBe('yes');
  expect(parsed.features[0].notes).toBe('ratio 3:1 # not a comment');
  expect(parsed.features[1].notes).toBe('- leading dash');
  expect(parsed.features[1].description).toBe('1.20');
});

test('JSON export matches the live DATA exactly', async ({ page }) => {
  await openVplan(page);
  await seed(page);
  await setCell(page, 'meta.uarch', 'https://example.com/spec');
  const [exported, live] = await Promise.all([
    page.evaluate(() => JSON.stringify(DATA, null, 2)),
    data(page),
  ]);
  expect(JSON.parse(exported)).toEqual(live);
});
