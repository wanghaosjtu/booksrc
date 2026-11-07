#!/usr/bin/env node
/* Repair only the owned local harness; preserve the production external-link rule. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const client = require('./usehtml_http_ws_client');
const {ROOT, SOURCE_ID} = require('./build_usehtml_validation');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(DIR, file), JSON.stringify(value, null, 2) + '\n', {mode:0o600, flag:'wx'});

function build(original, expectedId) {
  assert.equal(original.bookSourceUrl, expectedId, 'local source ownership mismatch');
  assert(expectedId.startsWith(SOURCE_ID + '#usehtml-http-local-'), 'not a local harness source');
  assert(original.ruleToc && /webView/.test(original.ruleToc.chapterUrl), 'expected inherited external-link WebView rule');
  const candidate = structuredClone(original);
  // The fixture paths are already absolute. Do not append a second options JSON.
  candidate.ruleToc.chapterUrl = '$.contentSummary.href||$.path';
  assert.deepEqual(client.changedPaths(original, candidate), ['ruleToc.chapterUrl']);
  return candidate;
}

async function repair() {
  const state = read('state.json');
  assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'matching explicit phone required');
  const id = SOURCE_ID + '#usehtml-http-local-' + state.token.slice(0,8);
  const record = (state.extraSources || []).find(s => s.id === id && s.kind === 'local');
  assert(record && record.status === 'deployed', 'owned local source required');
  assert.equal(record.candidate, 'http-local-candidate.json', 'repair already attempted; inspect readback instead');
  const original = read(record.candidate)[0];
  const options = read('http-local-options.json');
  assert(options.chapterUrl.startsWith('http://127.0.0.1:1122/getJsSourceApiTokenRequired,'), 'local fixture URL required');
  JSON.parse(options.chapterUrl.slice(options.chapterUrl.indexOf(',') + 1));
  const candidate = build(original, id);
  const before = await client.sources();
  const actual = before.find(s => s.bookSourceUrl === id);
  assert(actual, 'owned local source missing');
  for (const key of ['bookSourceName','jsLib','header','ruleContent','ruleToc','loginUi','loginUrl']) {
    assert.equal(client.changedPaths(original[key], actual[key]).length, 0, 'local source edited at ' + key + '; preserve it');
  }
  write('http-local-source-before-toc-fix-v1.json', [actual]);
  write('http-local-candidate-v2.json', [candidate]);
  record.previousCandidate = record.candidate;
  record.candidate = 'http-local-candidate-v2.json';
  record.tocFixStatus = 'deploying';
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n', {mode:0o600});
  await client.save(candidate, ['bookSourceName','jsLib','header','ruleContent','ruleToc','loginUi','loginUrl']);
  record.tocFixStatus = 'deployed';
  fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n', {mode:0o600});
  const after = (await client.sources()).filter(s => s.bookSourceUrl !== id);
  assert.equal(client.changedPaths(before.filter(s => s.bookSourceUrl !== id), after).length, 0,
    'another source changed during local repair');
  return {kind:'local', changed:['ruleToc.chapterUrl'], readback:'verified', otherSources:'unchanged',
    requiresOwnedTocRefresh:true};
}
module.exports = {build};
if (require.main === module) repair().then(r => console.log(JSON.stringify(r,null,2))).catch(error => {
  console.error(String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,500));
  process.exitCode = 1;
});
