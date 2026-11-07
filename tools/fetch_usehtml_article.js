#!/usr/bin/env node
/* Read the exact phone-generated TOC via the existing host proxy. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {ROOT} = require('./build_usehtml_validation');
const {resultText} = require('./phone_source_client');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const packet = JSON.parse(fs.readFileSync(path.join(DIR, 'real-toc-address.json')));
assert(!packet.isError, 'phone did not generate a TOC address');
const text = resultText(packet), marker = '-- 结果 --\n';
const start = text.indexOf(marker) + marker.length;
const {tocUrl} = JSON.parse(text.slice(start, text.indexOf('\n\n耗时', start)));
const at = tocUrl.search(/,\s*\{/);
assert(at >= 0, 'expected original source URL options');
const url = tocUrl.slice(0, at), options = JSON.parse(tocUrl.slice(at + 1));
assert.equal(new URL(url).hostname, 'search.carnegieendowment.org', 'refusing another host');
assert.equal(new URL(url).protocol, 'https:', 'HTTPS required');
let headers = options.headers || options.header || {};
if (typeof headers === 'string') headers = JSON.parse(headers);
const quote = value => JSON.stringify(String(value));
const lines = ['silent', 'show-error', 'fail', 'max-time = 45',
  'url = ' + quote(url), 'request = ' + quote((options.method || 'GET').toUpperCase())];
for (const [key, value] of Object.entries(headers)) {
  assert(!/[\r\n]/.test(key + value), 'invalid HTTP header');
  lines.push('header = ' + quote(key + ': ' + value));
}
if (options.body != null) lines.push('data = ' + quote(typeof options.body === 'string' ? options.body : JSON.stringify(options.body)));
const child = spawn('curl', ['--config', '-'], {stdio: ['pipe', 'pipe', 'pipe']});
let stdout = '', stderr = '';
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
child.stdin.end(lines.join('\n') + '\n');
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('close', code => {
  try {
    assert.equal(code, 0, 'curl failed: ' + stderr.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 200));
    const json = JSON.parse(stdout), hits = json.results[0].hits;
    const articles = hits.map(hit => {
      const document = hit.document;
      let href = String(document.contentSummary.href || document.path);
      if (!/^https?:/i.test(href)) href = 'https://carnegieendowment.org' + href;
      return {title: String(document.contentSummary.title), url: href,
        publishedAt: document.contentSummary.publishedAt};
    });
    const article = articles.find(a => /^https?:\/\/(?:[^/]+\.)?carnegieendowment\.org\/research\//i.test(a.url));
    assert(article, 'no genuine Carnegie research article in original TOC');
    const result = {article, fetchedDocuments: hits.length,
      method: 'same phone-generated toc_url request and original document path; host curl with existing proxy'};
    fs.writeFileSync(path.join(DIR, 'article.json'), JSON.stringify(result, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
});
