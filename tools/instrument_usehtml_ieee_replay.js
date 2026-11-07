#!/usr/bin/env node
/* Add count-only telemetry to an already-owned guarded replay. HTTP/WS only. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {ROOT} = require('./build_usehtml_validation');
const {SOURCE_ID} = require('./build_ieee_usehtml_validation');
const client = require('./usehtml_http_ws_client');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const RUNTIME = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'), 'utf8');
const TRACE = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-stage-trace.js'), 'utf8');
const OLD = 'ieee-replay-guard-candidate-v1.json';
const PREVIOUS = 'ieee-replay-guard-candidate-v2.json';
const NEW = 'ieee-replay-guard-candidate-v3.json';
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
function write(file, value) {
  fs.writeFileSync(path.join(DIR, file), JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
}
function build(original, token) {
  assert.equal(original.bookSourceUrl, SOURCE_ID + '#usehtml-replay-guard-' + token.slice(0, 8), 'only the owned guarded replay is allowed');
  assert(original.jsLib.includes('function useHtmlRuleJson('), 'guarded serializer required');
  assert(original.jsLib.includes('function _uhvIeeeFixtureAjax('), 'captured replay required');
  assert(!original.jsLib.includes('USEHTML_STAGE_TRACE'), 'telemetry already added');
  assert.equal(original.jsLib.split(RUNTIME).length, 2, 'exactly one known public runtime required');
  assert.equal((RUNTIME.match(/j\.ajaxAll\(/g) || []).length, 3, 'known batch call sites required');
  assert.equal((RUNTIME.match(/j\.ajax\(/g) || []).length, 2, 'known single call sites required');
  const instrumented = RUNTIME.replace(/j\.ajaxAll\(/g, 'useHtmlTraceAjaxAll(j,').replace(/j\.ajax\(/g, 'useHtmlTraceAjax(j,');
  const candidate = structuredClone(original);
  candidate.jsLib = original.jsLib.replace(RUNTIME, instrumented) + '\n' + TRACE;
  new vm.Script(candidate.jsLib);
  assert.deepEqual(client.changedPaths(original, candidate), ['jsLib'], 'telemetry must not change rules, switches or requests');
  return candidate;
}
function stages(messages) {
  const output = [], allowed = new Set(['operation', 'elapsedMs', 'characters', 'values', 'resolved', 'requests', 'responses', 'codecogs', 'translation', 'other']);
  for (const message of messages) for (const line of message.split('\n')) {
    const match = /\bUHV-STAGE (\{.*\})$/.exec(line);
    if (!match) continue;
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    if (!/^(?:TH|TC|TT|formulas|speech|ajaxAll|ajax):(?:begin|end|error)$/.test(data.stage)) continue;
    const event = {stage: data.stage};
    for (const key of allowed) if (Number.isFinite(data[key]) && data[key] >= 0) event[key] = data[key];
    output.push(event);
  }
  return output;
}
function task() {
  const state = read('state.json');
  assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'explicit matching phone required');
  const dir = fs.lstatSync(DIR);
  assert(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o777) === 0o700, 'private task directory required');
  assert.equal(state.sourceStatus, 'deployed');
  const records = state.extraSources.filter(s => s.kind === 'replay-guard');
  assert.equal(records.length, 1, 'one owned guarded replay required');
  assert.equal(records[0].id, SOURCE_ID + '#usehtml-replay-guard-' + state.token.slice(0, 8));
  assert.equal(records[0].status, 'deployed');
  return {state, record: records[0]};
}
async function deploy() {
  const {state, record} = task();
  assert([OLD, PREVIOUS].includes(record.candidate), 'trace deployment already attempted; do not repeat it');
  const previous = read(record.candidate)[0], original = read(OLD)[0], candidate = build(original, state.token);
  const before = await client.sources(), actual = before.find(s => s.bookSourceUrl === record.id);
  assert(actual, 'owned replay source missing');
  for (const key of ['jsLib', 'ruleContent', 'header', 'bookSourceName', 'ruleToc', 'loginUi', 'loginUrl']) {
    assert.equal(client.changedPaths(actual[key], previous[key]).length, 0, 'replay edited at ' + key + '; preserve it');
  }
  write('ieee-replay-trace-state-before-v3.json', state);
  write('ieee-replay-trace-sources-before-v3.json', before);
  write(NEW, [candidate]);
  const saveState = () => fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
  record.previousCandidates = [...new Set([...(record.previousCandidates || []), record.candidate])];
  record.candidate = NEW; record.status = 'updating'; saveState();
  await client.save(candidate, ['jsLib', 'ruleContent', 'header', 'bookSourceName', 'ruleToc', 'loginUi', 'loginUrl']);
  record.status = 'deployed'; record.stageTrace = true; saveState();
  const after = await client.sources();
  assert.equal(client.changedPaths(before.filter(s => s.bookSourceUrl !== record.id), after.filter(s => s.bookSourceUrl !== record.id)).length,
    0, 'unrelated sources changed during trace deployment');
  return {kind: 'owned-guarded-replay', changed: ['jsLib'], candidate: NEW, readback: 'verified', rulesAndSwitches: 'unchanged', unrelatedSources: 'unchanged'};
}
async function debug(label, seconds = '180') {
  const {state, record} = task();
  assert.equal(record.candidate, NEW, 'traced replay required');
  assert(/^[a-zA-Z0-9_-]+$/.test(label), 'fresh evidence label required');
  assert(/^\d+$/.test(seconds) && Number(seconds) >= 10 && Number(seconds) <= 600, '10 to 600 seconds required');
  assert(!fs.existsSync(path.join(DIR, label + '.json')), 'evidence exists; use a fresh label');
  const books = state.books.filter(b => b.kind === 'replay-guard');
  assert.equal(books.length, 1);
  const chapterFile = books[0].chaptersFile || 'replay-guard-chapters.json';
  assert(/^[a-zA-Z0-9_-]+\.json$/.test(chapterFile), 'owned chapter path required');
  const chapters = read(chapterFile);
  assert.equal(chapters.length, 1);
  const key = '--' + chapters[0].url;
  class TraceSocket extends WebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (typeof event.data === 'string') for (const stage of stages([event.data])) console.log(JSON.stringify({trace: stage}));
      });
    }
  }
  const connection = client.createClient(state.host, {tokenFile: process.env.LEGADO_WEB_TOKEN_FILE, WebSocket: TraceSocket});
  const result = await connection.debug(record.id, key, Number(seconds) * 1000);
  const summary = client.summarizeDebug(result, key), trace = stages(result.messages);
  write(label + '.json', {observedAt: new Date().toISOString(), ...result, isError: summary.isError, stages: trace});
  return {...summary, label, stages: trace.length, lastStages: trace.slice(-8), replayOnly: true};
}
module.exports = {build, stages, OLD, NEW};
if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  Promise.resolve().then(() => {
    assert(['deploy', 'debug'].includes(command), 'deploy or debug required');
    return command === 'deploy' ? deploy() : debug(...args);
  }).then(result => { console.log(JSON.stringify(result, null, 2)); if (result.isError) process.exitCode = 1; })
    .catch(error => { console.error(JSON.stringify(client.errorDetails(error))); process.exitCode = 1; });
}
