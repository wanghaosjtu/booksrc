/* Explicit, per-source phone operations. No import-time writes or deployments. */
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const HOST = process.env.LEGADO_PHONE || '10.92.27.92';
const HTTP = `http://${HOST}:1122`;
const MCP = `http://${HOST}:1236/mcp`;

async function request(url, options = {}, timeout = 30000) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(timeout)});
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  return {response, text};
}

async function sources() {
  const {text} = await request(`${HTTP}/getBookSources`);
  const data = JSON.parse(text);
  if (data.isSuccess === false) throw new Error(data.errorMsg || 'source export failed');
  const result = Array.isArray(data) ? data : data.data;
  assert(Array.isArray(result) && result.length, 'empty/invalid source export');
  return result;
}

async function mcp(method, args = {}, timeout = 90000) {
  const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'};
  const init = await request(MCP, {method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'source-repair', version: '1'}
    }
  })});
  const session = init.response.headers.get('mcp-session-id');
  if (session) headers['Mcp-Session-Id'] = session;
  headers['MCP-Protocol-Version'] = '2024-11-05';
  await request(MCP, {method: 'POST', headers, body: JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})});
  const isProtocolMethod = method.includes('/');
  const {text} = await request(MCP, {method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 2, method: isProtocolMethod ? method : 'tools/call',
    params: isProtocolMethod ? args : {name: method, arguments: args}
  })}, timeout);
  let packets;
  if (text.trim().startsWith('{')) packets = [JSON.parse(text)];
  else packets = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => {
    try { return JSON.parse(line.slice(5).trim()); } catch (_) { return {}; }
  });
  const packet = packets.find(item => item.id === 2);
  if (!packet) throw new Error('No MCP result received');
  if (packet.error) throw new Error(JSON.stringify(packet.error));
  return packet.result;
}

function resultText(result) {
  return (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
}

function changedPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object'
      || Array.isArray(before) || Array.isArray(after)) return [prefix];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap(key => changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
}

function at(value, path) { return path.split('.').reduce((v, key) => v == null ? undefined : v[key], value); }
function set(value, path, next) {
  const keys = path.split('.');
  let parent = value;
  for (const key of keys.slice(0, -1)) parent = parent[key] || (parent[key] = {});
  if (next === undefined) delete parent[keys.at(-1)];
  else parent[keys.at(-1)] = next;
}

/* The Android API normalizes/removes these legacy top-level knobs. They
 * are generated in desktop exports but are not useful phone-side changes. */
const PHONE_NORMALIZED_KEYS = new Set([
  'remove_selector', 'extract_selector', 'toc_mode', 'formula_mode', 'formula_selector'
]);
function isPhoneNormalizedPath(path, before, desired) {
  return path.indexOf('.') < 0 && PHONE_NORMALIZED_KEYS.has(path)
    && at(before, path) === undefined && at(desired, path) !== undefined;
}

/* Merge only planned leaf changes; refuse to overwrite concurrent user edits. */
function merge(before, desired, live) {
  assert.equal(before.bookSourceUrl, desired.bookSourceUrl, 'source identity changes are not permitted');
  assert.equal(before.bookSourceUrl, live.bookSourceUrl, 'wrong live source');
  const merged = structuredClone(live);
  for (const path of changedPaths(before, desired)) {
    if (isPhoneNormalizedPath(path, before, desired)) continue;
    const old = at(before, path), now = at(live, path), next = at(desired, path);
    if (JSON.stringify(now) !== JSON.stringify(old) && JSON.stringify(now) !== JSON.stringify(next)) {
      throw new Error(`Concurrent edit in ${live.bookSourceName}: ${path}`);
    }
    set(merged, path, next);
  }
  return merged;
}

async function save(source, expectedPaths = []) {
  const {text} = await request(`${HTTP}/saveBookSource`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(source)
  });
  const reply = JSON.parse(text);
  if (!reply.isSuccess) throw new Error(reply.errorMsg || 'save failed');
  const actual = (await sources()).find(item => item.bookSourceUrl === source.bookSourceUrl);
  assert(actual, 'saved source missing from readback');
  // The app may add defaults, omit legacy knobs, or update timestamps. Verify
  // only the leaf paths intentionally changed by this deployment.
  const differences = expectedPaths.filter(path => JSON.stringify(at(source, path)) !== JSON.stringify(at(actual, path)));
  assert.deepEqual(differences, [], `source readback mismatch: ${differences.join(', ')}`);
  return actual;
}

module.exports = {sources, mcp, resultText, merge, save, changedPaths};

if (require.main === module) {
  (async () => {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'list') {
      console.log(JSON.stringify((await sources()).map(s => ({name: s.bookSourceName, url: s.bookSourceUrl, enabled: s.enabled})), null, 2));
    } else if (command === 'tools') {
      console.log(JSON.stringify(await mcp('tools/list'), null, 2));
    } else if (command === 'eval') {
      const result = await mcp('eval_js', {js: fs.readFileSync(args[0], 'utf8'), url: args[1], timeoutSec: Number(args[2] || 60)}, Number(args[2] || 60) * 1000 + 15000);
      console.log(resultText(result));
      if (result.isError) process.exitCode = 1;
    } else if (command === 'deploy') {
      const [baselineFile, candidateFile, url] = args;
      assert(url, 'deploy requires one exact source URL');
      const before = JSON.parse(fs.readFileSync(baselineFile)).find(s => s.bookSourceUrl === url);
      const desired = JSON.parse(fs.readFileSync(candidateFile)).find(s => s.bookSourceUrl === url);
      const live = (await sources()).find(s => s.bookSourceUrl === url);
      assert(before && desired && live, 'source absent from baseline, candidate, or phone');
      const expectedPaths = changedPaths(before, desired).filter(path => !isPhoneNormalizedPath(path, before, desired));
      const updated = merge(before, desired, live);
      await save(updated, expectedPaths);
      console.log(JSON.stringify({name: updated.bookSourceName, changed: changedPaths(live, updated), readback: 'verified'}));
    } else throw new Error('Usage: phone_source_client.js list|tools|eval <script> [source-url] [timeout-sec]|deploy <baseline> <candidate> <exact-url>');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
