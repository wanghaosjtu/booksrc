'use strict';
// Task-scoped HTTP/WS operations. Backups and raw debug output are private.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createClient, changedPaths, summarizeDebug} = require('./usehtml_http_ws_client');
const ROOT = path.resolve(__dirname, '..');
const IEEE = 'https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=';
const IDS = [IEEE, 'https://www.state.gov', 'https://carnegieendowment.org/'];

function privateDirectory(dir) {
  const parent = path.join(ROOT, 'booksource/.usehtml-validation-phone');
  dir = path.resolve(dir);
  assert(dir.startsWith(parent + path.sep), 'backup must stay in the ignored private evidence directory');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  assert(!fs.lstatSync(dir).isSymbolicLink(), 'private directory cannot be a symlink');
  fs.chmodSync(dir, 0o700);
  return dir;
}
function privateWrite(dir, name, value) {
  const filename = path.join(dir, name);
  fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    {mode: 0o600, flag: 'wx'});
  return filename;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function normalized(value) {
  if (typeof value === 'string') value = JSON.parse(value);
  assert(value && typeof value === 'object', 'invalid source response');
  return value;
}
function client(host) {
  assert(host === 'localhost' || host === '127.0.0.1', 'writes and debug are limited to localhost');
  return createClient(host, {tokenFile: process.env.LEGADO_WEB_TOKEN_FILE,
    onMessage:value=>{for(const line of value.split('\n'))if(/\] (?:IEEE page\/full-text merge:|IEEE signed media URLs:|Common runtime \d+ loaded|IEEE HTML标记片段数:)/.test(line))console.log(line.replace(/https?:\/\/\S+/g,'[URL]').slice(0,200));},
    debugTransport: process.env.LEGADO_WS_TRANSPORT === 'python' ? require('./usehtml_python_ws').debug : undefined});
}
async function single(c, id) { return normalized(await c.request('/getBookSource?url=' + encodeURIComponent(id), undefined, 15000)); }
async function snapshot(dir) {
  dir = privateDirectory(dir);
  const c = client('localhost');
  const sources = await c.sources();
  assert(sources.every(s => s.bookSourceUrl), 'source identity missing');
  privateWrite(dir, 'phone-sources-before.json', sources);
  privateWrite(dir, 'local-sources-before.json', fs.readFileSync(path.join(ROOT, 'booksource/legado-book-sources-current.json'), 'utf8'));
  const pilots = IDS.map(id => {
    const matches = sources.filter(s => s.bookSourceUrl === id);
    assert(matches.length === 1, 'pilot source identity must be unique: ' + id);
    return matches[0];
  });
  privateWrite(dir, 'phone-pilots-before.json', pilots);
  const report = {host: 'localhost', total: sources.length,
    pilots: pilots.map(s => ({name: s.bookSourceName, id: s.bookSourceUrl, sha256: hash(s), jsLibBytes: Buffer.byteLength(s.jsLib || '')})),
    privateBackup: dir};
  privateWrite(dir, 'snapshot-summary.json', report);
  return report;
}
async function deploy(dir, candidatesFile) {
  dir = privateDirectory(dir);
  const c = client('localhost');
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'phone-pilots-before.json'), 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
  assert(candidates.length === IDS.length && candidates.every(s => IDS.includes(s.bookSourceUrl)), 'exactly the three pilots required');
  const report = [];
  for (const candidate of candidates) {
    const saved = before.find(s => s.bookSourceUrl === candidate.bookSourceUrl);
    assert(saved, 'missing pilot backup');
    const current = await single(c, candidate.bookSourceUrl);
    assert.equal(hash(current), hash(saved), 'phone source changed after snapshot; refusing to overwrite');
    await c.request('/saveBookSource', candidate);
    const actual = await single(c, candidate.bookSourceUrl);
    const paths = changedPaths(candidate, actual);
    assert(!paths.length, 'readback differs at: ' + paths.join(', '));
    report.push({id: candidate.bookSourceUrl, changed: changedPaths(saved, actual), sha256: hash(actual)});
  }
  privateWrite(dir, 'deployment-summary.json', report);
  return report;
}
async function verifyOthers(dir) {
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'phone-sources-before.json'), 'utf8'));
  const after = await client('localhost').sources();
  assert.equal(after.length, before.length, 'phone source count changed');
  const other = before.filter(s => !IDS.includes(s.bookSourceUrl));
  for (const s of other) {
    const a = after.find(x => x.bookSourceUrl === s.bookSourceUrl);
    assert(a && hash(a) === hash(s), 'unrelated phone source changed: ' + s.bookSourceUrl);
  }
  return {unchangedOtherSources: other.length, total: after.length};
}
async function debug(dir, id, key, timeout) {
  dir = privateDirectory(dir);
  assert(IDS.includes(id), 'debug source must be a pilot');
  const result = await client('localhost').debug(id, key, timeout || 55000);
  privateWrite(dir, 'debug-' + Date.now() + '.json', result);
  return {id, key: key.replace(/https?:\/\/\S+/g, '[URL]'), ...summarizeDebug(result, key)};
}
async function main() {
  const [operation, dir, ...args] = process.argv.slice(2);
  assert(dir, 'operation and private evidence directory required');
  let result;
  if (operation === 'snapshot') result = await snapshot(dir);
  else if (operation === 'deploy') result = await deploy(dir, args[0]);
  else if (operation === 'verify') result = await verifyOthers(dir);
  else if (operation === 'debug') result = await debug(dir, args[0], args[1], Number(args[2]) || 55000);
  else throw new Error('unknown operation');
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {ROOT, IEEE, IDS, single, hash, privateDirectory, privateWrite, normalized};
