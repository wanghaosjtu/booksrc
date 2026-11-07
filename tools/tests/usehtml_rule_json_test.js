'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const runtime = fs.readFileSync(path.join(root, 'booksource/runtime/legado-translation-runtime.js'), 'utf8');
const guard = fs.readFileSync(path.join(root, 'booksource/runtime/legado-usehtml-rule-json.js'), 'utf8');

function context() {
  const c = vm.createContext({});
  vm.runInContext(runtime, c);
  vm.runInContext(guard, c);
  return c;
}

test('JSON string data cannot become an inline rule; decoded options stay identical', () => {
  const c = context();
  const values = [String.raw`{{d\mathrm{snr}}}`, '{{1+2}}', '<js>throw Error("literal")</js>',
    '@js:literal @get:{literal}', 'A & B 😀\n第二行', String.raw`\u007b \\ "quoted"`];
  const options = {method:'post', headers:{Authorization:'Bearer test-only', Referer:'https://example.test/'},
    body:JSON.stringify(values), nested:{data:{name:'{{literal}}'}}, empty:'', nullable:null};
  const encoded = c.useHtmlRuleJson(options);
  assert.deepEqual(JSON.parse(encoded), options);
  assert(!encoded.includes('{{'));
  assert(!/<js>|@js:|@get:/i.test(encoded));
  assert(encoded.endsWith('}'), 'object delimiters remain valid JSON');
});

test('translation guard preserves body/headers and loading twice does not wrap twice', () => {
  const c = context();
  const value = String.raw`{{d\mathrm{snr}}}` + '\n';
  const before = c._ltOptions;
  const encoded = c._ltOptions([value]);
  assert.deepEqual(JSON.parse(JSON.parse(encoded).body), [value]);
  assert.deepEqual(JSON.parse(encoded).headers, {Authorization:'Bearer ', 'Content-Type':'application/json'});
  assert(!encoded.includes('{{'));
  vm.runInContext(guard, c);
  assert.equal(c._ltOptions, before);
});

test('standalone serializer and undefined/null data are safe without a translation runtime', () => {
  const c = vm.createContext({});
  vm.runInContext(guard, c);
  assert.equal(c.useHtmlRuleJson(undefined), undefined);
  assert.equal(c.useHtmlRuleJson(null), 'null');
  for (const value of ['{{x}}', 'a\\b', '"q"', '{', '}', '\n', '😀']) {
    assert.equal(JSON.parse(c.useHtmlRuleJson(value)), value);
  }
});

test('actual Kotlin RuleAnalyzer and real JS engine reproduce and prevent the formula error', () => {
  const home = process.env.USEHTML_JAVA_HOME;
  const engine = process.env.USEHTML_ENGINE_JAR;
  const jsoup = process.env.USEHTML_JSOUP_JAR;
  const compiler = process.env.USEHTML_KOTLIN_LIB;
  assert(home && engine && jsoup && compiler, 'set USEHTML_JAVA_HOME, USEHTML_ENGINE_JAR, USEHTML_JSOUP_JAR and USEHTML_KOTLIN_LIB');
  const stdlib = path.join(compiler, 'kotlin-stdlib-2.0.21.jar');
  const annotations = fs.readdirSync(compiler).filter(n => /^annotations-.*\.jar$/.test(n)).map(n => path.join(compiler, n));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booksrc-usehtml-formula-'));
  const java = path.join(home, 'bin/java');
  const javac = path.join(home, 'bin/javac');
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, {encoding:'utf8', timeout:45000});
    assert.equal(r.status, 0, r.stderr || r.error?.message);
    return r;
  };
  run(java, ['-cp', path.join(compiler, '*'), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-jvm-target', '1.8', '-classpath', [stdlib, ...annotations].join(path.delimiter),
    '-d', dir, path.join(root, 'legado/app/src/main/java/io/legado/app/model/analyzeRule/RuleAnalyzer.kt')]);
  const cp = [dir, stdlib, jsoup, engine, ...annotations].join(path.delimiter);
  run(javac, ['-encoding', 'UTF-8', '-cp', cp, '-d', dir, path.join(root, 'tools/tests/UseHtmlFormulaRule.java')]);
  const r = run(java, ['-cp', cp, 'UseHtmlFormulaRule',
    path.join(root, 'booksource/runtime/legado-translation-runtime.js'),
    path.join(root, 'booksource/runtime/legado-usehtml-rule-json.js'),
    path.join(root, 'booksource/runtime/legado-usehtml-validation.js'),
    process.env.USEHTML_ENGINE_PACKAGE || 'org.htmlunit.corejs.javascript',
    ...(process.env.USEHTML_IEEE_CAPTURE ? [process.env.USEHTML_IEEE_CAPTURE] : [])]);
  const report = JSON.parse(r.stdout.trim());
  assert.equal(report.status, 'PASS');
  assert(report.checks >= 11);
  if (process.env.USEHTML_IEEE_CAPTURE) {
    assert.equal(report.article.status, 'PASS');
    assert(report.article.texMathElements > 0 && report.article.checks >= 12);
    assert.equal(report.article.phonePipelineVerified, false);
  }
  console.log(JSON.stringify({...report, buildArtifacts:dir}));
});
