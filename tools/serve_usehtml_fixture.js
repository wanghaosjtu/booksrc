#!/usr/bin/env node
/* Phone-scoped two-chapter fixture. No private backups are served. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {ROOT} = require('./build_usehtml_validation');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const phone = process.env.LEGADO_PHONE, host = process.argv[2];
assert(phone && host && /^[0-9.]+$/.test(host), 'explicit phone and host interface required');
const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json')));
assert.equal(state.host, phone, 'wrong phone state');
const {article} = JSON.parse(fs.readFileSync(path.join(DIR, 'article.json')));
assert(/^https:\/\/carnegieendowment\.org\/research\//.test(article.url), 'genuine research article required');
const stats = {toc: 0, fixture: 0, fixtureReady: 0, image: 0, health: 0, rejected: 0};
let origin, fixture, image, imagePromise;
const write = (file, value) => fs.writeFileSync(path.join(DIR, file), JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-'], {stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = []; let stderr = '';
    child.stdout.on('data', data => chunks.push(data)); child.stderr.on('data', data => stderr += data);
    child.stdin.end('silent\nshow-error\nfail\nlocation\nmax-time = 45\nurl = ' + JSON.stringify(url) + '\n');
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('article image download failed: ' + stderr.slice(0, 100))));
  });
}
function imageType(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216) return 'image/jpeg';
  if (bytes.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (/<svg[\s>]/i.test(bytes.subarray(0, 1000).toString())) return 'image/svg+xml';
  throw new Error('actual image bytes required, not an HTTP error page');
}
async function prepareFixture() {
  if (fixture) return fixture;
  const cached = JSON.parse(fs.readFileSync(path.join(DIR, 'real-first.json')));
  const chapters = JSON.parse(fs.readFileSync(path.join(DIR, 'fixture-chapters.json')));
  assert.equal(cached.kind, 'fixture', 'real article must come through the two-chapter test book');
  const chapter = chapters.find(c => c.index === cached.index);
  assert(chapter && chapter.url.replace(/,\s*\{[\s\S]*$/, '') === article.url, 'cached chapter is not the genuine article');
  const source = [...cached.content.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)]
    .map(m => m[1]).find(src => /^https?:\/\//.test(src));
  assert(source, 'downloaded real article has no image; never serve the placeholder');
  if (!imagePromise) imagePromise = (async () => {
    const url = source.replace(/,\s*\{[\s\S]*$/, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const bytes = await fetchImage(url), type = imageType(bytes);
    fs.writeFileSync(path.join(DIR, 'article-image.bin'), bytes, {mode: 0o600, flag: 'wx'});
    write('article-image.json', {source: url, type, bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')});
    image = {bytes, type};
  })();
  await imagePromise;
  fixture = fs.readFileSync(path.join(ROOT, 'booksource/fixtures/usehtml-validation.html'), 'utf8')
    .replace('../figures/usehtml.png', './article-image')
    .replace('href="../research"', 'href="./health"')
    .replace('下面的相对图片地址是离线测试占位；手机测试时替换为真实正文图片。', '下面的相对图片地址使用已下载真实正文中的同一张图片镜像，不使用占位图。');
  fs.writeFileSync(path.join(DIR, 'fixture.html'), fixture, {mode: 0o600, flag: 'wx'});
  return fixture;
}
const server = http.createServer(async (request, response) => {
  const address = request.socket.remoteAddress.replace(/^::ffff:/, '');
  if (![phone, host, '127.0.0.1'].includes(address)) {
    stats.rejected++; write('server-stats.json', stats); response.writeHead(403); response.end(); return;
  }
  if (request.method !== 'GET') {response.writeHead(405); response.end(); return;}
  const route = request.url.split('?')[0];
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (route === '/health') {
      stats.health++; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end('usehtml-validation-fixture');
    } else if (route === '/fixture.html') {
      stats.fixture++; const html = await prepareFixture(); stats.fixtureReady++;
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
    } else if (route === '/article-image') {
      await prepareFixture(); stats.image++; response.setHeader('Content-Type', image.type); response.end(image.bytes);
    } else if (route === '/toc.json') {
      stats.toc++; response.setHeader('Content-Type', 'application/json; charset=utf-8');
      const documents = [{contentSummary: {title: article.title, href: article.url,
        publishedAt: article.publishedAt}, path: article.url, topics: []},
      {contentSummary: {title: '固定 HTML 样本：标题、列表、引用、实体和图片',
        href: origin + '/fixture.html', publishedAt: new Date().getTime()}, path: origin + '/fixture.html', topics: []}];
      response.end(JSON.stringify({results: [{out_of: 2, found: 2, hits: documents.map(document => ({document}))}]}));
    } else if (route === '/stats') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(stats));
    } else {response.writeHead(404); response.end();}
  } catch (error) {
    response.writeHead(503, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('fixture not ready: ' + error.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 150));
  }
  write('server-stats.json', stats);
});
server.listen(0, host, () => {
  origin = `http://${host}:${server.address().port}`;
  fs.writeFileSync(path.join(DIR, 'server.json'), JSON.stringify({origin, phone, pid: process.pid,
    article: article.url, serves: ['toc.json', 'fixture.html', 'article-image'], createdAt: new Date().toISOString()}, null, 2) + '\n',
  {mode: 0o600, flag: 'wx'});
  write('server-stats.json', stats);
  console.log(JSON.stringify({origin, allowedPhone: phone, chapters: 2,
    image: 'mirrored only after real article download', privateBackups: 'not served'}));
});
function stop() {server.close(() => process.exit(0));}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
