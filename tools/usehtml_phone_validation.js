#!/usr/bin/env node
/* Opt-in, isolated phone validation. Never writes canonical sources. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const client = require('./usehtml_http_ws_client');
const generator = require('./build_usehtml_validation');
const DIR = path.join(generator.ROOT, 'booksource/.usehtml-validation-phone');
const STATE = path.join(DIR, 'state.json');
const HOST = process.env.LEGADO_PHONE;
assert(HOST, 'set LEGADO_PHONE explicitly; no implicit target phone');
assert(/^[a-zA-Z0-9.:-]+$/.test(HOST), 'invalid phone host');
const HTTP = `http://${HOST}:1122`;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cleanUrl = value => String(value).replace(/[,?#].*$/, '');
function write(file, value, exclusive = false) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: exclusive ? 'wx' : 'w'});
  fs.chmodSync(file, 0o600);
}
function state() {
  const value = read(STATE);
  assert.equal(value.host, HOST, 'refusing to use another phone backup');
  return value;
}
function ownedBook(value, kind = 'real') {
  const books = value.books.filter(b => (b.kind || 'real') === kind);
  assert.equal(books.length, 1, `exactly one owned ${kind} book is required`);
  return books[0];
}
async function request(route, body, timeout = 45000) {
  return client.request(route, body, timeout);
}
async function backup() {
  fs.mkdirSync(DIR, {recursive: true, mode: 0o700});
  fs.chmodSync(DIR, 0o700);
  assert(!fs.existsSync(STATE), 'backup already exists; do not overwrite it');
  const sources = await client.sources();
  const books = await request('/getBookshelf');
  assert(Array.isArray(books), 'invalid bookshelf backup');
  assert(!sources.some(s => s.bookSourceUrl === generator.TEST_ID), 'experimental source ID already exists');
  const candidate = generator.build(sources);
  const token = crypto.randomUUID();
  const value = {host: HOST, createdAt: new Date().toISOString(), token,
    originalId: generator.SOURCE_ID, sourceId: generator.TEST_ID,
    sourceHash: hash(candidate), sourceStatus: 'not-deployed', books: [],
    sourcesBeforeHash: hash(sources), booksBeforeHash: hash(books)};
  write(path.join(DIR, 'sources-before.json'), sources, true);
  write(path.join(DIR, 'books-before.json'), books, true);
  write(path.join(DIR, 'candidate.json'), [candidate], true);
  write(STATE, value, true);
  const original = sources.find(s => s.bookSourceUrl === generator.SOURCE_ID);
  return {sources: sources.length, books: books.length, collision: false,
    sourceName: original.bookSourceName, changed: client.changedPaths(original, candidate)};
}
async function deploy() {
  const value = state();
  assert.equal(value.sourceStatus, 'not-deployed', 'source deployment already attempted; inspect before continuing');
  const candidate = read(path.join(DIR, 'candidate.json'))[0];
  const before = read(path.join(DIR, 'sources-before.json'));
  const live = await client.sources();
  assert(!live.some(s => s.bookSourceUrl === value.sourceId), 'experimental source collision');
  assert.deepEqual(live.find(s => s.bookSourceUrl === value.originalId),
    before.find(s => s.bookSourceUrl === value.originalId), 'original changed since backup');
  value.sourceStatus = 'deploying'; write(STATE, value);
  const saved = await client.save(candidate, ['bookSourceName', 'bookSourceUrl', 'ruleContent.content',
    'ruleToc', 'ruleBookInfo', 'ruleSearch', 'ruleExplore', 'loginUrl', 'loginUi', 'loginCheckJs', 'jsLib',
    'header', 'enabled', 'enabledExplore', 'concurrentRate']);
  value.sourceStatus = 'deployed'; value.savedSourceHash = hash(saved); write(STATE, value);
  const after = await client.sources();
  assert.deepEqual(after.filter(s => s.bookSourceUrl !== value.sourceId), before,
    'unrelated source changed during deployment');
  return {source: saved.bookSourceName, readback: 'verified', unrelatedSources: 'unchanged'};
}
async function debug(key, label = 'debug', sourceId) {
  const value = state();
  assert.equal(value.sourceStatus, 'deployed', 'experimental source is not deployed');
  const target = sourceId || value.sourceId;
  const own = new Set([value.sourceId, ...(value.extraSources || []).filter(s => s.status === 'deployed').map(s => s.id)]);
  assert(own.has(target), 'debug target must be an owned experimental source');
  return recordDebug(key, label, target);
}
async function recordDebug(key, label, target) {
  assert(/^[a-zA-Z0-9_-]+$/.test(label), 'invalid evidence label');
  const file = path.join(DIR, label + '.json');
  assert(!fs.existsSync(file), 'evidence already exists; use a fresh label');
  const result = await client.debug(target, key, target.includes('#usehtml-replay-') ? 300000 : 120000);
  const summary = client.summarizeDebug(result, key);
  result.isError = summary.isError;
  write(file, result, true);
  return {label, ...summary};
}
async function debugIeeeBaseline(label = 'ieee-ws-baseline') {
  const value = state();
  assert.equal(value.sourceStatus, 'deployed', 'experimental source is not deployed');
  assert.equal(ownedBook(value, 'ieee').status, 'created', 'IEEE isolation must already be registered');
  const ieee = require('./build_ieee_usehtml_validation');
  assert((await client.sources()).some(s => s.bookSourceUrl === ieee.SOURCE_ID), 'original IEEE source missing');
  // Rule execution only; Debug passes needSave=false and no record is replaced.
  return recordDebug('--https://ieeexplore.ieee.org/document/9737357/', label, ieee.SOURCE_ID);
}

async function deployIeee() {
  const value = state();
  const ieee = require('./build_ieee_usehtml_validation');
  assert.equal(value.sourceStatus, 'deployed', 'primary experiment must still exist');
  assert(!value.books.some(b => b.kind === 'ieee'), 'IEEE test book creation already attempted');
  assert(!(value.extraSources || []).some(s => s.id === ieee.TEST_ID), 'IEEE source deployment already attempted');
  const candidate = read(path.join(DIR, 'ieee-formula-candidate-v1.json'))[0];
  const original = read(path.join(DIR, 'ieee-formula-before-v1.json'))[0];
  assert.equal(candidate.bookSourceUrl, ieee.TEST_ID, 'wrong IEEE candidate');
  const live = await client.sources();
  assert(!live.some(s => s.bookSourceUrl === ieee.TEST_ID), 'IEEE experimental source collision');
  const current = live.find(s => s.bookSourceUrl === ieee.SOURCE_ID);
  assert(current, 'current IEEE source missing');
  for (const key of ['jsLib', 'header', 'ruleContent', 'ruleToc', 'ruleBookInfo', 'loginUi', 'loginUrl', 'loginCheckJs', 'enabled', 'concurrentRate']) {
    assert(client.changedPaths(original[key], current[key]).length === 0,
      'IEEE edited since candidate snapshot at ' + key + '; preserve it and rebuild');
  }
  const books = await request('/getBookshelf');
  const real = books.find(b => b.name === 'IEEE 6g' && b.origin === ieee.SOURCE_ID);
  assert(real && real.tocUrl, 'known IEEE article collection required');
  const bookUrl = 'https://ieeexplore.ieee.org/document/9737357/#usehtml-validation-' + value.token + '-ieee';
  assert(!books.some(b => b.bookUrl === bookUrl), 'IEEE test book collision');
  const book = {bookUrl, tocUrl:real.tocUrl, origin:ieee.TEST_ID, originName:candidate.bookSourceName,
    name:'HTML 验证 UHV-' + value.token.slice(0,8) + ' · IEEE公式', author:'usehtml-validation',
    canUpdate:false, totalChapterNum:0, durChapterIndex:0, durChapterPos:0};
  if (real.variable) book.variable = real.variable;
  write(path.join(DIR, 'ieee-sources-before-deploy-v1.json'), live, true);
  write(path.join(DIR, 'ieee-books-before-deploy-v1.json'), books, true);
  const extra = {id:ieee.TEST_ID, kind:'ieee', candidate:'ieee-formula-candidate-v1.json', status:'deploying'};
  value.extraSources = value.extraSources || []; value.extraSources.push(extra); write(STATE, value);
  await client.save(candidate, ['bookSourceName', 'bookSourceUrl', 'header', 'jsLib', 'ruleContent', 'ruleToc', 'loginUrl', 'loginUi']);
  extra.status = 'deployed'; write(STATE, value);
  const after = await client.sources();
  const unowned = after.filter(s => s.bookSourceUrl !== ieee.TEST_ID);
  assert(client.changedPaths(live, unowned).length === 0, 'another source changed during isolated deployment');
  const record = {kind:'ieee', bookUrl, book, status:'creating'};
  value.books.push(record); write(STATE, value);
  await request('/saveBook', book);
  const saved = (await request('/getBookshelf')).find(b => b.bookUrl === bookUrl);
  assert(saved && saved.origin === ieee.TEST_ID && saved.name === book.name && saved.author === book.author,
    'IEEE test book ownership readback mismatch');
  record.status = 'created'; write(STATE, value);
  return {name:saved.name, kind:'ieee', source:'isolated', sourceReadback:'verified',
    unrelatedSources:'unchanged during deployment', articleTarget:'9737357', originalBooks:'not modified'};
}

async function createBook(tocUrl, kind = 'real') {
  const value = state();
  assert.equal(value.sourceStatus, 'deployed', 'experimental source is not deployed');
  assert(['real', 'fixture'].includes(kind), 'invalid test book kind');
  assert(!value.books.some(b => (b.kind || 'real') === kind), 'test book creation already attempted');
  assert(/^https?:\/\//.test(tocUrl), 'an actual TOC URL is required');
  const bookUrl = generator.SOURCE_ID + '/research#usehtml-validation-' + value.token + '-' + kind;
  assert(!(await request('/getBookshelf')).some(b => b.bookUrl === bookUrl), 'test book collision');
  const book = {bookUrl, tocUrl, origin: value.sourceId, originName: 'Carnegie endowment · HTML验证',
    name: 'HTML 验证 UHV-' + value.token.slice(0, 8) + (kind === 'fixture' ? ' · 固定样本' : ' · 真实文章'),
    author: 'usehtml-validation', canUpdate: false, durChapterIndex: 0, durChapterPos: 0};
  value.books.push({kind, bookUrl, book, status: 'creating'}); write(STATE, value);
  await request('/saveBook', book);
  const saved = (await request('/getBookshelf')).find(b => b.bookUrl === bookUrl);
  assert(saved && saved.origin === value.sourceId && saved.name === book.name, 'test book readback mismatch');
  value.books[value.books.length - 1].status = 'created'; write(STATE, value);
  return {name: saved.name, bookUrl, origin: saved.origin, kind};
}
async function ws(kind = 'inline', phase = 'toc', label = 'ws-' + kind + '-' + phase) {
  const record = ownedBook(state(), kind);
  assert.equal(record.status, 'created', 'owned test book must exist');
  let key;
  if (phase === 'toc') key = '++' + record.book.tocUrl;
  else if (phase === 'fixed') {
    assert.equal(kind, 'inline', 'fixed response belongs only to the inline test book');
    key = '--' + read(path.join(DIR, 'inline-response-options.json')).fixtureUrl;
  } else if (phase === 'real') key = '--' + read(path.join(DIR, 'article.json')).article.url;
  else if (/^\d+$/.test(phase)) {
    const chapterFile = record.chaptersFile || kind + '-chapters.json';
    assert(/^[a-zA-Z0-9_-]+\.json$/.test(chapterFile), 'invalid owned chapter evidence path');
    const chapters = read(path.join(DIR, chapterFile));
    const chapter = chapters.find(c => c.index === Number(phase));
    assert(chapter && chapter.url, 'a saved actual chapter is required');
    const url = /^https?:\/\//.test(chapter.url) ? chapter.url : new URL(chapter.url, record.book.origin).href;
    key = '--' + url;
  } else throw new Error('phase must be toc, fixed, real or a chapter index');
  return debug(key, label, record.book.origin);
}
async function fetchChapters(kind, label, refresh) {
  const value = state(), record = ownedBook(value, kind);
  assert.equal(record.status, 'created', 'owned test book must exist');
  const name = label || kind + '-chapters';
  assert(/^[a-zA-Z0-9_-]+$/.test(name), 'invalid chapter evidence label');
  const file = path.join(DIR, name + '.json');
  assert(!fs.existsSync(file), 'chapter evidence exists; use a fresh label');
  const route = refresh ? '/refreshToc?url=' : '/getChapterList?url=';
  const list = await request(route + encodeURIComponent(record.bookUrl));
  assert(Array.isArray(list) && list.length, 'empty test chapter list');
  write(file, list, true);
  record.chaptersFile = name + '.json'; write(STATE, value);
  return {kind, count: list.length, first: list.slice(0, 5).map(c => ({index: c.index, title: c.title, url: cleanUrl(c.url)}))};
}
async function chapters(kind = 'real', label) {
  return fetchChapters(kind, label, false);
}
async function refreshChapters(kind, label) {
  assert(kind && label, 'explicit owned kind and fresh evidence label required');
  return fetchChapters(kind, label, true);
}
async function content(index, label = 'content', kind = 'real') {
  const book = ownedBook(state(), kind);
  assert(/^\d+$/.test(index), 'chapter index must be a nonnegative integer');
  assert(/^[a-zA-Z0-9_-]+$/.test(label), 'invalid evidence label');
  const file = path.join(DIR, label + '.json');
  assert(!fs.existsSync(file), 'evidence already exists; use a fresh label');
  const text = await request('/getBookContent?url=' + encodeURIComponent(book.bookUrl) + '&index=' + index,
    undefined, kind.startsWith('replay-') ? 600000 : 45000);
  assert.equal(typeof text, 'string', 'invalid chapter content response');
  write(file, {index: Number(index), kind, content: text, sha256: hash(text)}, true);
  return {kind, index: Number(index), length: text.length, sha256: hash(text),
    usehtml: /<usehtml>/.test(text), headings: (text.match(/<h[1-6]\b/g) || []).length,
    images: (text.match(/<img\b/g) || []).length, prefix: text.slice(0, 350), suffix: text.slice(-250)};
}
async function image(label = 'fixture-first', kind = 'fixture') {
  assert(/^[a-zA-Z0-9_-]+$/.test(label), 'invalid evidence label');
  const book = ownedBook(state(), kind);
  const text = read(path.join(DIR, label + '.json')).content;
  const urls = [...text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
  const src = urls.find(url => /^https?:\/\//.test(url));
  assert(src, 'a real article image is required');
  const response = await fetch(HTTP + '/image?url=' + encodeURIComponent(book.bookUrl) + '&path=' + encodeURIComponent(src) + '&width=640', {signal: AbortSignal.timeout(90000)});
  assert(response.ok && /^image\//.test(response.headers.get('content-type') || ''), 'App image cache returned an error');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'expected actual App PNG bitmap');
  const file = path.join(DIR, label + '-image.png');
  fs.writeFileSync(file, bytes, {mode: 0o600, flag: 'wx'});
  const result = {kind, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
  write(path.join(DIR, label + '-image.json'), result, true);
  return result;
}
async function verify(label) {
  const value = state(), before = read(path.join(DIR, 'sources-before.json'));
  const ownSourceIds = new Set([value.sourceId, ...(value.extraSources || []).map(s => s.id)]);
  const live = await client.sources();
  const oldBySource = new Map(before.map(s => [s.bookSourceUrl, s]));
  const unrelated = live.filter(s => !ownSourceIds.has(s.bookSourceUrl));
  const sourceDifferences = [];
  if (unrelated.length !== before.length) sourceDifferences.push({name:'source-count', changed:['count']});
  for (const source of unrelated) {
    const old = oldBySource.get(source.bookSourceUrl);
    const changed = old ? client.changedPaths(old, source) : ['new-source'];
    if (changed.length) sourceDifferences.push({name:source.bookSourceName, changed});
  }
  for (const old of before) if (!unrelated.some(s => s.bookSourceUrl === old.bookSourceUrl)) sourceDifferences.push({name:old.bookSourceName, changed:['missing-source']});
  const oldBooks = read(path.join(DIR, 'books-before.json')), liveBooks = await request('/getBookshelf');
  const owned = new Set(value.books.map(b => b.bookUrl)), oldByUrl = new Map(oldBooks.map(b => [b.bookUrl, b]));
  const differences = [];
  for (const book of liveBooks) {
    if (owned.has(book.bookUrl)) continue;
    const old = oldByUrl.get(book.bookUrl);
    if (!old || hash(old) !== hash(book)) differences.push({name: book.name, changed: old ? client.changedPaths(old, book) : ['new-book']});
  }
  for (const book of oldBooks) if (!liveBooks.some(b => b.bookUrl === book.bookUrl)) differences.push({name: book.name, changed: ['missing-book']});
  const result = {unrelatedSources: sourceDifferences.length ? 'changed since backup; preserved' : 'unchanged',
    otherSourceDifferences:sourceDifferences, oldBooks: oldBooks.length, ownedBooks: value.books.length,
    remainingOwnedSources: live.filter(s => ownSourceIds.has(s.bookSourceUrl)).length,
    otherBookDifferences: differences};
  if (!label) return result;
  assert(/^[a-zA-Z0-9_-]+$/.test(label), 'invalid verification evidence label');
  write(path.join(DIR, label + '.json'), {observedAt:new Date().toISOString(), ...result}, true);
  const fields = {};
  for (const change of sourceDifferences) for (const field of change.changed) fields[field] = (fields[field] || 0) + 1;
  return {originalSources:before.length, ownedSources:result.remainingOwnedSources,
    sourceChangedFields:fields,
    originalRulesAndConfig:sourceDifferences.every(d => d.changed.every(p => p === 'customOrder')) ? 'unchanged except ordering' : 'changes preserved',
    oldBooks:result.oldBooks, otherBookDifferences:differences,
    ownedBooks:value.books.map(record => ({kind:record.kind || 'real',
      present:liveBooks.some(b => b.bookUrl === record.bookUrl),
      chapters:liveBooks.find(b => b.bookUrl === record.bookUrl)?.totalChapterNum || 0})), evidence:label};
}
async function cleanup() {
  const value = state(), before = read(path.join(DIR, 'books-before.json'));
  for (const record of value.books) {
    assert(!before.some(b => b.bookUrl === record.bookUrl), 'refusing to delete a pre-existing book');
    const book = (await request('/getBookshelf')).find(b => b.bookUrl === record.bookUrl);
    if (book) {
      assert.equal(book.origin, record.book.origin || value.sourceId, 'owned book origin changed; do not delete');
      assert.equal(book.name, record.book.name, 'owned book name changed; do not delete');
      assert.equal(book.author, 'usehtml-validation', 'owned book author changed; do not delete');
      await request('/deleteBook', book);
      assert(!(await request('/getBookshelf')).some(b => b.bookUrl === record.bookUrl), 'test book deletion did not take effect');
    }
    record.status = 'removed'; write(STATE, value);
  }
  assert.equal(value.sourceId, generator.TEST_ID, 'refusing to delete another primary source');
  const records = [{id: value.sourceId, candidate: 'candidate.json'}, ...(value.extraSources || [])];
  for (const record of records) {
    assert(/^[a-zA-Z0-9._-]+\.json$/.test(record.candidate), 'invalid owned candidate file');
    if (record.id !== value.sourceId) {
      const ieeeId = require('./build_ieee_usehtml_validation').TEST_ID;
      assert(record.id === generator.SOURCE_ID + '#usehtml-http-local-' + value.token.slice(0, 8) ||
        (record.kind === 'ieee' && record.id === ieeeId && record.candidate === 'ieee-formula-candidate-v1.json') ||
        (record.kind === 'parser' && record.id === 'https://ieeexplore.ieee.org#usehtml-parser-' + value.token.slice(0,8) &&
          record.candidate === 'ieee-parser-candidate-v1.json') ||
        (['replay-legacy','replay-guard'].includes(record.kind) &&
          record.id === require('./build_ieee_usehtml_validation').SOURCE_ID + '#usehtml-' + record.kind + '-' + value.token.slice(0,8) &&
          (record.candidate === 'ieee-' + record.kind + '-candidate-v1.json' ||
            (record.kind === 'replay-guard' &&
              ['ieee-replay-guard-candidate-v2.json','ieee-replay-guard-candidate-v3.json'].includes(record.candidate)))),
        'unrecognized auxiliary source; do not delete');
    }
    const actual = (await client.sources()).find(s => s.bookSourceUrl === record.id);
    if (actual) {
      const candidate = read(path.join(DIR, record.candidate))[0];
      assert.equal(candidate.bookSourceUrl, record.id, 'owned source identity mismatch');
      for (const key of ['bookSourceName', 'jsLib', 'header', 'ruleContent', 'ruleToc', 'loginUi', 'loginUrl']) {
        assert(client.changedPaths(actual[key], candidate[key]).length === 0,
          'experiment edited at ' + key + '; do not delete');
      }
      await client.deleteSources([actual]);
      assert(!(await client.sources()).some(s => s.bookSourceUrl === record.id), 'owned source still exists');
    }
    record.status = 'removed';
  }
  value.sourceStatus = 'removed'; value.cleanedAt = new Date().toISOString(); write(STATE, value);
  const result = await verify();
  assert.equal(result.remainingOwnedSources, 0, 'an experimental source remains');
  return {...result, experimentalRecords: 'removed'};
}
const [command, ...args] = process.argv.slice(2);
(async () => {
  const actions = {backup, deploy, 'deploy-ieee': deployIeee, debug, ws, 'create-book': createBook,
    'debug-ieee-baseline': debugIeeeBaseline, 'refresh-chapters': refreshChapters, chapters, content, image, verify, cleanup};
  assert(actions[command], 'unknown validation command; this tool uses HTTP/WebSocket only');
  const result = await actions[command](...args);
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  if (result && result.isError) process.exitCode = 1;
})().catch(error => {
  console.error(JSON.stringify(client.errorDetails(error)));
  process.exitCode = 1;
});
