#!/usr/bin/env node
/* Merge the reviewed canonical rules into the phone without replacing UI state. */
'use strict';

const fs = require('node:fs');

const host = process.env.LEGADO_PHONE || 'localhost';
const base = `http://${host}:1122`;
const args = process.argv.slice(2);
const canonicalFile = args.find((arg) => !arg.startsWith('--')) || 'booksource/legado-book-sources-current.json';
const dryRun = args.includes('--dry-run');
const phoneNormalized = new Set(['remove_selector', 'extract_selector', 'toc_mode', 'formula_mode', 'formula_selector']);
const preserve = [
  'bookSourceName', 'bookSourceGroup', 'bookSourceType', 'customOrder', 'enabled',
  'enabledExplore', 'enabledCookieJar', 'eventListener', 'customButton', 'weight',
  'lastUpdateTime', 'respondTime', 'loginUrl', 'loginUi', 'header', 'bookSourceComment',
  'concurrentRate'
];

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function dataOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  throw new Error('invalid source response');
}

/* Android may deserialize JSON objects in a different insertion order. Compare
 * semantic values, not JSON.stringify's property order. */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function equalValue(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}
function changed(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (phoneNormalized.has(key)) continue;
    if (after[key] === null && before[key] == null) continue;
    if (!equalValue(before[key], after[key])) return true;
  }
  return false;
}

function merge(live, desired) {
  if (live.bookSourceUrl !== desired.bookSourceUrl) throw new Error(`identity mismatch: ${desired.bookSourceUrl}`);
  const next = structuredClone(desired);
  for (const key of phoneNormalized) delete next[key];
  for (const key of Object.keys(next)) if (next[key] === null) delete next[key];
  for (const key of preserve) {
    if (Object.prototype.hasOwnProperty.call(live, key)) next[key] = live[key];
    else delete next[key];
  }
  return next;
}

(async () => {
  const live = dataOf(await request('/getBookSources'));
  const desired = JSON.parse(fs.readFileSync(canonicalFile, 'utf8'));
  const liveByUrl = new Map(live.map((item) => [item.bookSourceUrl, item]));
  const merged = [];
  const names = [];
  for (const source of desired) {
    const current = liveByUrl.get(source.bookSourceUrl);
    if (!current) throw new Error(`source missing on phone: ${source.bookSourceUrl}`);
    const next = merge(current, source);
    if (changed(current, next)) {
      merged.push(next);
      names.push(`${source.bookSourceName} (${source.bookSourceUrl})`);
    }
  }
  console.log(JSON.stringify({live: live.length, canonical: desired.length, changed: merged.length, names}, null, 2));
  if (dryRun || !merged.length) return;
  const reply = await request('/saveBookSources', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(merged),
  });
  if (reply.isSuccess !== true) throw new Error(reply.errorMsg || 'saveBookSources failed');
  const after = dataOf(await request('/getBookSources'));
  const afterByUrl = new Map(after.map((item) => [item.bookSourceUrl, item]));
  for (const item of merged) {
    const actual = afterByUrl.get(item.bookSourceUrl);
    if (!actual) throw new Error(`readback missing: ${item.bookSourceUrl}`);
    for (const key of Object.keys(item)) {
      if (phoneNormalized.has(key)) continue;
      if (item[key] === null && actual[key] == null) continue;
      if (!equalValue(item[key], actual[key])) {
        throw new Error(`readback mismatch ${item.bookSourceName}.${key}`);
      }
    }
  }
  console.log(JSON.stringify({saved: merged.length, readback: 'verified'}));
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
