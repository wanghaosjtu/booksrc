#!/usr/bin/env node
/* Isolate HTTP rule execution from external-site connectivity; no source changes. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ROOT, TEST_ID, SOURCE_ID} = require('./build_usehtml_validation');
const client = require('./usehtml_http_ws_client');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const STATE = path.join(DIR, 'state.json');
const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'explicit matching phone required');
assert.equal(state.sourceId, TEST_ID);
assert.equal(state.sourceStatus, 'deployed');
assert(!state.books.some(b => b.kind === 'loopback'), 'loopback validation was already attempted');
const {article} = JSON.parse(fs.readFileSync(path.join(DIR, 'article.json'), 'utf8'));
const fixture = fs.readFileSync(path.join(DIR, 'inline-fixture.html'), 'utf8');
const safeJs = value => JSON.stringify(value).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
const healthUrl = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
const responseUrl = bodyJs => healthUrl + ',' + JSON.stringify({bodyJs, timeout: 10000});
const fixedUrl = responseUrl(safeJs(fixture));
const diagnosticJs = '(function(){var f=String(source.getHeaderMap(false).get("proxy")).trim().length===0;' +
  'var t=String(source.getHeaderMap(true).get("proxy")).trim().length===0;return ' +
  safeJs('<html><body><h1>运行时代理检查</h1><p>UHV-PROXY-CHECK falseBlank=') +
  '+f+' + safeJs(', trueBlank=') + '+t+' + safeJs('</p></body></html>') + ';})()';
const diagnosticUrl = responseUrl(diagnosticJs);
const documents = [
  {contentSummary: {title: '真实文章：' + article.title, href: article.url,
    publishedAt: article.publishedAt}, path: article.url, topics: []},
  {contentSummary: {title: '只读运行时代理检查', href: diagnosticUrl, publishedAt: Date.now()},
    path: diagnosticUrl, topics: []},
  {contentSummary: {title: '固定 HTML 样本：标题、列表、引用、实体和图片', href: fixedUrl,
    publishedAt: Date.now() + 1}, path: fixedUrl, topics: []}
];
const toc = {results: [{out_of: 3, found: 3, hits: documents.map(document => ({document}))}]};
const tocUrl = responseUrl('JSON.stringify(' + safeJs(toc) + ')');
const bookUrl = SOURCE_ID + '/research#usehtml-validation-' + state.token + '-loopback';
const book = {bookUrl, tocUrl, origin: TEST_ID, originName: 'Carnegie endowment · HTML验证',
  name: 'HTML 验证 UHV-' + state.token.slice(0, 8) + ' · HTTP回环样本',
  author: 'usehtml-validation', canUpdate: false, durChapterIndex: 0, durChapterPos: 0};
const write = (file, value, exclusive = false) => fs.writeFileSync(path.join(DIR, file),
  JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: exclusive ? 'wx' : 'w'});

(async () => {
  const before = JSON.parse(fs.readFileSync(path.join(DIR, 'candidate.json'), 'utf8'))[0];
  const source = (await client.sources()).find(s => s.bookSourceUrl === TEST_ID);
  assert(source, 'experimental source is missing');
  for (const key of ['ruleContent', 'ruleToc', 'ruleBookInfo', 'ruleExplore', 'ruleSearch', 'header', 'jsLib']) {
    assert.deepEqual(source[key], before[key], 'experimental rules changed at ' + key);
  }
  assert(!(await client.request('/getBookshelf')).some(b => b.bookUrl === bookUrl), 'test book collision');
  const record = {kind: 'loopback', bookUrl, book, status: 'creating'};
  state.books.push(record); write('state.json', state);
  await client.request('/saveBook', book);
  const actual = (await client.request('/getBookshelf')).find(b => b.bookUrl === bookUrl);
  assert(actual && actual.origin === TEST_ID && actual.name === book.name && actual.author === book.author,
    'loopback book ownership readback mismatch');
  record.status = 'created'; write('state.json', state);
  write('loopback-response-options.json', {tocUrl, fixedUrl, diagnosticUrl,
    purpose: 'fixed fixture and read-only proxy flags via phone loopback; real article remains external'}, true);
  console.log(JSON.stringify({name: book.name, kind: 'loopback', chapters: 3,
    sourceRules: 'unchanged', externalFetchRequiredForFixed: false}));
})().catch(error => {
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 500));
  process.exitCode = 1;
});
