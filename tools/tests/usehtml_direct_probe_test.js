'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {buildProbeCode} = require('../usehtml_ieee_direct_probe');
function execute(mode, extra) {
  const messages = [];
  const context = vm.createContext({java: {log: text => messages.push(text)}, ...extra});
  vm.runInContext(buildProbeCode(mode), context);
  const data = messages.find(s => s.startsWith('UHV-DIRECT-IEEE '));
  return {messages, metadata: data && JSON.parse(data.slice('UHV-DIRECT-IEEE '.length))};
}
function frame(name, method) {
  return {getClassName: () => name, getMethodName: () => method, getFileName() { throw Error('must not read files'); }};
}
function thread(id, state) {
  return {getId: () => id, getState: () => state, getName() { throw Error('must not read thread names'); }};
}
test('all read-only probe code parses; unknown modes are rejected', () => {
  for (const mode of ['rest', 'ajaxall', 'mathml', 'cache', 'threads']) new vm.Script(buildProbeCode(mode));
  assert.throws(() => buildProbeCode('release'), /known read-only/);
});
test('cache probe only reads a missing diagnostic key and does not write', () => {
  const seen = [];
  const {metadata} = execute('cache', {cache: {get(key) { seen.push(key); return null; }, put() { throw Error('not allowed'); }}});
  assert.deepEqual(seen, ['usehtml-diagnostic-missing-key-no-write']);
  assert.equal(metadata.completed, true);
  assert.equal(metadata.present, false);
  assert.equal(metadata.cacheWrites, false);
  assert.equal(metadata.externalRequests, false);
});
test('thread projection scans past waiters, prioritizes the inner cache call and reports only synchronization metadata', () => {
  const entries = [];
  for (let i = 0; i < 19; i++) entries.push({getKey: () => thread(i, 'BLOCKED'),
    getValue: () => [frame('io.legado.app.help.CacheManager', 'get'), frame('java.lang.reflect.Method', 'invoke')]});
  entries.push({getKey: () => thread(99, 'TIMED_WAITING'),
    getValue: () => [frame('sun.misc.Unsafe', 'park'), frame('io.legado.app.model.analyzeRule.AnalyzeRule', 'ajaxAll'),
      frame('io.legado.app.help.CacheManager', 'get')]});
  const methods = ['get', 'put', 'delete', 'privateUnrelated'].map(name => ({
    getName: () => name, getModifiers: () => 32, getParameterTypes: () => [null]
  }));
  let index = 0;
  const map = {size: () => entries.length, entrySet: () => ({iterator: () => ({
    hasNext: () => index < entries.length, next: () => entries[index++]
  })})};
  const {metadata, messages} = execute('threads', {
    cache: {getClass: () => ({getMethods: () => methods})},
    Packages: {java: {lang: {
      Thread: {getAllStackTraces: () => map},
      reflect: {Modifier: {isSynchronized: modifiers => !!(modifiers & 32)}}
    }}}
  });
  assert.equal(metadata.supported, true);
  assert.equal(metadata.cacheEntryBlocked, 19);
  assert.equal(metadata.cacheInside, 1);
  assert.equal(metadata.matchingThreads, 20);
  assert.equal(metadata.threads[0].id, 99);
  assert.equal(metadata.threads.length, 6);
  assert.deepEqual(metadata.cacheMethods.map(m => m.name), ['get', 'put', 'delete']);
  assert(metadata.cacheMethods.every(m => m.synchronized));
  assert.equal(metadata.credentials, false);
  assert(!messages.join('\n').includes('privateUnrelated'));
});
