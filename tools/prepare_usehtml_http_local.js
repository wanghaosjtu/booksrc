#!/usr/bin/env node
/* Fresh source-scoped JS state; local HTML text/cache test, not a live-site test. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ROOT, SOURCE_ID} = require('./build_usehtml_validation');
const client = require('./usehtml_http_ws_client');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const STATE = path.join(DIR, 'state.json');
const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'matching explicit phone required');
assert.equal(state.sourceStatus, 'deployed');
assert(!state.books.some(b => b.kind === 'local'), 'local harness already attempted');
const sourceId = SOURCE_ID + '#usehtml-http-local-' + state.token.slice(0, 8);
const title = 'UHV-' + state.token + ' 本地固定正文';
const counterKey = 'usehtml.validation:' + state.token + ':http-local-fetch';
const safeJs = value => JSON.stringify(value).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
const healthUrl = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
const responseUrl = bodyJs => healthUrl + ',' + JSON.stringify({bodyJs, timeout: 10000});
let fixture = fs.readFileSync(path.join(DIR, 'inline-fixture.html'), 'utf8');
fixture = fixture.replace(/<img\b[^>]*>/gi, '')
  .replace('图片标记 IMAGE：下面使用真实文章的分享封面图片，图片字节已经 curl 验证。',
    '本地下载链仅测试文字结构；外网图片另行验证。')
  .replace(/<([a-z][\w-]*)(?=[\s>])/gi, '<$1 class="notranslate"')
  .replace('<body class="notranslate">', '<body class="notranslate"><p class="notranslate" id="uhv-fetch-count">下载计数 UHV-FETCH-__FETCH__;缓存重读不应增加。</p>');
assert(fixture.includes('UHV-FETCH-__FETCH__') && !/<img\b/i.test(fixture), 'local fixture must not fetch external images');
const bodyJs = '(function(){var n=Number(cache.get(' + safeJs(counterKey) + ')||0)+1;' +
  'cache.put(' + safeJs(counterKey) + ',String(n),3600);return ' + safeJs(fixture) +
  '.replace("__FETCH__",String(n));})()';
const chapterUrl = responseUrl(bodyJs);
const toc = {results: [{out_of: 1, found: 1, hits: [{document: {
  contentSummary: {title, href: chapterUrl, publishedAt: Date.now()}, path: chapterUrl, topics: []
}}]}]};
const tocJs = '(function(){var l=String(java.get("TARGET_LANG")||"zh-Hans").trim()||"zh-Hans";' +
  'cache.put("legado_ms:"+l+":"+' + safeJs(title) + ',' + safeJs(title) + ',300);return JSON.stringify(' + safeJs(toc) + ');})()';
const tocUrl = responseUrl(tocJs);
const bookUrl = SOURCE_ID + '/research#usehtml-validation-' + state.token + '-local';
const book = {bookUrl, tocUrl, origin: sourceId, originName: 'Carnegie endowment · HTML本地验证',
  name: 'HTML 验证 UHV-' + state.token.slice(0, 8) + ' · 本地下载链', author: 'usehtml-validation',
  canUpdate: false, durChapterIndex: 0, durChapterPos: 0};
const write = (name, value, exclusive = false) => fs.writeFileSync(path.join(DIR, name),
  JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: exclusive ? 'wx' : 'w'});
const same = (a, b, message) => assert(client.changedPaths(a, b).length === 0, message);

(async () => {
  const live = await client.sources();
  const old = live.find(s => s.bookSourceUrl === state.sourceId);
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'candidate.json'), 'utf8'))[0];
  assert(old, 'original experimental source is missing');
  for (const key of ['ruleContent', 'ruleToc', 'ruleBookInfo', 'ruleExplore', 'ruleSearch', 'header', 'jsLib']) {
    same(old[key], expected[key], 'original experiment changed at ' + key);
  }
  assert(!live.some(s => s.bookSourceUrl === sourceId), 'local source collision');
  assert(!(await client.request('/getBookshelf')).some(b => b.bookUrl === bookUrl), 'local book collision');
  const candidate = structuredClone(old);
  candidate.bookSourceUrl = sourceId;
  candidate.bookSourceName = 'Carnegie endowment · HTML本地验证 ' + state.token.slice(0, 8);
  candidate.header = JSON.stringify({proxy: ''});
  const changed = client.changedPaths(old, candidate).sort();
  same(changed, ['bookSourceName', 'bookSourceUrl', 'header'], 'unexpected harness source changes');
  write('http-local-candidate.json', [candidate], true);
  const extra = {id: sourceId, kind: 'local', status: 'deploying', candidate: 'http-local-candidate.json'};
  state.extraSources = state.extraSources || []; state.extraSources.push(extra); write('state.json', state);
  await client.save(candidate, ['bookSourceName', 'bookSourceUrl', 'header', 'ruleContent', 'ruleToc', 'jsLib']);
  extra.status = 'deployed'; write('state.json', state);
  const after = await client.sources();
  same(after.filter(s => s.bookSourceUrl !== sourceId), live, 'another source changed during isolated deployment');
  const record = {kind: 'local', bookUrl, book, status: 'creating'};
  state.books.push(record); write('state.json', state);
  await client.request('/saveBook', book);
  const actual = (await client.request('/getBookshelf')).find(b => b.bookUrl === bookUrl);
  assert(actual && actual.origin === sourceId && actual.name === book.name && actual.author === book.author,
    'local book ownership readback mismatch');
  record.status = 'created'; write('state.json', state);
  write('http-local-options.json', {tocUrl, chapterUrl, counterKey, title,
    titleCacheSeconds: 300, counterCacheSeconds: 3600, purpose: 'textual HTML/cache only; no site/translation/image claim'}, true);
  console.log(JSON.stringify({name: book.name, kind: 'local', sourceChangedFields: changed,
    oldSources: 'unchanged', externalPageTranslationImages: 'not required', chapters: 1}));
})().catch(error => {
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 500));
  process.exitCode = 1;
});
