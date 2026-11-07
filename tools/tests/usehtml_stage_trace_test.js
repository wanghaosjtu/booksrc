'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const instrument = require('../instrument_usehtml_ieee_replay');
const replay = require('../build_ieee_usehtml_replay');
const {SOURCE_ID} = require('../build_ieee_usehtml_validation');
const runtime = fs.readFileSync(path.join(__dirname, '../../booksource/runtime/legado-translation-runtime.js'), 'utf8');
const base = {bookSourceUrl: SOURCE_ID, bookSourceName: 'IEEE', jsLib: runtime, header: '{}',
  ruleContent: {content: '<js>function ieeeSignedMedia(resource) {return java.ajax(resource);}\njava.ajax("full");java.ajax("meta");result;</js>'},
  ruleToc: {chapterList: 'original'}, loginUi: '[]'};
const body = {status: 200, host: 'ieeexplore.ieee.org', body: '<tex-math>{{d\\mathrm{snr}}}</tex-math>'};
const lead = {host: body.host, title: 'Article', html: '<h1>Article</h1>'};
function candidate() { return replay.build(base, body, lead, 'guard', 'test-token').candidate; }

test('stage trace changes only the owned replay jsLib and preserves captured data and guarded JSON', () => {
  const before = candidate(), saved = structuredClone(before), traced = instrument.build(before, 'test-token');
  assert.deepEqual(before, saved);
  assert.equal(traced.ruleContent.content, before.ruleContent.content);
  const context = vm.createContext({java: {log() {}, ajax() { throw Error('not requested'); }}});
  vm.runInContext(traced.jsLib, context);
  assert.equal(context._uhvIeeeFixtureAjax(replay.REST), body.body);
  const options = context._ltOptions(['{{d\\mathrm{snr}}}']);
  assert(!options.includes('{{'));
  assert.deepEqual(JSON.parse(JSON.parse(options).body), ['{{d\\mathrm{snr}}}']);
  assert.throws(() => instrument.build({...before, bookSourceUrl: SOURCE_ID}, 'test-token'), /owned/);
  assert.throws(() => instrument.build(traced, 'test-token'), /already/);
  assert.throws(() => instrument.build({...before, jsLib: before.jsLib.replace('function TT(', 'function UnknownTT(')}, 'test-token'), /known public/);
});

test('network telemetry forwards identical arguments, return objects and errors without logging secrets', () => {
  const logs = [], context = vm.createContext({java: {log: text => logs.push(text)}});
  vm.runInContext(instrument.build(candidate(), 'test-token').jsLib, context);
  const urls = ['https://latex.codecogs.com/mathml.latex?secret-tex', 'https://edge.microsoft.com/translate/translatetext?body=secret-token'];
  const response = [{}], error = Error('Cookie: private-error');
  const bridge = {log: text => logs.push(text), ajaxAll(actual, raw) { assert.equal(actual, urls); assert.equal(raw, false); return response; },
    ajax(actual) { assert.equal(actual, urls[0]); throw error; }};
  assert.equal(context.useHtmlTraceAjaxAll(bridge, urls, false), response);
  assert.throws(() => context.useHtmlTraceAjax(bridge, urls[0]), e => e === error);
  assert(!logs.join('\n').includes('secret'));
  assert(!logs.join('\n').includes('Cookie'));
  assert(!logs.join('\n').includes('https:'));
  const events = instrument.stages(logs);
  assert.deepEqual(events.map(e => e.stage), ['ajaxAll:begin', 'ajaxAll:end', 'ajax:begin', 'ajax:error']);
  assert.equal(events[0].codecogs, 1);
  assert.equal(events[0].translation, 1);
  assert.equal(events[1].responses, 1);
});

test('stage wrappers preserve cache-only translation without new requests', () => {
  const logs = [], context = vm.createContext({java: {log: text => logs.push(text)}});
  vm.runInContext(instrument.build(candidate(), 'test-token').jsLib, context);
  const bridge = {get: () => 'zh-Hans', log: text => logs.push(text), ajaxAll() { throw Error('cache hit must not request'); }};
  const cache = {get: () => 'cached-translation'};
  assert.equal(context.TT('original', bridge, cache), 'cached-translation');
  assert.deepEqual(instrument.stages(logs).map(e => e.stage), ['TT:begin', 'TT:end']);
});

test('stage extraction accepts only known markers and nonnegative numeric metadata', () => {
  const events = instrument.stages(['[time] UHV-STAGE {"stage":"TH:begin","operation":1,"url":"private","characters":10}',
    'UHV-STAGE {"stage":"ajaxAll:begin","requests":4,"other":-2,"translation":"secret"}',
    'UHV-STAGE {"stage":"untrusted","requests":1}', 'UHV-STAGE broken']);
  assert.deepEqual(events, [{stage: 'TH:begin', operation: 1, characters: 10}, {stage: 'ajaxAll:begin', requests: 4}]);
});

test('telemetry works in a library scope with no global java binding', () => {
  const logs = [], context = vm.createContext({});
  vm.runInContext(instrument.build(candidate(), 'test-token').jsLib, context);
  assert.equal(vm.runInContext('typeof java', context), 'undefined');
  const bridge = {get: () => 'zh-Hans', log: text => logs.push(text), ajaxAll: () => ['response']};
  assert.equal(context.TT('original', bridge, {get: () => 'cached'}), 'cached');
  assert.deepEqual(context.useHtmlTraceAjaxAll(bridge, ['https://latex.codecogs.com/mathml.latex?private'], false), ['response']);
  assert.deepEqual(instrument.stages(logs).map(e => e.stage), ['TT:begin', 'TT:end', 'ajaxAll:begin', 'ajaxAll:end']);
  assert(!logs.join('\n').includes('private'));
});
