'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {stripCommon, configuredLib, loader, ieeeHtml, build} = require('../migrate_shared_common');
const {ROOT, IEEE, IDS, hash} = require('../shared_common_phone');
const {build: buildSmoke} = require('../shared_common_smoke');
const runtime = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-shared-runtime.js'), 'utf8');
const legacy = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'), 'utf8');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const cache = {get: () => null, put: () => {}};

function caller(lang, text = () => runtime) {
  let imports = 0;
  return {
    get: key => key === 'TARGET_LANG' ? lang : null,
    importScript: () => { imports++; return text(); },
    log: () => {},
    ajaxAll: urls => Array.from(urls, url => {
      const options = JSON.parse(url.slice(url.indexOf(',') + 1));
      return JSON.stringify(JSON.parse(options.body).map(v => ({translations: [{text:
        v.replace(/(<\|L\d+\|>\n)/g, '$1' + lang + ':')}]})));
    }),
    imports: () => imports
  };
}
function loaded(site = '') {
  const scope = vm.createContext({});
  vm.runInContext(site + '\n' + loader(COMMIT), scope);
  return scope;
}
function common() { const c = vm.createContext({}); vm.runInContext(runtime, c); return c; }

test('phone smoke safely embeds TeX and keeps a no-load control branch', () => {
  const capture = {status:200,host:'ieeexplore.ieee.org',body:String.raw`<tex-math>$\frac{{d\mathrm{snr}}}{1+x}$</tex-math>`};
  const {source,key} = buildSmoke(COMMIT,capture,'test-control');
  assert(source.jsLib.includes(COMMIT));
  assert(!source.jsLib.includes('function _ltString'));
  assert(!source.ruleContent.content.includes('{{'));
  assert(source.ruleContent.content.includes("String(result).indexOf('COMMON-CONTROL-')===0"));
  assert(source.ruleContent.content.includes("select('usehtml img').size()===0"));
  assert.equal(source.header,'{}');
  assert(key.startsWith('--http://127.0.0.1:1122/'));
});

