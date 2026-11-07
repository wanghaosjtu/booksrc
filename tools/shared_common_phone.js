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
function testHost() {
  const host=process.env.LEGADO_PHONE||'localhost';
  assert(['localhost','127.0.0.1','10.92.24.102'].includes(host),'explicitly authorized test phone required');
  return host;
}
function sameHost(a,b) {return (a==='127.0.0.1'?'localhost':a)===(b==='127.0.0.1'?'localhost':b);}
function backupHost(dir,host) {
  const summary=JSON.parse(fs.readFileSync(path.join(dir,'snapshot-summary.json'),'utf8'));
  assert(sameHost(summary.host,host),'backup belongs to another phone host; do not cross-deploy');
}

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
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function normalized(value) {
  if (typeof value === 'string') value = JSON.parse(value);
  assert(value && typeof value === 'object', 'invalid source response');
  return value;
}
function client(host, evidenceDir) {
  assert(['localhost','127.0.0.1','10.92.24.102'].includes(host),'explicitly authorized phone required');
  return createClient(host, {tokenFile: process.env.LEGADO_WEB_TOKEN_FILE,closeConnection:true,
    onHttpError:evidenceDir ? record => privateWrite(evidenceDir,'http-error-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.json',record) : undefined,
    onMessage:value=>{for(const line of value.split('\n'))if(/\] (?:IEEE page\/full-text merge:|IEEE signed media URLs:|Common runtime \d+ loaded|IEEE HTML标记片段数:)/.test(line))console.log(line.replace(/https?:\/\/\S+/g,'[URL]').slice(0,200));},
    debugTransport: process.env.LEGADO_WS_TRANSPORT === 'python' ? require('./usehtml_python_ws').debug : undefined});
}
async function single(c, id) {
  const route='/getBookSource?url=' + encodeURIComponent(id);
  try { return normalized(await c.request(route, undefined, 15000)); }
  catch (error) {
    // A reused HTTP connection can close between requests. Retry this GET
    // once only; never retry saves or hide authentication/schema failures.
    if (!['UND_ERR_SOCKET','ECONNRESET'].includes(error.cause?.code)) throw error;
    return normalized(await c.request(route, undefined, 15000));
  }
}
async function saveWithReadback(c, candidate, saved) {
  const id = candidate.bookSourceUrl;
  let writeError;
  try { await c.request('/saveBookSource', candidate); }
  catch (error) { writeError = error; }
  // A save can have reached the phone despite a failed response. Read its
  // state before any further write; never blindly retry a POST.
  let actual;
  try { actual = await single(c, id); }
  catch (error) {
    throw new Error((writeError ? 'save/readback failed for ' : 'deployment readback failed for ')
      + id + '; state unknown, no retry', {cause:error});
  }
  if (writeError && changedPaths(actual, candidate).length) {
    const state = hash(actual) === hash(saved) ? 'unchanged' : 'changed unexpectedly';
    throw new Error('save failed for ' + id + '; readback ' + state + ', no retry', {cause:writeError});
  }
  return actual;
}
async function readAllSources(c) {
  // The phone's supported revision inventory is small; the monolithic source
  // export may time out. Read complete objects in bounded batches and prove
  // that no source was added/deleted/edited while this snapshot was taken.
  async function inventory() {
    const result = await c.request('/getBookSourceCheckStates', undefined, 15000);
    assert(Array.isArray(result?.states) && result.states.length, 'complete phone revision inventory required');
    assert(result.states.every(s => s.bookSourceUrl && s.sourceRevision), 'source revisions missing');
    assert.equal(new Set(result.states.map(s => s.bookSourceUrl)).size, result.states.length, 'duplicate phone inventory identity');
    return result.states.map(s => ({id:s.bookSourceUrl, revision:s.sourceRevision})).sort((a,b) => a.id.localeCompare(b.id));
  }
  const before = await inventory(), sources = [];
  for (let i = 0; i < before.length; i += 3) {
    const batch = await Promise.all(before.slice(i, i + 3).map(async s => {
      try { return await single(c, s.id); }
      catch (error) { throw new Error('snapshot read failed for ' + s.id, {cause:error}); }
    }));
    assert(batch.every((s,n) => s.bookSourceUrl === before[i+n].id), 'phone returned the wrong source');
    sources.push(...batch);
    if (sources.length % 15 === 0) console.log(JSON.stringify({snapshotSources:sources.length,total:before.length}));
  }
  assert.equal(hash(await inventory()), hash(before), 'phone source revisions changed during snapshot; retry before any write');
  return sources;
}
function targets(dir) {
  const local = JSON.parse(fs.readFileSync(path.join(dir, 'local-sources-before.json'), 'utf8'));
  const ids = local.map(s => s.bookSourceUrl);
  assert(ids.length && new Set(ids).size === ids.length, 'canonical target inventory must be unique');
  return ids;
}
async function snapshot(dir) {
  dir = privateDirectory(dir);
  const host=testHost(),c = client(host);
  const sources = await readAllSources(c);
  assert(sources.every(s => s.bookSourceUrl), 'source identity missing');
  privateWrite(dir, 'phone-sources-before.json', sources);
  privateWrite(dir, 'local-sources-before.json', fs.readFileSync(path.join(ROOT, 'booksource/legado-book-sources-current.json'), 'utf8'));
  const ids = targets(dir);
  const selected = ids.map(id => {
    const source = sources.find(s => s.bookSourceUrl === id);
    assert(source, 'canonical source missing from phone: ' + id);
    return source;
  });
  privateWrite(dir, 'phone-targets-before.json', selected);
  const pilots = IDS.map(id => {
    const matches = sources.filter(s => s.bookSourceUrl === id);
    assert(matches.length === 1, 'pilot source identity must be unique: ' + id);
    return matches[0];
  });
  privateWrite(dir, 'phone-pilots-before.json', pilots);
  const report = {host, total: sources.length, targets: selected.length,
    pilots: pilots.map(s => ({name: s.bookSourceName, id: s.bookSourceUrl, sha256: hash(s), jsLibBytes: Buffer.byteLength(s.jsLib || '')})),
    privateBackup: dir};
  privateWrite(dir, 'snapshot-summary.json', report);
  return report;
}
async function deploy(dir, candidatesFile) {
  dir = privateDirectory(dir);
  backupHost(dir,'localhost'); // Backup device is test-only unless authorized separately.
  const c = client('localhost', dir);
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'phone-targets-before.json'), 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
  const ids = targets(dir);
  assert(candidates.length && new Set(candidates.map(s => s.bookSourceUrl)).size === candidates.length
    && candidates.every(s => ids.includes(s.bookSourceUrl)), 'only unique canonical targets may deploy');
  const report = [];
  for (const candidate of candidates) {
    const saved = before.find(s => s.bookSourceUrl === candidate.bookSourceUrl);
    assert(saved, 'missing source backup');
    const id = candidate.bookSourceUrl;
    let current;
    try { current = await single(c, id); }
    catch (error) { throw new Error('deployment preflight failed for ' + id, {cause:error}); }
    const journal = 'deployed-' + crypto.createHash('sha256').update(candidate.bookSourceUrl).digest('hex').slice(0,24) + '.json';
    const filename = path.join(dir, journal);
    if (fs.existsSync(filename)) {
      const recorded = JSON.parse(fs.readFileSync(filename, 'utf8'));
      assert.equal(recorded.candidateSha256, hash(candidate), 'candidate changed after deployment');
      assert(!changedPaths(current, candidate).length, 'previously deployed source was edited; refusing to overwrite');
      report.push({...recorded, alreadyVerified:true});
      continue;
    }
    let actual = current;
    if (changedPaths(current, candidate).length) {
      assert.equal(hash(current), hash(saved), 'phone source changed after snapshot; refusing to overwrite');
      actual = await saveWithReadback(c, candidate, saved);
    }
    const paths = changedPaths(candidate, actual);
    assert(!paths.length, 'readback differs at: ' + paths.join(', '));
    const record = {id: candidate.bookSourceUrl, changed: changedPaths(saved, actual),
      beforeSha256:hash(saved), candidateSha256:hash(candidate), sha256:hash(actual)};
    privateWrite(dir, journal, record);
    report.push(record);
    if (report.length % 10 === 0) console.log(JSON.stringify({deployed:report.length,total:candidates.length}));
  }
  privateWrite(dir, 'deployment-summary-' + Date.now() + '.json', report);
  return {verifiedSources:report.length, newlyDeployed:report.filter(r => !r.alreadyVerified).length};
}
async function verifyOthers(dir) {
  dir = privateDirectory(dir);
  backupHost(dir,'localhost');
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'phone-sources-before.json'), 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(path.join(dir, 'phone-targets-candidate.json'), 'utf8'));
  const ids = targets(dir);
  assert.equal(candidates.length, ids.length, 'full canonical candidate set required');
  const after = await readAllSources(client('localhost'));
  assert.equal(after.length, before.length, 'phone source count changed');
  for (const candidate of candidates) {
    const actual = after.find(s => s.bookSourceUrl === candidate.bookSourceUrl);
    assert(actual && !changedPaths(candidate, actual).length, 'canonical target readback mismatch: ' + candidate.bookSourceUrl);
  }
  const other = before.filter(s => !ids.includes(s.bookSourceUrl));
  for (const s of other) {
    const a = after.find(x => x.bookSourceUrl === s.bookSourceUrl);
    assert(a && hash(a) === hash(s), 'unrelated phone source changed: ' + s.bookSourceUrl);
  }
  privateWrite(dir, 'phone-sources-readback-' + Date.now() + '.json', after);
  const report = {verifiedTargets:candidates.length, unchangedOtherSources: other.length, total: after.length};
  privateWrite(dir, 'verification-summary-' + Date.now() + '.json', report);
  return report;
}
async function debug(dir, id, key, timeout) {
  dir = privateDirectory(dir);
  const host=testHost();backupHost(dir,host);
  assert(targets(dir).includes(id), 'debug source must be a canonical target');
  const result = await client(host).debug(id, key, timeout || 55000);
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
if (require.main === module) main().catch(error => {
  console.error(error.message);
  if (error.cause) console.error(JSON.stringify(require('./usehtml_http_ws_client').errorDetails(error.cause)));
  process.exitCode = 1;
});
module.exports = {ROOT, IEEE, IDS, single, saveWithReadback, hash, privateDirectory, privateWrite, normalized, readAllSources, snapshot, deploy, verifyOthers, debug,testHost,sameHost};
