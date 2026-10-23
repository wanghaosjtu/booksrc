#!/usr/bin/env node
/* Offline regression tests for the long-document Edge translation runtime. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

vm.runInThisContext(fs.readFileSync('booksource/runtime/legado-translation-runtime.js', 'utf8'), {
  filename: 'legado-translation-runtime.js',
});

class Cache {
  constructor() { this.values = new Map(); }
  get(key) { return this.values.has(key) ? this.values.get(key) : null; }
  put(key, value) { this.values.set(key, value); }
}

function labeledTranslation(value, mode) {
  const marker = /<\|L(\d+)\|>/g;
  const found = [];
  let match;
  while ((match = marker.exec(value)) !== null) {
    found.push({id: match[1], start: match.index, end: marker.lastIndex});
  }
  let output = '';
  for (let i = 0; i < found.length; i += 1) {
    const item = found[i];
    const next = found[i + 1];
    let label = '<|L' + item.id + '|>';
    if (mode === 'spaced') label = '< | L' + item.id + ' | >';
    if (mode === 'missing' && item.id === '2') label = '';
    output += label + '\nCTX:' + value.slice(item.end, next ? next.start : value.length).trim() + '\n';
  }
  return output;
}

function fakeJava(mode) {
  const requests = [];
  return {
    requests,
    get(key) { return key === 'TARGET_LANG' ? 'zh-Hans' : ''; },
    ajax() { return ''; },
    ajaxAll(urls) {
      return urls.map((url) => {
        const options = JSON.parse(url.slice(url.indexOf(',') + 1));
        const body = JSON.parse(options.body);
        requests.push(body);
        const value = String(body[0] || '');
        const text = value.indexOf('<|L') >= 0
          ? labeledTranslation(value, mode)
          : 'ONE:' + value;
        return JSON.stringify([{translations: [{text}]}]);
      });
    },
  };
}

function checkMode(mode) {
  const java = fakeJava(mode);
  const cache = new Cache();
  const input = ['3) UL MU-MIMO and MU-MIMO-OFDMA:', '802.11bn', 'AC Access category'];
  const output = TT(input, java, cache);
  assert.strictEqual(java.requests[0].length, 1, mode + ': must send one long value');
  assert.ok(java.requests[0][0].indexOf('<|L1|>') >= 0, mode + ': missing numbered marker');
  return {java, cache, output};
}

const normal = checkMode('normal');
assert.deepStrictEqual(normal.output, ['CTX:3) UL MU-MIMO and MU-MIMO-OFDMA:', 'CTX:802.11bn', 'CTX:AC Access category']);
const spaced = checkMode('spaced');
assert.deepStrictEqual(spaced.output, normal.output);
const missing = checkMode('missing');
assert.deepStrictEqual(missing.output, ['ONE:3) UL MU-MIMO and MU-MIMO-OFDMA:', 'ONE:802.11bn', 'CTX:AC Access category']);

const before = normal.java.requests.length;
assert.deepStrictEqual(TT(['3) UL MU-MIMO and MU-MIMO-OFDMA:', '802.11bn', 'AC Access category'], normal.java, normal.cache), normal.output);
assert.strictEqual(normal.java.requests.length, before, 'individual results must be cached');

const failedCache = new Cache();
const failedJava = {
  requests: [],
  get(key) { return key === 'TARGET_LANG' ? 'zh-Hans' : ''; },
  ajax() { return ''; },
  ajaxAll(urls) {
    this.requests.push.apply(this.requests, urls);
    return urls.map(() => 'not-json');
  },
};
assert.strictEqual(TT(['retry me'], failedJava, failedCache)[0], 'retry me');
const failedCount = failedJava.requests.length;
assert.strictEqual(TT(['retry me'], failedJava, failedCache)[0], 'retry me');
assert.ok(failedJava.requests.length > failedCount, 'failed translations must not be cached');

const java = fakeJava('normal');
const json = JSON.parse(TJ(JSON.stringify({
  articleTitle: 'A title',
  abstract: 'An abstract',
  htmlLink: 'https://example.test/a',
  accessType: {type: 'locked'},
}), java, new Cache(), ['articleTitle', 'abstract']));
assert.ok(json.articleTitle.indexOf('CTX:') === 0);
assert.ok(json.abstract.indexOf('CTX:') === 0);
assert.strictEqual(json.htmlLink, 'https://example.test/a');
assert.strictEqual(json.accessType.type, 'locked');

console.log('translation runtime regression tests passed');
