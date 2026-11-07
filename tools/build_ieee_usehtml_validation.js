#!/usr/bin/env node
/* Opt-in IEEE candidate only; never changes or deploys the original source. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ROOT, normalizeSources} = require('./build_usehtml_validation');
const SOURCE_ID = 'https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=';
const TEST_ID = SOURCE_ID + '#usehtml-formula-validation';
const CANONICAL = path.join(ROOT, 'booksource/legado-book-sources-current.json');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const guard = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-rule-json.js'), 'utf8');
const wrapper = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-validation.js'), 'utf8');

function build(sources) {
  const matches = normalizeSources(sources).filter(s => s.bookSourceUrl === SOURCE_ID);
  assert.equal(matches.length, 1, 'IEEE source must be uniquely present');
  const original = matches[0];
  assert(original.ruleContent && typeof original.ruleContent.content === 'string', 'IEEE content rule is required');
  assert(typeof original.jsLib === 'string' && /function\s+_ltOptions\s*\(/.test(original.jsLib),
    'expected the existing translation JSON serializer; do not replace an unknown runtime');
  const candidate = structuredClone(original);
  candidate.bookSourceName = original.bookSourceName + ' · HTML公式验证';
  candidate.bookSourceUrl = TEST_ID;
  candidate.jsLib = original.jsLib + '\n' + guard;
  candidate.ruleContent.content = original.ruleContent.content + '\n<js>\n' + wrapper +
    '\nresult = useHtmlValidation(result, baseUrl);\nresult;\n</js>\n';
  return candidate;
}

function writeCandidate(input, output) {
  assert(input && output, 'explicit baseline and fresh output paths are required');
  const target = path.resolve(output);
  assert.notEqual(target, path.resolve(input), 'must not overwrite the baseline');
  assert.notEqual(target, CANONICAL, 'must not overwrite the canonical source list');
  const candidate = build(JSON.parse(fs.readFileSync(input, 'utf8')));
  const text = JSON.stringify([candidate], null, 2) + '\n';
  if (fs.existsSync(target)) {
    assert(!fs.lstatSync(target).isSymbolicLink(), 'refusing a symlink output');
    assert.equal(fs.readFileSync(target, 'utf8'), text, 'candidate differs; use a fresh output path');
  } else fs.writeFileSync(target, text, {mode:0o600, flag:'wx'});
  return {name:candidate.bookSourceName, output:target, deployed:false};
}

async function fromPhone() {
  const host = process.env.LEGADO_PHONE;
  assert(host, 'set LEGADO_PHONE explicitly');
  const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8'));
  assert.equal(state.host, host, 'phone must match this task backup');
  const dir = fs.lstatSync(DIR);
  assert(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o777) === 0o700,
    'use the existing private task directory');
  const before = path.join(DIR, 'ieee-formula-before-v1.json');
  const output = path.join(DIR, 'ieee-formula-candidate-v1.json');
  assert(!fs.existsSync(before) && !fs.existsSync(output), 'phone snapshot already exists; inspect it instead of overwriting');
  const client = require('./usehtml_http_ws_client');
  const sources = await client.sources();
  assert(!sources.some(s => s.bookSourceUrl === TEST_ID), 'experimental IEEE source ID already exists');
  const original = sources.filter(s => s.bookSourceUrl === SOURCE_ID);
  build(original); // Validate before saving the private snapshot.
  fs.writeFileSync(before, JSON.stringify(original, null, 2) + '\n', {mode:0o600, flag:'wx'});
  const result = writeCandidate(before, output);
  return {...result, changedFields:['bookSourceName', 'bookSourceUrl', 'jsLib', 'ruleContent.content'],
    userRuleRetained:true, originalSource:'not modified', phoneWrites:0};
}

module.exports = {build, writeCandidate, SOURCE_ID, TEST_ID};
if (require.main === module) {
  Promise.resolve().then(() => process.argv[2] === '--phone' ? fromPhone() : writeCandidate(process.argv[2], process.argv[3]))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(0,600)); process.exitCode=1; });
}
