'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('../repair_usehtml_http_local');
const {SOURCE_ID} = require('../build_usehtml_validation');

test('inherited external-link rule adds invalid second JSON; local fix changes only URL extraction', () => {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname,'../../booksource/legado-usehtml-validation-candidate.json'),'utf8'))[0];
  const id = SOURCE_ID + '#usehtml-http-local-test';
  source.bookSourceUrl = id;
  const original = structuredClone(source);
  const fixtureUrl = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired,' + JSON.stringify({bodyJs:'"<h1>Fixture</h1>"',timeout:10000});
  const js = source.ruleToc.chapterUrl.split(/@js:/)[1];
  assert(js, 'expected the production external-link JS');
  const corrupted = vm.runInNewContext(js, {result:fixtureUrl, source:{getLoginInfoMap:()=>({get:()=>''})}});
  assert(corrupted.endsWith(',{"webView":true}'));
  assert.throws(()=>JSON.parse(corrupted.slice(corrupted.indexOf(',')+1)), SyntaxError);
  const repaired = build(source,id);
  assert.deepEqual(source,original,'input must not be changed');
  assert.equal(repaired.ruleToc.chapterUrl,'$.contentSummary.href||$.path');
  assert.equal(JSON.parse(fixtureUrl.slice(fixtureUrl.indexOf(',')+1)).bodyJs,'"<h1>Fixture</h1>"');
});

test('local fix refuses production IDs and unknown URL rules', () => {
  assert.throws(()=>build({bookSourceUrl:SOURCE_ID},SOURCE_ID), /not a local harness/);
  const id=SOURCE_ID+'#usehtml-http-local-test';
  assert.throws(()=>build({bookSourceUrl:id,ruleToc:{chapterUrl:'unknown'}},id), /expected inherited/);
});
