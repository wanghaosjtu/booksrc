#!/usr/bin/env node
/* Controlled URL response options; the deployed source rules stay unchanged. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {ROOT, TEST_ID} = require('./build_usehtml_validation');
const {sources} = require('./phone_source_client');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const STATE = path.join(DIR, 'state.json');
const host = process.env.LEGADO_PHONE;
assert(host, 'explicit LEGADO_PHONE required');
const state = JSON.parse(fs.readFileSync(STATE));
assert.equal(state.host, host, 'wrong phone state');
assert.equal(state.sourceId, TEST_ID, 'wrong experimental source');
assert.equal(state.sourceStatus, 'deployed', 'experimental source not deployed');
assert(!state.books.some(b => b.kind === 'inline'), 'inline fixture already attempted');
const {article} = JSON.parse(fs.readFileSync(path.join(DIR, 'article.json')));
assert(/^https:\/\/carnegieendowment\.org\/research\//.test(article.url), 'actual research article required');
const write = (file, value, exclusive = false) => fs.writeFileSync(path.join(DIR, file), JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: exclusive ? 'wx' : 'w'});
const safeJs = value => JSON.stringify(value).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
function curl(url, referer) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-'], {stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = []; let stderr = '';
    child.stdout.on('data', data => chunks.push(data)); child.stderr.on('data', data => stderr += data);
    const lines = ['silent', 'show-error', 'fail', 'location', 'max-time = 45', 'url = ' + JSON.stringify(url)];
    if (referer) lines.push('header = ' + JSON.stringify('Referer: ' + referer));
    child.stdin.end(lines.join('\n') + '\n');
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('curl failed: ' + stderr.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 150))));
  });
}
function attribute(tag, name) {
  const match = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\x27])([^]*?)\\1', 'i'));
  return match ? match[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
}
async function request(route, body) {
  const response = await fetch('http://' + host + ':1122' + route, {
    ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  assert(response.ok && data.isSuccess !== false, 'phone request failed');
  return Array.isArray(data) ? data : data.data;
}
(async () => {
  const html = (await curl(article.url)).toString('utf8');
  const meta = (html.match(/<meta\b[^>]*>/gi) || []).find(tag => attribute(tag, 'property') === 'og:image');
  assert(meta, 'actual article has no og:image; no placeholder image will be used');
  const image = new URL(attribute(meta, 'content'), article.url).href;
  assert(/^https?:\/\//.test(image), 'actual HTTP article image required');
  const bytes = await curl(image, article.url);
  assert(bytes.length > 1000 && (bytes[0] === 255 && bytes[1] === 216 || bytes[0] === 137 && bytes[1] === 80
    || bytes.subarray(0, 3).toString() === 'GIF' || bytes.subarray(0, 4).toString() === 'RIFF'), 'actual raster image bytes required');
  fs.writeFileSync(path.join(DIR, 'inline-article-image.bin'), bytes, {mode: 0o600, flag: 'wx'});
  write('inline-article-image.json', {article: article.url, image,
    source: 'actual article og:image, verified with curl', bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')}, true);
  let fixture = fs.readFileSync(path.join(ROOT, 'booksource/fixtures/usehtml-validation.html'), 'utf8');
  fixture = fixture.replace('../figures/usehtml.png', image.replace(/&/g, '&amp;'))
    .replace('href="../research"', 'href="../../../research"')
    .replace('下面的相对图片地址是离线测试占位；手机测试时替换为真实正文图片。', '下面使用真实文章的分享封面图片，图片字节已经 curl 验证。');
  fs.writeFileSync(path.join(DIR, 'inline-fixture.html'), fixture, {mode: 0o600, flag: 'wx'});
  const fixtureUrl = article.url + ',' + JSON.stringify({bodyJs: safeJs(fixture), timeout: 20000});
  const documents = [{contentSummary: {title: '真实文章：' + article.title,
    href: article.url, publishedAt: article.publishedAt}, path: article.url, topics: []},
  {contentSummary: {title: '固定 HTML 样本：标题、列表、引用、实体和图片', href: fixtureUrl,
    publishedAt: new Date().getTime()}, path: fixtureUrl, topics: []}];
  const toc = {results: [{out_of: 2, found: 2, hits: documents.map(document => ({document}))}]};
  const tocUrl = article.url + ',' + JSON.stringify({bodyJs: 'JSON.stringify(' + safeJs(toc) + ')', timeout: 20000});
  const bookUrl = 'https://carnegieendowment.org/research#usehtml-validation-' + state.token + '-inline';
  assert(!(await request('/getBookshelf')).some(b => b.bookUrl === bookUrl), 'test book ID collision');
  const book = {bookUrl, tocUrl, origin: state.sourceId, originName: 'Carnegie endowment · HTML验证',
    name: 'HTML 验证 UHV-' + state.token.slice(0, 8) + ' · 响应样本', author: 'usehtml-validation',
    canUpdate: false, durChapterIndex: 0, durChapterPos: 0};
  const record = {kind: 'inline', bookUrl, book, status: 'creating'};
  state.books.push(record); write('state.json', state);
  await request('/saveBook', book);
  const actual = (await request('/getBookshelf')).find(b => b.bookUrl === bookUrl);
  assert(actual && actual.name === book.name && actual.origin === state.sourceId, 'test book readback mismatch');
  record.status = 'created'; write('state.json', state);
  const candidate = JSON.parse(fs.readFileSync(path.join(DIR, 'candidate.json')))[0];
  const source = (await sources()).find(s => s.bookSourceUrl === state.sourceId);
  for (const key of ['ruleContent', 'ruleToc', 'ruleBookInfo', 'ruleExplore', 'ruleSearch', 'header', 'jsLib', 'loginUi', 'loginUrl']) {
    assert.deepEqual(source[key], candidate[key], 'deployed source was changed at ' + key);
  }
  console.log(JSON.stringify({name: book.name, bookUrl, kind: record.kind, chapters: 2,
    responseOptions: 'controlled test book only', sourceRules: 'unchanged', actualImageBytes: bytes.length}, null, 2));
})().catch(error => {console.error(error.message.replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1;});
