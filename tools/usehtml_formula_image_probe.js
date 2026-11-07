#!/usr/bin/env node
/* Fetch one public Codecogs formula through the owned book's App image endpoint. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const client = require('./usehtml_http_ws_client');
const {ROOT} = require('./build_usehtml_validation');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const read = name => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

async function run(label) {
  assert(label && /^[a-zA-Z0-9_-]+$/.test(label), 'fresh explicit evidence label required');
  assert(!fs.existsSync(path.join(DIR, label + '.json')) && !fs.existsSync(path.join(DIR, label + '.png')), 'image evidence already exists');
  const state = read('state.json');
  assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'matching explicit phone required');
  const book = state.books.find(b => b.kind === 'parser' && b.status === 'created');
  assert(book, 'owned parser book required');
  const html = read('ieee-parser-content-first-v1.json').content;
  const match = html.match(/<p\b[^>]*\bid="uhv-real-tex"[^>]*>([^<]*)<\/p>/);
  assert(match && !match[1].includes('&') && match[1].replace(/\s+/g, '').includes('{{d\\mathrm{snr}'), 'exact actual cached derivative required');
  assert.equal(await client.request('/getJsSourceApiTokenRequired'), false, 'do not guess or disable Web token policy');
  const image = 'https://latex.codecogs.com/svg.latex?' + encodeURIComponent(match[1]);
  const url = 'http://' + state.host + ':1122/image?url=' + encodeURIComponent(book.bookUrl) + '&path=' + encodeURIComponent(image) + '&width=640';
  const started = Date.now();
  const response = await fetch(url, {signal: AbortSignal.timeout(45000)});
  const type = response.headers.get('content-type') || '';
  const result = {kind: 'single-real-formula-App-image-endpoint', httpStatus: response.status,
    contentType: type, elapsedMs: Date.now() - started, fullIeeePipeline: false, bookHtmlContainsImage: false};
  if (response.ok && /^image\//.test(type)) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'expected App PNG bitmap');
    result.bytes = bytes.length; result.width = bytes.readUInt32BE(16); result.height = bytes.readUInt32BE(20);
    result.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(DIR, label + '.png'), bytes, {mode: 0o600, flag: 'wx'});
  }
  fs.writeFileSync(path.join(DIR, label + '.json'), JSON.stringify(result, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  return {label, ...result};
}
if (require.main === module) run(process.argv[2]).then(result => {
  console.log(JSON.stringify(result, null, 2)); if (!result.bytes) process.exitCode = 1;
}).catch(error => {console.error(JSON.stringify(client.errorDetails(error))); process.exitCode = 1;});
