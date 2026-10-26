#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const sources = JSON.parse(fs.readFileSync('rsssource/legado-rss-sources-current.json', 'utf8'));
const languages = {'简体中文': 'zh-Hans', '繁体中文': 'zh-Hant', '文言文': 'lzh'};
let checked = 0;
for (const source of sources) {
  if (source.singleUrl || /^test$/i.test(String(source.sourceName || ''))) continue;
  checked += 1;
  const ui = JSON.parse(String(source.loginUi || ''));
  const language = ui.find((row) => row.name === '翻译语言');
  if (!language || language.type !== 'select' || JSON.stringify(language.chars) !== JSON.stringify(Object.keys(languages))) {
    throw new Error(`${source.sourceName}: language UI is not the standard three-language selector`);
  }
  const proxy = ui.find((row) => row.name === 'proxyUrl');
  if (!proxy || proxy.type !== 'select' || !Array.isArray(proxy.chars)
      || !proxy.chars.includes('') || !proxy.chars.some((value) => /:9090$/.test(value))) {
    throw new Error(`${source.sourceName}: proxy selector is missing`);
  }
  if (!String(source.loginUrl).startsWith('@js:') || !/function\s+login\s*\(/.test(source.loginUrl)) {
    throw new Error(`${source.sourceName}: loginUrl does not expose login()`);
  }
  if (!String(source.header).includes('getLoginInfoMap') || !/['"]proxy['"]/.test(source.header)) {
    throw new Error(`${source.sourceName}: dynamic proxy header is missing`);
  }
  const noWafRssXml = String(source.loginCheckJs).includes('36KR_RSS_XML_NO_WAF');
  if (!noWafRssXml && (!String(source.loginCheckJs).includes('startBrowserAwait')
      || !/cloudflare|just a moment|forbidden|访问被拒/i.test(source.loginCheckJs))) {
    throw new Error(`${source.sourceName}: Cloudflare/WAF browser check is missing`);
  }
  if (noWafRssXml && source.sourceName !== '36kr') {
    throw new Error(`${source.sourceName}: unexpected no-WAF RSS exception`);
  }
  for (const [choice, expected] of Object.entries(languages)) {
    let actual = '';
    const context = {
      result: {'翻译语言': choice},
      java: {put(key, value) { if (key === 'TARGET_LANG') actual = value; }},
    };
    vm.runInNewContext(`${source.loginUrl.slice(4)}\nlogin();`, context);
    if (actual !== expected) throw new Error(`${source.sourceName}: ${choice} -> ${actual}, expected ${expected}`);
  }
}
console.log(JSON.stringify({sources: sources.length, loginSources: checked, languages: Object.keys(languages), validation: 'PASS'}));
