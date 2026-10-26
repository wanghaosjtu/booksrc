#!/usr/bin/env node
/* Deploy native RSS sources safely: merge planned leaves, then read back. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {sources, changedPaths, merge, save} = require('./rss_source_client');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = process.env.LEGADO_RSS_BASELINE || path.join(ROOT, 'rsssource/backups/phone-rss-20261025T122544+0800.api.json');
const CANDIDATE = process.env.LEGADO_RSS_CANDIDATE || path.join(ROOT, 'rsssource/legado-rss-sources-current.json');
const only = new Set(String(process.env.LEGADO_RSS_DEPLOY_ONLY || '').split(',').map((value) => value.trim()).filter(Boolean));
const rollback = process.argv.includes('--rollback');
const dryRun = process.argv.includes('--dry-run');

function identity(source) {
  return source.sourceName + '||' + source.sourceUrl;
}

function loadBaseline() {
  const data = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  return Array.isArray(data) ? data : data.data;
}

async function main() {
  const baseline = loadBaseline();
  const candidate = JSON.parse(fs.readFileSync(CANDIDATE, 'utf8'));
  if (!Array.isArray(baseline) || !Array.isArray(candidate)) throw new Error('baseline/candidate must be arrays');
  const baselineByUrl = new Map(baseline.map((source) => [source.sourceUrl, source]));
  const candidateByUrl = new Map(candidate.map((source) => [source.sourceUrl, source]));
  if (baselineByUrl.size !== candidateByUrl.size || [...baselineByUrl.keys()].some((url) => !candidateByUrl.has(url))) {
    throw new Error('baseline/candidate identity mismatch');
  }
  const phone = await sources();
  const phoneByUrl = new Map(phone.map((source) => [source.sourceUrl, source]));
  const selected = candidate.filter((source) => !only.size || only.has(source.sourceName) || only.has(source.sourceUrl));
  const results = [];
  for (const desired of selected) {
    const before = baselineByUrl.get(desired.sourceUrl);
    const target = rollback ? before : desired;
    const comparison = rollback ? desired : before;
    const paths = changedPaths(comparison, target);
    if (!paths.length) {
      results.push({name: desired.sourceName, status: 'UNCHANGED', paths: []});
      continue;
    }
    const live = phoneByUrl.get(desired.sourceUrl);
    if (!live) throw new Error(`phone source missing: ${desired.sourceName}`);
    const merged = merge(comparison, target, live);
    if (dryRun) {
      results.push({name: desired.sourceName, status: 'DRY_RUN', paths});
      continue;
    }
    await save(merged, paths);
    results.push({name: desired.sourceName, status: rollback ? 'ROLLED_BACK' : 'DEPLOYED', paths});
  }
  console.log(JSON.stringify({rollback, dryRun, count: results.length, results}, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