test('jsLib initializes without java and only first successful call loads common', () => {
  const c = loaded(), j = caller('zh');
  assert.equal(c.__ltCommonApi, null);
  assert.equal(j.imports(), 0);
  assert.equal(c.TT('Hello', j, cache), 'zh:Hello');
  assert.equal(c.TT('Again', j, cache), 'zh:Again');
  assert.equal(j.imports(), 1);
});
test('cached API uses fresh caller/language and TJ never translates URLs/IDs', () => {
  const c = loaded(), first = caller('zh'), second = caller('fr');
  c.TT('Hello', first, cache);
  const result = JSON.parse(c.TJ('{"name":"World","href":"https://example.test/x","id":"123"}', second, cache));
  assert.deepEqual(result, {name: 'fr:World', href: 'https://example.test/x', id: '123'});
  assert.equal(first.imports(), 1);
  assert.equal(second.imports(), 0);
});
for (const [kind, invalid] of [['empty', ''], ['syntax', 'function {'], ['version', 'var LEGADO_SHARED_RUNTIME="999";'],
  ['missing-API', 'var LEGADO_SHARED_RUNTIME="1"; function TT(){}']]) {
  test('failed ' + kind + ' load is explicit, never half-cached, and can retry', () => {
    let text = invalid;
    const c = loaded(), j = caller('zh', () => text);
    assert.throws(() => c.TT('Hello', j, cache), /Cannot load common runtime/);
    assert.equal(c.__ltCommonApi, null);
    text = runtime;
    assert.equal(c.TT('Hello', j, cache), 'zh:Hello');
    assert.equal(j.imports(), 2);
  });
}
test('literal JSON is safe for rule parsing and preserves every decoded option', () => {
  const c = common();
  const values = [String.raw`{{d\mathrm{snr}}}`, '{{1+2}}', '<js>throw Error("literal")</js>',
    '@js:literal @get:{literal}', 'A & B 😀\n第二行', String.raw`\u007b \\ "quoted"`];
  const options = {method: 'POST', headers: {Referer: 'https://example.test/{{literal}}'}, body: JSON.stringify(values)};
  const encoded = c.useHtmlRuleJson(options);
  assert.deepEqual(JSON.parse(encoded), options);
  assert(!/{{|<js>|@js:|@get:/i.test(encoded));
  const translate = JSON.parse(c._ltOptions(values));
  assert.deepEqual(JSON.parse(translate.body), values);
  assert.deepEqual(translate.headers, {Authorization: 'Bearer ', 'Content-Type': 'application/json'});
});
test('SVG alias keeps exact TeX but request js restores the real CodeCogs endpoint', () => {
  const c = common(), tex = String.raw`\frac{d\mathrm{snr}}{1+x}, a&b`;
  const value = c._ltFormulaSvgUrl(tex), split = value.indexOf(',{');
  const visible = value.slice(0, split), options = JSON.parse(value.slice(split + 1));
  assert(visible.startsWith('https://latex.codecogs.com/svg.latex.svg?'));
  assert.equal(decodeURIComponent(visible.slice(visible.indexOf('?') + 1)), tex);
  assert.equal(vm.runInNewContext(options.js, {result: visible}),
    'https://latex.codecogs.com/svg.latex?' + encodeURIComponent(tex));
});
test('AST removal preserves site declarations before and after embedded common', () => {
  const before = 'var extract_selector=["strong"];\nfunction siteBefore(){return "inline";}\n';
  const after = '\nvar siteTail=42;\nfunction siteAfter(){return siteTail;}\n';
  const stripped = stripCommon(before + legacy + after);
  assert(stripped.includes(before));
  assert(stripped.includes('function siteAfter(){return siteTail;}'));
  assert(!stripped.includes('function _ltString'));
  const result = configuredLib(before + legacy + after, {extract_selector: ['em'], toc_mode: 'html'}, COMMIT);
  const c = loaded();
  vm.runInContext(result, c);
  assert.equal(c.siteBefore(), 'inline');
  assert.equal(c.siteAfter(), 42);
  assert.deepEqual(Array.from(c.extract_selector), ['strong']);
  assert.equal(configuredLib(result, {toc_mode: 'html'}, COMMIT), result);
});
test('mixed common/site declarations fail rather than truncate source code', () => {
  assert.throws(() => stripCommon(legacy + '\nvar LEGADO_TRANSLATION_RUNTIME="3",privateAfter=7;'), /mixed common\/site/);
  assert.throws(() => loader('master'), /immutable Git commit/);
});
function ieeeFixture() {
  return {bookSourceUrl: IEEE, bookSourceName: 'IEEE', jsLib: 'var sitePrivate=7;\n' + legacy,
    ruleContent: {content: 'var ieeeMode=String(java.get("RENDER_MODE") || "text");\nif(ieeeMode==="html")result=ltUseHtmlBlocks(String(result || ""));', webJs: 'unchanged'},
    loginUi: JSON.stringify([{name: 'SourceUrl', type: 'text'}, {name: '渲染模式', type: 'toggle', chars: ['TEXT', 'HTML'], default: 'TEXT', action: 'setRenderMode()'}]),
    loginUrl: 'function setRenderMode(){var raw=result["渲染模式"];var s=String(raw === undefined || raw === null ? "" : raw).toUpperCase();java.put("RENDER_MODE",s.indexOf("HTML")>=0?"html":"text");}',
    header: 'unchanged', enabled: false, customOrder: 17};
}
test('IEEE defaults to HTML while an explicitly selected TEXT remains TEXT', () => {
  const original = ieeeFixture(), converted = ieeeHtml(original);
  assert(converted.ruleContent.content.includes('|| "html"'));
  assert(converted.ruleContent.content.includes('ltUseHtmlBlocks(String(result || ""), java)'));
  assert.equal(JSON.parse(converted.loginUi)[1].default, 'HTML');
  for (const [choice, expected] of [[undefined, 'html'], ['HTML', 'html'], ['TEXT', 'text']]) {
    let mode;
    const c = vm.createContext({result: {'渲染模式': choice}, java: {put: (k, v) => {mode = v;}}});
    vm.runInContext(converted.loginUrl + ';setRenderMode();', c);
    assert.equal(mode, expected);
  }
  assert.equal(converted.ruleContent.webJs, original.ruleContent.webJs);
  assert.equal(converted.header, original.header);
  assert.equal(converted.enabled, false);
});
test('targeted migration changes only pilots and leaves all other objects identical', () => {
  const ieee = ieeeFixture();
  const local = [ieee, ...IDS.slice(1).map(bookSourceUrl => ({bookSourceUrl, jsLib: legacy, toc_mode: 'html', ruleToc: {kept: 'yes'}})),
    {bookSourceUrl: 'https://untouched.test', jsLib: 'not common', header: 'untouched', enabled: false}];
  const phone = local.slice(0, 3).map(s => JSON.parse(JSON.stringify(s)));
  const result = build(local, phone, COMMIT);
  assert.equal(hash(result.sources[3]), hash(local[3]));
  assert.equal(result.candidates.length, 3);
  assert.equal(result.sources[0].customOrder, 17);
  for (const source of result.sources.slice(0, 3)) {
    assert(source.jsLib.includes('/' + COMMIT + '/booksource/runtime/legado-shared-runtime.js'));
    assert(!source.jsLib.includes('/sites/'));
    assert(!source.jsLib.includes('/* legado-translation-runtime v1'));
  }
});
test('actual Rhino, Jsoup and Kotlin rule parser verify closures, HTML and formula encoding', () => {
  const home = process.env.USEHTML_JAVA_HOME, engine = process.env.USEHTML_ENGINE_JAR;
  const jsoup = process.env.USEHTML_JSOUP_JAR, compiler = process.env.USEHTML_KOTLIN_LIB;
  assert(home && engine && jsoup && compiler, 'set USEHTML_JAVA_HOME, USEHTML_ENGINE_JAR, USEHTML_JSOUP_JAR and USEHTML_KOTLIN_LIB');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booksrc-common-test-'));
  const stdlib = path.join(compiler, 'kotlin-stdlib-2.0.21.jar');
  const annotations = fs.readdirSync(compiler).filter(n => /^annotations-.*\.jar$/.test(n)).map(n => path.join(compiler, n));
  function run(cmd, args) {
    const r = spawnSync(cmd, args, {encoding: 'utf8', timeout: 45000});
    assert.equal(r.status, 0, r.stderr || r.error?.message);
    return r;
  }
  const java = path.join(home, 'bin/java'), javac = path.join(home, 'bin/javac');
  run(java, ['-cp', path.join(compiler, '*'), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect',
    '-jvm-target', '1.8', '-classpath', [stdlib, ...annotations].join(path.delimiter), '-d', dir,
    path.join(ROOT, 'legado/app/src/main/java/io/legado/app/model/analyzeRule/RuleAnalyzer.kt')]);
  const cp = [dir, stdlib, jsoup, engine, ...annotations].join(path.delimiter);
  run(javac, ['-encoding', 'UTF-8', '-cp', cp, '-d', dir, path.join(ROOT, 'tools/tests/SharedCommonRuntime.java')]);
  const r = run(java, ['-cp', cp, 'SharedCommonRuntime',
    path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'),
    path.join(ROOT, 'booksource/runtime/legado-shared-runtime.js'),
    path.join(ROOT, 'booksource/runtime/legado-common-loader.js'),
    process.env.USEHTML_ENGINE_PACKAGE || 'org.htmlunit.corejs.javascript',
    ...(process.env.USEHTML_IEEE_CAPTURE ? [process.env.USEHTML_IEEE_CAPTURE] : [])]);
  const report = JSON.parse(r.stdout.trim());
  assert.equal(report.status, 'PASS');
  assert(report.checks >= 20);
  console.log(JSON.stringify({...report, buildArtifacts: dir}));
});
