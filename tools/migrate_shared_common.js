'use strict';
// All canonical sources share common; site logic and phone snapshots stay local.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const {ROOT, IEEE, IDS, privateDirectory, privateWrite, hash} = require('./shared_common_phone');
const LEGACY_MARKER = '/* legado-translation-runtime v1';
const LOADER_MARKER = '/* legado-common-loader v';
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
const LOADER_NAMES = new Set(parse(TEMPLATE).body.flatMap(names));

function stripCommon(text) {
  assert(typeof text === 'string', 'jsLib must be a string');
  const network = text.includes(LOADER_MARKER);
  assert(!(network && text.includes(LEGACY_MARKER)), 'mixed inline/network runtimes');
  const marker = network ? LOADER_MARKER : LEGACY_MARKER;
  const start = text.indexOf(marker);
  const ownedNames = network ? LOADER_NAMES : COMMON_NAMES;
  if (start < 0) {
    // Empty and genuine custom libraries must keep all their code. A collision
    // with common's API is not safe to guess away.
    assert(!parse(text).body.flatMap(names).some(n => COMMON_NAMES.has(n) || LOADER_NAMES.has(n)),
      'unmarked common/API declaration requires an explicit migration');
    return text.trimEnd();
  }
  assert(start === text.lastIndexOf(marker), 'one marked runtime required');
  const removals = [];
  const comments = [];
  const tree = acorn.parse(text, {ecmaVersion: 'latest', onComment: comments});
  for (const node of tree.body) {
    if (node.start < start) continue;
    const declared = names(node);
    const owned = declared.filter(name => ownedNames.has(name));
    if (owned.length) {
      assert.equal(owned.length, declared.length, 'mixed common/site declaration: refusing to truncate site code');
      removals.push([node.start, node.end]);
    } else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
        && node.expression.left.type === 'Identifier' && ownedNames.has(node.expression.left.name)) {
      throw new Error('unsupported common monkey patch; merge it explicitly before migration');
    }
  }
  for (const comment of comments) {
    if (comment.start === start) removals.push([comment.start, comment.end]);
  }
  for (const [a, b] of removals.sort((a, b) => b[0] - a[0])) text = text.slice(0, a) + text.slice(b);
  const site = text.trimEnd();
  parse(site);
  assert(!site.includes(marker), 'runtime marker survived');
  assert(!parse(site).body.flatMap(names).some(n => COMMON_NAMES.has(n) || LOADER_NAMES.has(n)),
    'common declaration survived outside the marker');
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
  // Android may return a wrapped empty java.lang.String, which is truthy in
  // Rhino. Apply the default after String conversion, not inside the bridge.
  content = content.replace(/String\(java\.get\("RENDER_MODE"\) \|\| "html"\)(?:\.toLowerCase\(\))?/,
    'String(java.get("RENDER_MODE") || "").trim().toLowerCase() || "html"');
  assert(content.includes('String(java.get("RENDER_MODE") || "").trim().toLowerCase() || "html"'), 'safe default render mode required');
  assert(calls(content,'ltUseHtmlBlocks').every(n => n.arguments[1]?.name === 'java'), 'HTML helper must receive the current java');
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
const PAGE_URL = 'String(typeof baseUrl === "undefined" ? "" : baseUrl)';
function edits(text, changes) {
  for (const [start, end, value] of changes.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + value + text.slice(end);
  return text;
}
function calls(text, name) {
  const found = [], re = new RegExp('\\b' + name + '\\s*\\(', 'g');
  for (const match of text.matchAll(re)) {
    if (/function\s+$/.test(text.slice(Math.max(0, match.index - 30), match.index))) continue;
    let node;
    try { node = acorn.parseExpressionAt(text, match.index, {ecmaVersion: 'latest'}); }
    catch { throw new Error('cannot safely parse ' + name + ' call at offset ' + match.index); }
    assert(node.type === 'CallExpression' && node.callee.name === name, 'expected a direct common call');
    found.push(node);
  }
  return found;
}
function hasCommon(source) { return /\/\* legado-(?:translation-runtime|common-loader) v/.test(source.jsLib || ''); }
function imageContent(source) {
  const s = clone(source);
  if (!s.ruleContent || typeof s.ruleContent.content !== 'string') return s;
  let r = s.ruleContent.content;
  // These legacy optional calls were inactive on sources with no library.
  // Activate only image handling, not new translation/cleanup behavior.
  if (!hasCommon(source)) {
    r = edits(r, calls(r, 'TH').filter(n => /if\s*\(\s*typeof\s+TH\s*===?\s*["']function["']\s*\)\s*\w+\s*=\s*$/.test(r.slice(Math.max(0, n.start - 100), n.start)))
      .map(n => [n.start, n.end, 'ltPrepareImages(' + r.slice(n.arguments[0].start, n.arguments[0].end)
        + ', java, {image_base_url:' + PAGE_URL + '})']));
  }
  // Reuse common extraction before site cleanup. In particular usehtml must
  // unwrap as DOM, while tex-math extraction must remain literal text.
  const extractEdits = [];
  for (const m of r.matchAll(/\bextract_selector\.forEach\s*\(/g)) {
    const node = acorn.parseExpressionAt(r, m.index, {ecmaVersion:'latest'});
    const code = r.slice(node.start, node.end);
    const doc = code.match(/\b([$\w]+)\.select\(/);
    assert(doc, 'extract loop document not found');
    extractEdits.push([node.start, node.end, 'ltExtract(' + doc[1] + ', java, extract_selector)']);
  }
  r = edits(r, extractEdits);
  // Resolve lazy/srcset/picture/anchor URLs before a source deletes their
  // attributes. Keep the document itself so metadata and extraction stay put.
  const preEdits = [];
  const anchor = /a:has\(img\[loading/.test(r) && /img\.attr\(["']src["'],\s*(?:href|src)\)/.test(r);
  const anchorOptions = anchor ? ', image_anchor_mode:"href"' + (r.includes('aHref +') && r.includes('"webView":true') ? ', image_anchor_options:{webView:true}' : '') : '';
  for (const m of r.matchAll(/^[ \t]*([$\w]+)\.select\(\s*(["'])img[^\n]*?\2\s*\)\.forEach\(/gm)) {
    if (r.slice(Math.max(0, m.index - 260), m.index).includes('/* Common images before source cleanup. */')) continue;
    preEdits.push([m.index, m.index, '/* Common images before source cleanup. */\nltPrepareImages(' + m[1]
      + ', java, {image_base_url:' + PAGE_URL + anchorOptions + '});\n']);
  }
  r = edits(r, preEdits);
  const baseEdits = [];
  for (const n of calls(r, 'TH')) {
    assert(n.arguments.length === 3 || n.arguments.length === 4, 'unsupported TH signature');
    if (n.arguments.length === 3) {
      baseEdits.push([n.end - 1, n.end - 1, ', {image_base_url:' + PAGE_URL + '}']);
      continue;
    }
    const o = n.arguments[3];
    assert(o.type === 'ObjectExpression', 'TH options must be an explicit object');
    const base = o.properties.find(p => (p.key.name || p.key.value) === 'image_base_url');
    if (!base) baseEdits.push([o.start + 1, o.start + 1, 'image_base_url:' + PAGE_URL + (o.properties.length ? ', ' : '')]);
    else if (base.value.type === 'Literal' && typeof base.value.value === 'string') {
      const fallback = r.slice(base.value.start, base.value.end);
      baseEdits.push([base.value.start, base.value.end, '(' + PAGE_URL + ' || ' + fallback + ')']);
    }
  }
  for (const n of calls(r, 'TC')) {
    const a = n.arguments[0];
    assert(a, 'TC HTML input missing');
    if (a.type === 'CallExpression' && a.callee.name === 'ltPrepareImages') continue;
    baseEdits.push([a.start, a.end, 'ltPrepareImages(' + r.slice(a.start, a.end) + ', java, {image_base_url:' + PAGE_URL + '})']);
  }
  for (const n of calls(r, 'ltUseHtmlBlocks')) {
    if (n.arguments.length === 2) baseEdits.push([n.end - 1, n.end - 1, ', ' + PAGE_URL]);
    else assert(n.arguments.length >= 3, 'HTML helper must receive current java and page URL');
  }
  s.ruleContent.content = edits(r, baseEdits);
  return s;
}
function build(local, phone, commit) {
  assert(local.length && phone.length, 'canonical and phone source baselines required');
  assert.equal(new Set(local.map(s => s.bookSourceUrl)).size, local.length, 'duplicate canonical identity');
  assert.equal(new Set(phone.map(s => s.bookSourceUrl)).size, phone.length, 'duplicate phone identity');
  const output = clone(local), candidates = [];
  for (const formal of output) {
    const id = formal.bookSourceUrl, baseline = phone.find(s => s.bookSourceUrl === id);
    assert(baseline, 'phone source baseline missing: ' + id);
    let candidate = imageContent(id === IEEE ? ieeeHtml(baseline) : baseline);
    const canonical = imageContent(id === IEEE ? ieeeHtml(formal) : formal);
    candidate.jsLib = configuredLib(baseline.jsLib || '', formal, commit);
    formal.jsLib = candidate.jsLib;
    if (canonical.ruleContent) formal.ruleContent.content = canonical.ruleContent.content;
    if (id === IEEE) {
      formal.ruleContent.content = candidate.ruleContent.content;
      formal.loginUi = candidate.loginUi;
      formal.loginUrl = candidate.loginUrl;
    }
    candidates.push(candidate);
  }
  for (let i = 0; i < local.length; i++) {
    for (const field of Object.keys(local[i])) {
      if (field === 'jsLib' || field === 'ruleContent' || (local[i].bookSourceUrl === IEEE && ['loginUi','loginUrl'].includes(field))) continue;
      assert.equal(hash(local[i][field]), hash(output[i][field]), 'unrelated canonical field changed: ' + field);
    }
    for (const field of Object.keys(local[i].ruleContent || {})) {
      if (field !== 'content') assert.equal(hash(local[i].ruleContent[field]), hash(output[i].ruleContent[field]), 'non-content rule field changed');
    }
  }
  assert.equal(candidates.length, local.length, 'incomplete all-source migration');
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
  const phone = JSON.parse(fs.readFileSync(path.join(dir, 'phone-sources-before.json'), 'utf8'));
  const result = build(local, phone, commit);
  const report = {commit, total: result.sources.length, networkSources: result.candidates.length,
    beforeJsLibBytes: local.reduce((n,s) => n + Buffer.byteLength(s.jsLib || ''), 0),
    afterJsLibBytes: result.sources.reduce((n,s) => n + Buffer.byteLength(s.jsLib || ''), 0),
    changedContentSources: result.sources.filter((s,i) => s.ruleContent?.content !== local[i].ruleContent?.content).length,
    sources: result.candidates.map(s => ({id: s.bookSourceUrl, jsLibBytes: Buffer.byteLength(s.jsLib), sha256: hash(s)})),
    mode: mode || '--dry-run'};
  if (mode === '--write') {
    privateWrite(dir, 'phone-targets-candidate.json', result.candidates);
    privateWrite(dir, 'migration-summary.json', report);
    assert.equal(fs.readFileSync(filename, 'utf8'), before, 'concurrent canonical edit detected');
    // A targeted bulk JSON rewrite; all unrelated objects were checked above.
    fs.writeFileSync(filename, JSON.stringify(result.sources, null, 2) + '\n');
  } else assert(!mode || mode === '--dry-run', 'use --dry-run or --write');
  const {sources, ...summary} = report;
  console.log(JSON.stringify(summary, null, 2));
}
if (require.main === module) main();
module.exports = {stripCommon, configuredLib, loader, ieeeHtml, imageContent, build, LOADER_MARKER, COMMON_NAMES};
