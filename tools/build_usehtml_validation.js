#!/usr/bin/env node
/* Build a separate experimental source; never edit the canonical source list. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const SOURCE_ID = 'https://carnegieendowment.org';
const TEST_ID = SOURCE_ID + '#usehtml-validation';
const DEFAULT_INPUT = path.join(ROOT, 'booksource/legado-book-sources-current.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'booksource/legado-usehtml-validation-candidate.json');

function normalizeSources(value) {
  const sources = Array.isArray(value) ? value : value && value.data;
  assert(Array.isArray(sources), 'expected a source array or an API response containing data');
  return sources;
}

function build(sources, runtime = fs.readFileSync(path.join(ROOT,
    'booksource/runtime/legado-usehtml-validation.js'), 'utf8')) {
  const matches = normalizeSources(sources).filter(source => source.bookSourceUrl === SOURCE_ID);
  assert.equal(matches.length, 1, 'Carnegie source must be uniquely present');
  const original = matches[0];
  assert(original.ruleContent && typeof original.ruleContent.content === 'string',
    'the original source needs a content rule');
  const source = structuredClone(original);
  source.bookSourceName = original.bookSourceName + ' · HTML验证';
  source.bookSourceUrl = TEST_ID;
  source.ruleContent.content = original.ruleContent.content + '\n<js>\n' + runtime +
    '\nresult = useHtmlValidation(result, baseUrl);\nresult;\n</js>\n';
  return source;
}

function writeCandidate(input = DEFAULT_INPUT, output = DEFAULT_OUTPUT) {
  assert.notEqual(path.resolve(input), path.resolve(output), 'must not overwrite the baseline');
  assert.notEqual(path.resolve(output), DEFAULT_INPUT, 'must not overwrite the canonical source list');
  const candidate = build(JSON.parse(fs.readFileSync(input, 'utf8')));
  const serialized = JSON.stringify([candidate], null, 2) + '\n';
  if (fs.existsSync(output)) {
    assert.equal(fs.readFileSync(output, 'utf8'), serialized,
      'candidate already exists with different content; use a fresh output path');
  } else {
    fs.writeFileSync(output, serialized, {mode: 0o600, flag: 'wx'});
  }
  return {name: candidate.bookSourceName, url: candidate.bookSourceUrl, output};
}

module.exports = {build, normalizeSources, writeCandidate, SOURCE_ID, TEST_ID, ROOT};
if (require.main === module) {
  try { console.log(JSON.stringify(writeCandidate(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
