'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('../prepare_usehtml_parser_probe');
const runtime = fs.readFileSync(path.join(__dirname, '../../booksource/runtime/legado-translation-runtime.js'), 'utf8');
const wrapper = fs.readFileSync(path.join(__dirname, '../../booksource/runtime/legado-usehtml-validation.js'), 'utf8');
const guard = fs.readFileSync(path.join(__dirname, '../../booksource/runtime/legado-usehtml-rule-json.js'), 'utf8');

test('minimal parser source isolates the captured control from production and external services', () => {
  const capture = {status: 200, host: 'ieeexplore.ieee.org', body: '<tex-math>\\frac {d}{{d\\mathrm {snr} }}I</tex-math>'};
  const candidate = build(capture, 'synthetic-token', runtime, wrapper, guard);
  assert.equal(candidate.jsLib, runtime);
  assert(!candidate.ruleContent.content.includes('{{'));
  assert(candidate.ruleContent.content.includes('\\u007b\\u007b'));
  assert(candidate.ruleContent.content.includes('fullIeeePipeline:false,translationService:false'));
  assert(candidate.ruleContent.content.includes('useHtmlValidation(result,'));
  assert.equal(candidate.header, '{"proxy":""}');
  assert(!candidate.loginUi && !candidate.loginUrl);
  assert(candidate.ruleToc.chapterUrl.includes('127.0.0.1:1122/getJsSourceApiTokenRequired'));
});
