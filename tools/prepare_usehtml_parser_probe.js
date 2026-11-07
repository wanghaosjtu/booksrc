#!/usr/bin/env node
/* Fresh minimal source: real-formula parser control plus HTML download, no site login. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const client = require('./usehtml_http_ws_client');
const {ROOT} = require('./build_usehtml_validation');
const {build: formula} = require('./usehtml_formula_phone_probe');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const HEALTH = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
const read = name => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const write = (name, value, exclusive = true) => fs.writeFileSync(path.join(DIR, name), JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: exclusive ? 'wx' : 'w'});

function build(capture, token, runtime, wrapper, guard) {
  const context = vm.createContext({}); vm.runInContext(guard, context);
  const {key, markup} = formula(capture);
  let code = JSON.parse(key.slice(key.indexOf(',') + 1)).bodyJs;
  assert.equal(code.split(JSON.stringify(markup)).length, 2, 'unique captured literal required');
  // Rule strings, like URLs, must not contain literal inline-rule delimiters.
  code = code.replace(JSON.stringify(markup), context.useHtmlRuleJson(markup));
  const content = '<js>\n' + wrapper + '\nresult=' + code + ';\nresult=useHtmlValidation(result,"https://ieeexplore.ieee.org/document/9737357/");\nresult;\n</js>';
  new vm.Script(content.replace(/^<js>\n/, '').replace(/\n<\/js>$/, ''));
  assert(!content.includes('{{'), 'probe rule must not accidentally interpolate captured TeX');
  const candidate = {
    bookSourceUrl: 'https://ieeexplore.ieee.org#usehtml-parser-' + token.slice(0, 8),
    bookSourceName: 'IEEE · HTML解析器短验证 ' + token.slice(0, 8),
    bookSourceType: 0, enabled: true, enabledExplore: false, concurrentRate: '1',
    header: '{"proxy":""}', jsLib: runtime,
    ruleToc: {chapterList: '@js:[1]', chapterName: '@js:"IEEE 9737357 · 公式请求短验证"', chapterUrl: '@js:' + JSON.stringify(HEALTH), nextTocUrl: ''},
    ruleContent: {content, imageStyle: 'FULL'}
  };
  return candidate;
}

async function deploy() {
  const state = read('state.json');
  assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'matching explicit phone required');
  assert.equal(state.sourceStatus, 'deployed');
  assert(!state.books.some(b => b.kind === 'parser'), 'parser probe already attempted');
  const candidate = build(read('ieee-rest-browser-first-v1.json'), state.token,
    fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-validation.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-rule-json.js'), 'utf8'));
  const before = await client.sources(), books = await client.request('/getBookshelf');
  assert(!before.some(s => s.bookSourceUrl === candidate.bookSourceUrl), 'parser source collision');
  const bookUrl = 'https://ieeexplore.ieee.org/document/9737357/#usehtml-validation-' + state.token + '-parser';
  assert(!books.some(b => b.bookUrl === bookUrl), 'parser book collision');
  write('ieee-parser-sources-before-v1.json', before);
  write('ieee-parser-books-before-v1.json', books);
  write('ieee-parser-candidate-v1.json', [candidate]);
  const extra = {id: candidate.bookSourceUrl, kind: 'parser', candidate: 'ieee-parser-candidate-v1.json', status: 'deploying'};
  state.extraSources.push(extra); write('state.json', state, false);
  await client.save(candidate, ['bookSourceName', 'bookSourceUrl', 'header', 'jsLib', 'ruleToc', 'ruleContent']);
  extra.status = 'deployed'; write('state.json', state, false);
  const after = (await client.sources()).filter(s => s.bookSourceUrl !== extra.id);
  assert.equal(client.changedPaths(before, after).length, 0, 'another source changed during parser probe deployment');
  const book = {bookUrl, tocUrl: HEALTH, origin: extra.id, originName: candidate.bookSourceName,
    name: 'HTML 验证 UHV-' + state.token.slice(0, 8) + ' · IEEE解析器短样本', author: 'usehtml-validation',
    canUpdate: false, totalChapterNum: 0, durChapterIndex: 0, durChapterPos: 0};
  const record = {kind: 'parser', bookUrl, book, status: 'creating'};
  state.books.push(record); write('state.json', state, false);
  await client.request('/saveBook', book);
  const actual = (await client.request('/getBookshelf')).find(b => b.bookUrl === bookUrl);
  assert(actual && actual.origin === extra.id && actual.name === book.name && actual.author === book.author, 'parser book ownership mismatch');
  record.status = 'created'; write('state.json', state, false);
  return {kind: 'parser', sourceReadback: 'verified', books: 1, source: 'fresh minimal control',
    unrelatedSources: 'unchanged during deployment', originalLoginRestored: false, translationService: false};
}

module.exports = {build};
if (require.main === module) deploy().then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(error => {console.error(JSON.stringify(client.errorDetails(error))); process.exitCode = 1;});
