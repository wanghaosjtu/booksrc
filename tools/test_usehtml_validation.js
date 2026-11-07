#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const builder = require('./build_usehtml_validation');
const baseline = JSON.parse(fs.readFileSync(path.join(builder.ROOT,
  'booksource/legado-book-sources-current.json'), 'utf8'));
const runtime = fs.readFileSync(path.join(builder.ROOT,
  'booksource/runtime/legado-usehtml-validation.js'), 'utf8');

test('candidate changes only identity, display name and content rule', () => {
  const before = structuredClone(baseline);
  const original = baseline.find(s => s.bookSourceUrl === builder.SOURCE_ID);
  const candidate = builder.build(baseline, runtime);
  assert.equal(candidate.bookSourceUrl, builder.TEST_ID);
  assert(candidate.bookSourceName.endsWith(' · HTML验证'));
  assert(candidate.ruleContent.content.startsWith(original.ruleContent.content));
  new vm.Script(runtime);
  new vm.Script(candidate.ruleContent.content.slice(original.ruleContent.content.length)
    .replace(/^\s*<js>\s*/, '').replace(/\s*<\/js>\s*$/, ''));
  candidate.bookSourceUrl = original.bookSourceUrl;
  candidate.bookSourceName = original.bookSourceName;
  candidate.ruleContent.content = original.ruleContent.content;
  assert.deepEqual(candidate, original);
  assert.deepEqual(baseline, before, 'building must not mutate the baseline');
});

test('API response shape is accepted and ambiguous sources are rejected', () => {
  assert.deepEqual(builder.build({data: baseline}, runtime), builder.build(baseline, runtime));
  assert.throws(() => builder.build([], runtime), /uniquely present/);
  const original = baseline.find(s => s.bookSourceUrl === builder.SOURCE_ID);
  assert.throws(() => builder.build([original, original], runtime), /uniquely present/);
  assert.throws(() => builder.normalizeSources({data: null}), /expected a source array/);
});

test('canonical source list cannot be used as an output', () => {
  const canonical = path.join(builder.ROOT, 'booksource/legado-book-sources-current.json');
  assert.throws(() => builder.writeCandidate(canonical, canonical), /overwrite the baseline/);
});

test('real Jsoup and JavaScript engine validate the HTML wrapper', () => {
  const jsoup = process.env.USEHTML_JSOUP_JAR;
  const engine = process.env.USEHTML_ENGINE_JAR;
  assert(jsoup && fs.existsSync(jsoup), 'set USEHTML_JSOUP_JAR to an existing Jsoup jar');
  assert(engine && fs.existsSync(engine), 'set USEHTML_ENGINE_JAR to the Legado JavaScript engine jar');
  const namespace = process.env.USEHTML_ENGINE_PACKAGE || 'org.htmlunit.corejs.javascript';
  const javaHome = process.env.USEHTML_JAVA_HOME;
  const java = javaHome ? path.join(javaHome, 'bin/java') : 'java';
  const javac = javaHome ? path.join(javaHome, 'bin/javac') : 'javac';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'booksrc-usehtml-jvm-'));
  const classpath = [temporary, jsoup, engine].join(path.delimiter);
  const compile = spawnSync(javac, ['-encoding', 'UTF-8', '-cp', jsoup, '-d', temporary,
    path.join(builder.ROOT, 'tools/tests/UseHtmlValidation.java')], {encoding: 'utf8', timeout: 30000});
  assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
  const run = spawnSync(java, ['-cp', classpath, 'UseHtmlValidation',
    path.join(builder.ROOT, 'booksource/runtime/legado-usehtml-validation.js'),
    path.join(builder.ROOT, 'booksource/fixtures/usehtml-validation.html'), namespace],
    {encoding: 'utf8', timeout: 30000});
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const report = JSON.parse(run.stdout.trim());
  assert.equal(report.status, 'PASS');
  assert(report.checks >= 30);
  console.log(JSON.stringify({...report, engine: namespace, buildArtifacts: temporary}));
});
