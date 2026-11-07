'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {ROOT} = require('../build_usehtml_validation');
const builder = require('../build_ieee_usehtml_validation');
const {changedPaths} = require('../usehtml_http_ws_client');
const runtime = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'), 'utf8');

function original() {
  return {bookSourceUrl:builder.SOURCE_ID, bookSourceName:'IEEE', enabled:false, enabledExplore:true,
    loginUrl:'keep the existing login rule', header:'keep the existing header', jsLib:runtime,
    ruleToc:{chapterList:'existing TOC rule'}, ruleContent:{imageStyle:'FULL',
      content:'body@html\n<js>result; "<usehtml>"+result+"</usehtml>";</js>\n'}};
}

test('IEEE candidate retains the manual wrapper, login, TOC and switches; only four paths change', () => {
  const baseline = [original()], before = structuredClone(baseline);
  const candidate = builder.build(baseline);
  assert.deepEqual(baseline, before);
  assert.deepEqual(changedPaths(baseline[0], candidate).sort(),
    ['bookSourceName', 'bookSourceUrl', 'jsLib', 'ruleContent.content']);
  assert(candidate.ruleContent.content.startsWith(baseline[0].ruleContent.content));
  assert(candidate.jsLib.startsWith(baseline[0].jsLib));
  assert.equal(candidate.bookSourceUrl, builder.TEST_ID);
  new vm.Script(candidate.jsLib);
  for (const match of candidate.ruleContent.content.matchAll(/<js>([\s\S]*?)<\/js>/g)) new vm.Script(match[1]);
});

test('IEEE candidate rejects ambiguous sources and unknown translation libraries', () => {
  assert.throws(() => builder.build([]), /uniquely present/);
  assert.throws(() => builder.build([original(), original()]), /uniquely present/);
  assert.throws(() => builder.build([{...original(), jsLib:'different runtime'}]), /unknown runtime/);
});

test('IEEE candidate cannot overwrite baseline/canonical and needs explicit paths', () => {
  assert.throws(() => builder.writeCandidate(), /explicit/);
  assert.throws(() => builder.writeCandidate('same.json', 'same.json'), /overwrite the baseline/);
  assert.throws(() => builder.writeCandidate('unused.json', path.join(ROOT, 'booksource/legado-book-sources-current.json')),
    /overwrite the canonical/);
});
