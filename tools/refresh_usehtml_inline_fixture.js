#!/usr/bin/env node
/* Protect embedded fixture HTML from the URL rule's normal entity decoding. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ROOT, TEST_ID} = require('./build_usehtml_validation');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json')));
assert.equal(state.host, process.env.LEGADO_PHONE, 'wrong phone');
assert.equal(state.sourceId, TEST_ID, 'wrong experimental source');
const record = state.books.find(b => b.kind === 'inline');
assert(record && record.status === 'created', 'owned inline book required');
const {article} = JSON.parse(fs.readFileSync(path.join(DIR, 'article.json')));
const fixture = fs.readFileSync(path.join(DIR, 'inline-fixture.html'), 'utf8');
const safeJs = value => JSON.stringify(value).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
const fixtureUrl = article.url + ',' + JSON.stringify({bodyJs: safeJs(fixture), timeout: 20000});
const docs = [{contentSummary: {title: '真实文章：' + article.title, href: article.url,
  publishedAt: article.publishedAt}, path: article.url, topics: []},
{contentSummary: {title: '固定 HTML 样本：标题、列表、引用、实体和图片', href: fixtureUrl,
  publishedAt: Date.now()}, path: fixtureUrl, topics: []}];
const toc = {results: [{out_of: 2, found: 2, hits: docs.map(document => ({document}))}]};
const tocUrl = article.url + ',' + JSON.stringify({bodyJs: 'JSON.stringify(' + safeJs(toc) + ')', timeout: 20000});
assert.equal(eval(JSON.parse(fixtureUrl.slice(fixtureUrl.indexOf(',') + 1)).bodyJs), fixture,
  'response option must restore the exact HTML fixture');
assert(!JSON.parse(fixtureUrl.slice(fixtureUrl.indexOf(',') + 1)).bodyJs.includes('&'), 'premature entity decoding remains possible');
async function request(route, body) {
  const response = await fetch('http://' + state.host + ':1122' + route, {
    ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
    signal: AbortSignal.timeout(30000)});
  const value = await response.json(); assert(response.ok && value.isSuccess !== false, 'phone request failed');
  return Array.isArray(value) ? value : value.data;
}
(async () => {
  const book = (await request('/getBookshelf')).find(b => b.bookUrl === record.bookUrl);
  assert(book && book.origin === TEST_ID && book.name === record.book.name && book.author === 'usehtml-validation', 'book ownership mismatch');
  assert.equal(book.totalChapterNum, 0, 'do not rewrite a book whose old TOC has already been cached');
  book.tocUrl = tocUrl;
  await request('/saveBook', book);
  const saved = (await request('/getBookshelf')).find(b => b.bookUrl === record.bookUrl);
  assert.equal(saved.tocUrl, tocUrl, 'response option readback mismatch');
  record.book.tocUrl = tocUrl;
  record.entityEncoding = 'protected JavaScript Unicode escapes; exact restoration checked';
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
  fs.writeFileSync(path.join(DIR, 'inline-response-options.json'), JSON.stringify({tocUrl, fixtureUrl}, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({name: book.name, entityInput: 'exact and protected', changed: 'owned book tocUrl only'}));
})().catch(error => {console.error(error.message); process.exitCode = 1;});
