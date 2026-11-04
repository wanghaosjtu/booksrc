#!/usr/bin/env node
/* Offline regression tests for the long-document Edge translation runtime. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

vm.runInThisContext(fs.readFileSync('booksource/runtime/legado-translation-runtime.js', 'utf8'), {
  filename: 'legado-translation-runtime.js',
});

class Cache {
  constructor() { this.values = new Map(); this.puts = []; }
  get(key) { return this.values.has(key) ? this.values.get(key) : null; }
  put(key, value, seconds) { this.values.set(key, value); this.puts.push({key, value, seconds}); }
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
  const authHeaders = [];
  return {
    requests,
    authHeaders,
    authCalls: 0,
    get(key) { return key === 'TARGET_LANG' ? 'zh-Hans' : ''; },
    ajax(url) { if (String(url).indexOf('/translate/auth') >= 0) this.authCalls += 1; return ''; },
    ajaxAll(urls) {
      return urls.map((url) => {
        const options = JSON.parse(url.slice(url.indexOf(',') + 1));
        const body = JSON.parse(options.body);
        requests.push(body);
        authHeaders.push(options.headers.Authorization);
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
  assert.strictEqual(java.authCalls, 0, mode + ': must not request translate auth');
  assert.ok(java.authHeaders.every((value) => value === 'Bearer '), mode + ': must send an empty Bearer token');
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

const scalarJava = fakeJava('normal');
assert.strictEqual(TT('one scalar', scalarJava, new Cache()), 'CTX:one scalar');
assert.strictEqual(scalarJava.authCalls, 0, 'scalar translation must not request translate auth');

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

// Real Jsoup parsing/DOM integration is covered by the phone regression.
// A minimal response adapter keeps these batching/cache tests offline.
global.org = {jsoup: {Jsoup: {parse(html) {
  const text = String(html);
  const match = text.match(/<span class="cc-speech">([\s\S]*?)<\/span>/);
  return {select(selector) {
    return {
      size() { return selector === 'math' && /<math[ >]/.test(text) ? 1 : 0; },
      text() { return selector === 'span.cc-speech' && match ? match[1] : ''; },
    };
  }};
}}}};
const pauses = [];
global.Packages = {java: {lang: {Thread: {sleep(ms) { pauses.push(ms); }}}}};
const equation = '\\begin{equation*}p_i=\\frac{x+\\$y}{\\|z\\|_2}\\tag{1}\\end{equation*}';
for (const [input, expected] of [
  ['$c$', 'c'], [' $\\tau _{1}$ ', '\\tau _{1}'],
  [' $$ x + 1 $$ ', 'x + 1'], ['\\( x \\)', 'x'], ['\\[ x \\]', 'x'],
  ['$' + equation + '$', equation], ['$x+\\$y$', 'x+\\$y'], ['x+\\$y', 'x+\\$y'],
  ['$x+\\$$', 'x+\\$'], ['$\\$$', '\\$'],
  ['$x\\$', '$x\\$'], ['$x', '$x'], ['x$', 'x$'], ['$$x$', '$$x$'],
  ['$x$$', '$x$$'], ['\\(x\\]', '\\(x\\]'], ['$100', '$100'],
  ['Costs $10 and $20.', 'Costs $10 and $20.'], ['$$$$', ''], [new String('$z$'), 'z'], [null, ''],
]) assert.strictEqual(_ltFormulaTex(input), expected, 'outer delimiter normalization: ' + input);
function speechResponse(text) {
  return '<math><mi>x</mi></math><span class="cc-speech">' + text + '</span>';
}
assert.strictEqual(_ltCodecogsSpeechText({body() { return speechResponse(' x  equals\n 1 '); }}), 'x equals 1');
assert.strictEqual(_ltCodecogsSpeechText({body: speechResponse('tau sub 1')}), 'tau sub 1');
for (const response of ['', 'bad reply', '<math/>', '<span class="cc-speech">error</span>',
  speechResponse('   ')]) assert.strictEqual(_ltCodecogsSpeechText(response), '');
const speechCache = new Cache();
const speechJava = {
  waves: [],
  ajax() { throw Error('must not retry serially'); },
  ajaxAll(urls, webView) {
    assert.strictEqual(webView, false);
    this.waves.push(urls.slice());
    // Java-array-shaped responses: indexed access and length, no size/get.
    const result = {length: urls.length};
    urls.forEach((url, index) => {
      const tex = decodeURIComponent(url.slice(url.indexOf('?') + 1));
      result[index] = {body() { return speechResponse('read ' + tex); }};
    });
    return result;
  },
};
const expressions = Array.from({length: 9}, (_, i) => 'x_' + i);
const speech = _ltCodecogsSpeech(expressions.concat(['x_0', '']), speechJava, speechCache);
assert.deepStrictEqual(speechJava.waves.map(wave => wave.length), [4, 4, 1]);
assert.deepStrictEqual(pauses, [500, 500]);
assert.strictEqual(speech['$x_0'], 'read x_0');
assert.strictEqual(speech['$x_8'], 'read x_8');
assert.strictEqual(speechCache.puts.length, 9);
assert.ok(speechCache.puts.every(item => item.seconds === 2592000 && item.key.startsWith('codecogs_speech:v2:')));
assert.deepStrictEqual(_ltCodecogsSpeech(expressions, speechJava, speechCache), speech);
assert.strictEqual(speechJava.waves.length, 3, 'warm speech cache must make zero network requests');
for (const mode of ['throw', 'empty', 'malformed', 'missing']) {
  const cache = new Cache();
  let waves = 0;
  const j = {
    ajax() { throw Error('no single-node retry'); },
    ajaxAll(urls) {
      waves += 1;
      if (mode === 'throw') throw Error('offline');
      if (mode === 'missing') return [];
      return urls.map(() => mode === 'empty' ? '' : 'not mathml');
    },
  };
  assert.deepStrictEqual(_ltCodecogsSpeech(['x', 'x'], j, cache), {});
  assert.deepStrictEqual(_ltCodecogsSpeech(['x'], j, cache), {});
  assert.strictEqual(waves, 2, mode + ': failed responses must not be cached');
  assert.strictEqual(cache.puts.length, 0);
}
const partial = _ltCodecogsSpeech(['a', 'b'], {ajaxAll() { return [speechResponse('a')]; }}, new Cache());
assert.strictEqual(partial.$a, 'a');
assert.strictEqual(partial.$b, undefined, 'missing response must not shift speech to a different formula');
console.log('translation and formula speech runtime regression tests passed');
