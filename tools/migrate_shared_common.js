'use strict';
// Only three sources migrate. Never publish this tool's private input/output.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const {ROOT, IEEE, IDS, privateDirectory, privateWrite, hash} = require('./shared_common_phone');
const LEGACY_MARKER = '/* legado-translation-runtime v1';
const LOADER_MARKER = '/* legado-common-loader v1';
const RUNTIME_PATH = 'booksource/runtime/legado-shared-runtime.js';
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_PATH), 'utf8');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-common-loader.js'), 'utf8');
const SETTINGS = ['remove_selector', 'extract_selector', 'toc_mode', 'formula_mode', 'formula_selector'];
const parse = text => acorn.parse(text, {ecmaVersion: 'latest'});
const clone = value => JSON.parse(JSON.stringify(value));
function names(node) {
  if (node.type === 'FunctionDeclaration') return [node.id.name];
  if (node.type === 'VariableDeclaration') {
    assert(node.declarations.every(d => d.id.type === 'Identifier'), 'destructuring cannot own common declarations');
    return node.declarations.map(d => d.id.name);
  }
  return [];
}
const COMMON_NAMES = new Set(parse(RUNTIME).body.flatMap(names));

function stripCommon(text) {
  assert(typeof text === 'string', 'jsLib must be a string');
  if (text.includes(LOADER_MARKER)) {
    assert(!text.includes(LEGACY_MARKER), 'mixed inline/network runtimes');
    return text.slice(0, text.indexOf(LOADER_MARKER)).trimEnd();
  }
  const start = text.indexOf(LEGACY_MARKER);
  assert(start >= 0 && start === text.lastIndexOf(LEGACY_MARKER), 'one marked embedded runtime required');
  const removals = [];
  const comments = [];
  const tree = acorn.parse(text, {ecmaVersion: 'latest', onComment: comments});
  for (const node of tree.body) {
    if (node.start < start) continue;
    const declared = names(node);
    const owned = declared.filter(name => COMMON_NAMES.has(name));
    if (owned.length) {
      assert.equal(owned.length, declared.length, 'mixed common/site declaration: refusing to truncate site code');
      removals.push([node.start, node.end]);
    } else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
        && node.expression.left.type === 'Identifier' && COMMON_NAMES.has(node.expression.left.name)) {
      throw new Error('unsupported common monkey patch; merge it explicitly before migration');
    }
  }
  for (const comment of comments) {
    if (comment.start === start) removals.push([comment.start, comment.end]);
  }
  for (const [a, b] of removals.sort((a, b) => b[0] - a[0])) text = text.slice(0, a) + text.slice(b);
  const site = text.trimEnd();
  parse(site);
  assert(!site.includes(LEGACY_MARKER), 'embedded marker survived');
  assert(!parse(site).body.flatMap(names).some(n => COMMON_NAMES.has(n)), 'common declaration survived outside the marker');
  return site;
}
function loader(commit) {
  assert(/^[0-9a-f]{40}$/.test(commit), 'full immutable Git commit SHA required');
  assert.equal(TEMPLATE.split('__COMMON_COMMIT__').length, 2, 'one commit placeholder required');
  return TEMPLATE.replace('__COMMON_COMMIT__', commit);
}
function configuredLib(text, metadata, commit) {
  let site = stripCommon(text);
  const globals = new Set(parse(site).body.flatMap(node => {
    const declared = names(node);
    if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
        && node.expression.left.type === 'Identifier') declared.push(node.expression.left.name);
    return declared;
  }));
  const defaults = {remove_selector: ['script', 'noscript', 'style'], extract_selector: [],
    toc_mode: metadata.toc_mode || 'html', formula_mode: 'none', formula_selector: ''};
  const missing = SETTINGS.filter(name => !globals.has(name)).map(name =>
    'var ' + name + ' = ' + JSON.stringify(metadata[name] === undefined ? defaults[name] : metadata[name]) + ';');
  // Existing inline settings win. The fallback declarations survive Android's
  // BookSource deserialization, which does not retain our extra JSON metadata.
  site += (missing.length ? '\n\n/* Source-local settings; no network site module. */\n' + missing.join('\n') : '');
  return site.trimEnd() + '\n\n' + loader(commit);
}
function ieeeHtml(source) {
  const s = clone(source);
  let content = s.ruleContent.content;
  assert(content.includes('ltUseHtmlBlocks(String(result || "")'), 'latest segmented IEEE source required');
  content = content.replace('ltUseHtmlBlocks(String(result || ""))', 'ltUseHtmlBlocks(String(result || ""), java)');
  content = content.replace('java.get("RENDER_MODE") || "text"', 'java.get("RENDER_MODE") || "html"')
    .replace('默认 TEXT', '默认 HTML');
  assert(content.includes('ltUseHtmlBlocks(String(result || ""), java)'), 'HTML helper must receive the current java');
  s.ruleContent.content = content;
  const uiWasString = typeof s.loginUi === 'string';
  const ui = uiWasString ? JSON.parse(s.loginUi) : clone(s.loginUi);
  const toggle = ui.find(x => x.name === '渲染模式');
  assert(toggle && toggle.type === 'toggle' && toggle.chars.includes('TEXT') && toggle.chars.includes('HTML'), 'render toggle must survive');
  toggle.default = 'HTML';
  s.loginUi = uiWasString ? JSON.stringify(ui) : ui;
  assert(s.loginUrl.includes('function setRenderMode()'), 'render toggle action must survive');
  s.loginUrl = s.loginUrl.replace('String(raw === undefined || raw === null ? "" : raw).toUpperCase()',
    'String(raw === undefined || raw === null ? "HTML" : raw).toUpperCase()');
  return s;
}
function build(local, phone, commit) {
  assert(local.length && phone.length === IDS.length, 'formal sources and three phone baselines required');
  const output = clone(local), candidates = [];
  for (const id of IDS) {
    const matches = output.filter(s => s.bookSourceUrl === id);
    assert.equal(matches.length, 1, 'unique formal pilot required: ' + id);
    const formal = matches[0], baseline = phone.find(s => s.bookSourceUrl === id);
    assert(baseline, 'phone pilot baseline missing');
    let candidate = id === IEEE ? ieeeHtml(baseline) : clone(baseline);
    // IEEE uses the user's latest phone library. Other sites preserve the
    // canonical inline declarations and their existing phone rule branches.
    const originalLib = id === IEEE ? baseline.jsLib : formal.jsLib;
    candidate.jsLib = configuredLib(originalLib, formal, commit);
    formal.jsLib = candidate.jsLib;
    if (id === IEEE) {
      formal.ruleContent.content = candidate.ruleContent.content;
      formal.loginUi = candidate.loginUi;
      formal.loginUrl = candidate.loginUrl;
    }
    candidates.push(candidate);
  }
  for (let i = 0; i < local.length; i++) {
    if (!IDS.includes(local[i].bookSourceUrl)) assert.equal(hash(local[i]), hash(output[i]), 'unrelated formal source changed');
  }
  return {sources: output, candidates};
}
function main() {
  const [commit, directory, mode] = process.argv.slice(2);
  const dir = privateDirectory(directory);
  const filename = path.join(ROOT, 'booksource/legado-book-sources-current.json');
  const before = fs.readFileSync(filename, 'utf8');
  const local = JSON.parse(before);
  const original = JSON.parse(fs.readFileSync(path.join(dir, 'local-sources-before.json'), 'utf8'));
  assert.equal(hash(local), hash(original), 'canonical sources changed since backup; refusing to overwrite');
  const phone = JSON.parse(fs.readFileSync(path.join(dir, 'phone-pilots-before.json'), 'utf8'));
  const result = build(local, phone, commit);
  const report = {commit, total: result.sources.length, unchangedOtherSources: local.length - IDS.length,
    pilots: result.candidates.map(s => ({id: s.bookSourceUrl, jsLibBytes: Buffer.byteLength(s.jsLib), sha256: hash(s)})),
    mode: mode || '--dry-run'};
  if (mode === '--write') {
    privateWrite(dir, 'phone-pilots-candidate.json', result.candidates);
    privateWrite(dir, 'migration-summary.json', report);
    assert.equal(fs.readFileSync(filename, 'utf8'), before, 'concurrent canonical edit detected');
    // A targeted bulk JSON rewrite; all unrelated objects were checked above.
    fs.writeFileSync(filename, JSON.stringify(result.sources, null, 2) + '\n');
  } else assert(!mode || mode === '--dry-run', 'use --dry-run or --write');
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main();
module.exports = {stripCommon, configuredLib, loader, ieeeHtml, build, LOADER_MARKER, COMMON_NAMES};
