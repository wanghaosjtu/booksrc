#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'rsssource/legado-rss-sources-current.json');
const BACKUP = path.join(ROOT, 'rsssource/backups/phone-rss-20261025T122544+0800.api.json');
const MARKER = 'legado-rss-translation-runtime v1';
const LEGACY = /edge\.microsoft\.com|translatetext|api-edge\.cognitive\.microsofttranslator|Microsoft\.Translator|getAUTHkey\s*\(|trans_title\s*\(/i;

function xmlSource(source) {
  return /(?:\.xml\b|\.rss\b|\/rss\/|\/feed\b|rss\.ashx|atom)/i.test([
    source.sourceUrl, source.sortUrl, source.ruleArticles,
  ].join(' '));
}

function main() {
  const current = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const backupData = JSON.parse(fs.readFileSync(BACKUP, 'utf8')).data;
  if (!Array.isArray(current) || current.length !== 43) throw new Error('expected exactly 43 canonical RSS sources');
  if (!Array.isArray(backupData) || backupData.length !== current.length) throw new Error('backup identity/count mismatch');
  const oldByUrl = new Map(backupData.map((source) => [source.sourceUrl, source]));
  const seen = new Set();
  let translated = 0;
  let contentSources = 0;
  for (const source of current) {
    if (seen.has(source.sourceUrl)) throw new Error(`duplicate source URL: ${source.sourceUrl}`);
    seen.add(source.sourceUrl);
    const old = oldByUrl.get(source.sourceUrl);
    if (!old) throw new Error(`source missing from phone backup: ${source.sourceUrl}`);
    if (source.enabled !== old.enabled) throw new Error(`enabled changed: ${source.sourceName}`);
    if (source.sourceGroup !== old.sourceGroup) throw new Error(`group changed: ${source.sourceName}`);
    if (source.enabledCookieJar !== old.enabledCookieJar) throw new Error(`cookie setting changed: ${source.sourceName}`);
    if (!source.singleUrl && !/^test$/i.test(String(source.sourceName || ''))) {
      contentSources += 1;
      for (const key of ['loginUrl', 'loginUi', 'loginCheckJs', 'header']) {
        if (!source[key]) throw new Error(`${source.sourceName} missing ${key}`);
      }
      if (!String(source.loginUi).includes('翻译语言') || !String(source.loginUi).includes('proxyUrl')) {
        throw new Error(`${source.sourceName} missing standard language/proxy UI`);
      }
    }
    if (String(source.jsLib || '').includes(MARKER)) {
      translated += 1;
      for (const fn of ['TT', 'TJ', 'TC', 'TH', 'TX']) {
        if (!String(source.jsLib).includes(`function ${fn}`)) throw new Error(`${source.sourceName} runtime missing ${fn}`);
      }
      if (source.injectJs) throw new Error(`${source.sourceName} still has legacy injectJs`);
      if (LEGACY.test([source.ruleArticles, source.ruleTitle, source.ruleContent, source.ruleDescription, source.ruleLink].join('\n'))) {
        throw new Error(`${source.sourceName} still has legacy translation in a rule`);
      }
      if (xmlSource(source)) {
        if (!String(source.ruleArticles || '').includes('TX(result,java,cache')) throw new Error(`${source.sourceName} XML rule does not use TX`);
      } else if (/JSON\.parse|\$\.\[\*\]|multi_search/i.test(String(source.ruleArticles || '') + String(source.sortUrl || ''))) {
        if (!String(source.ruleArticles || '').includes('JSON.parse') && !String(source.ruleArticles || '').includes('TJ(result,java,cache')) {
          throw new Error(`${source.sourceName} JSON list rule does not use TJ/JSON.parse`);
        }
      } else if (!String(source.ruleArticles || '').includes('TH(result,java,cache') && !String(source.ruleArticles || '').includes('TC(result,java,cache')) {
        throw new Error(`${source.sourceName} HTML list rule does not use TH or TC`);
      }
      if (!String(source.ruleContent || '').includes('TH(result,java,cache')) throw new Error(`${source.sourceName} body rule does not use TH`);
    }
  }
  if (translated !== 29) throw new Error(`expected 29 translated sources, got ${translated}`);
  console.log(JSON.stringify({sources: current.length, translated, contentSources, validation: 'PASS'}));
}

main();
