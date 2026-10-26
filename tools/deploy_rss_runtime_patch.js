#!/usr/bin/env node
/* Apply intentional post-deployment RSS deltas without overwriting other edits. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {sources, save} = require('./rss_source_client');
const root = path.resolve(__dirname, '..');

async function main() {
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'rsssource/backups/phone-rss-20261025T122544+0800.api.json'))).data;
const candidate = JSON.parse(fs.readFileSync(path.join(root, 'rsssource/legado-rss-sources-current.json')));
const byUrl = new Map(baseline.map((s) => [s.sourceUrl, s]));
const desired = new Map(candidate.map((s) => [s.sourceUrl, s]));
const live = await sources();
const changes = [];
for (const current of live) {
  const want = desired.get(current.sourceUrl);
  const old = byUrl.get(current.sourceUrl);
  if (!want || !old) continue;
  const next = structuredClone(current);
  const paths = [];
  // The generic login checker was deliberately standardized for every
  // non-single source.  It is safe to update a baseline-null checker or one
  // previously installed by the migration; custom user checkers are left
  // untouched and reported for manual review.
  if (!want.singleUrl && String(want.jsLib || '').includes('LEGADO_RSS_TRANSLATION_RUNTIME')
      && current.jsLib !== want.jsLib) {
    const knownMigrationRuntime = String(current.jsLib || '').includes('LEGADO_RSS_TRANSLATION_RUNTIME');
    if (knownMigrationRuntime || current.jsLib === old.jsLib) {
      next.jsLib = want.jsLib;
      paths.push('jsLib');
    }
  }
  if (!want.singleUrl && current.loginCheckJs !== want.loginCheckJs) {
    const knownMigration = String(current.loginCheckJs || '').includes('_rssChallenge') &&
      String(current.loginCheckJs || '').includes('startBrowserAwait');
    const baselineValue = String(old.loginCheckJs || '');
    if (knownMigration || String(current.loginCheckJs || '') === baselineValue) {
      next.loginCheckJs = want.loginCheckJs;
      paths.push('loginCheckJs');
    } else {
      changes.push({name: current.sourceName, status: 'SKIPPED_CUSTOM_LOGIN_CHECK'});
    }
  }
  if (current.sourceName === 'DoD' || current.sourceName === 'DoD - China') {
    if (current.sortUrl !== want.sortUrl) {
      if (current.sortUrl === old.sortUrl || current.sortUrl === want.sortUrl.replace(/,\{"webView":true,"webViewDelayTime":3000\}/g, '')) {
        next.sortUrl = want.sortUrl;
        paths.push('sortUrl');
      } else {
        changes.push({name: current.sourceName, status: 'SKIPPED_CUSTOM_SORT_URL'});
      }
    }
  }
  if (current.sourceName === '聚合搜索' || current.sourceName === '36kr') {
    if (current.enabledCookieJar !== want.enabledCookieJar && current.enabledCookieJar === true) {
      next.enabledCookieJar = want.enabledCookieJar;
      paths.push('enabledCookieJar');
    }
  }
  if (paths.length) {
    await save(next, paths);
    changes.push({name: current.sourceName, status: 'PATCHED', paths});
  }
}
console.log(JSON.stringify({changes}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
