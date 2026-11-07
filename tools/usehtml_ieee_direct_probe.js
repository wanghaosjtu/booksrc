#!/usr/bin/env node
/* Phone REST, local ajaxAll and public MathML metadata only; does not export responses or cookies. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const client = require('./usehtml_http_ws_client');
const {ROOT} = require('./build_usehtml_validation');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');

function buildProbeCode(mode) {
  assert(['rest', 'ajaxall', 'mathml', 'cache', 'threads'].includes(mode), 'known read-only probe mode required');
  let code = `(function(){
    var text=String(result);
    var meta={kind:'phone-${mode}-metadata-only',characters:text.length,
      texMath:(text.match(/<tex-math\\b/g)||[]).length,
      mathMarkup:(text.match(/<math\\b/g)||[]).length,
      speechMarkup:/cc-speech/.test(text),
      challengeHint:/cloudfront|cloudflare|challenge-platform|captcha/i.test(text),
      jsonLike:/^\\s*\\{/.test(text),cookieExport:false};
    java.log('UHV-DIRECT-IEEE '+JSON.stringify(meta));
    return '<p class="notranslate">UHV-REST-METADATA-ONLY</p>';
  })()`;
  const health = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
  if (mode === 'ajaxall') code = `(function(){
    java.log('UHV-LOCAL-ALL-START');
    var scalar=String(java.ajax(${JSON.stringify(health)}));
    java.log('UHV-LOCAL-SCALAR-DONE bytes='+scalar.length);
    var rows=java.ajaxAll([${JSON.stringify(health)}],false);
    var meta={kind:'phone-local-ajaxAll-contrast',responses:Number(rows.length),scalarBytes:scalar.length,
      firstBodyBytes:rows.length?String(rows[0].body).length:0,externalRequests:false};
    java.log('UHV-DIRECT-IEEE '+JSON.stringify(meta));
    return '<p class="notranslate">UHV-LOCAL-ALL-END</p>';
  })()`;
  if (mode === 'cache') code = '(' + function () {
    java.log('UHV-CACHE-READ-START');
    var started = new Date().getTime();
    var present = cache.get('usehtml-diagnostic-missing-key-no-write') != null;
    var meta = {kind: 'phone-cache-read-only', completed: true, present: present,
      elapsedMs: new Date().getTime() - started, cacheWrites: false, externalRequests: false};
    java.log('UHV-DIRECT-IEEE ' + JSON.stringify(meta));
    return '<p class="notranslate">UHV-CACHE-READ-END</p>';
  }.toString() + ')()';
  if (mode === 'threads') code = '(' + function () {
    var meta = {kind: 'phone-app-thread-stack-projection', supported: true, threads: [],
      credentials: false, externalRequests: false, cacheWrites: false, cacheEntryBlocked: 0, cacheInside: 0};
    try {
      var map = Packages.java.lang.Thread.getAllStackTraces(), entries = map.entrySet().iterator(), item, thread, frames, hit, i, frame, names, cacheHit, entryBlocked, row, rows = [];
      meta.totalThreads = Number(map.size());
      meta.cacheReflection = true; meta.cacheMethods = [];
      try {
        var klass = cache.getClass(), methods = klass.getMethods(), method, methodName;
        for (i = 0; i < methods.length; i++) {
          method = methods[i]; methodName = String(method.getName());
          if (methodName !== 'get' && methodName !== 'put' && methodName !== 'delete') continue;
          meta.cacheMethods.push({name: methodName, parameters: Number(method.getParameterTypes().length),
            synchronized: !!Packages.java.lang.reflect.Modifier.isSynchronized(method.getModifiers())});
        }
      } catch (ignore) { meta.cacheReflection = false; }
      while (entries.hasNext()) {
        item = entries.next(); thread = item.getKey(); frames = item.getValue(); hit = false; cacheHit = false;
        for (i = 0; i < frames.length; i++) {
          frame = frames[i];
          if (/^(?:io\.legado\.app\.(?:help\.CacheManager|help\.JsExtensions|model\.analyzeRule)|com\.script\.)/.test(String(frame.getClassName()))) hit = true;
          if (String(frame.getClassName()) === 'io.legado.app.help.CacheManager') cacheHit = true;
        }
        if (!hit) continue;
        entryBlocked = cacheHit && String(thread.getState()) === 'BLOCKED' && frames.length &&
          String(frames[0].getClassName()) === 'io.legado.app.help.CacheManager';
        if (cacheHit) { if (entryBlocked) meta.cacheEntryBlocked++; else meta.cacheInside++; }
        names = [];
        for (i = 0; i < frames.length && i < 35; i++) names.push(String(frames[i].getClassName()) + '.' + String(frames[i].getMethodName()));
        row = {id: Number(thread.getId()), state: String(thread.getState()), frames: names,
          cacheCall: cacheHit, cacheEntryBlocked: !!entryBlocked, priority: cacheHit ? (entryBlocked ? 2 : 0) : 1};
        rows.push(row);
      }
      rows.sort(function (a, b) { return a.priority - b.priority; });
      meta.matchingThreads = rows.length;
      for (i = 0; i < rows.length && i < 6; i++) { delete rows[i].priority; meta.threads.push(rows[i]); }
    } catch (ignore) { meta.supported = false; }
    java.log('UHV-DIRECT-IEEE ' + JSON.stringify(meta));
    return '<p class="notranslate">UHV-THREAD-PROJECTION-END</p>';
  }.toString() + ')()';
  return code;
}

async function run(label, mode = 'rest') {
  assert(['rest', 'ajaxall', 'mathml', 'cache', 'threads'].includes(mode), 'known read-only probe mode required');
  assert(label && /^[a-zA-Z0-9_-]+$/.test(label), 'fresh explicit evidence label required');
  const file = path.join(DIR, label + '.json'); assert(!fs.existsSync(file), 'evidence already exists');
  const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8'));
  assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'matching explicit phone required');
  const book = state.books.find(b => b.kind === 'parser' && b.status === 'created'); assert(book, 'owned parser source required');
  const code = buildProbeCode(mode);
  const health = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-rule-json.js'), 'utf8'), context);
  let target = ['ajaxall', 'cache', 'threads'].includes(mode) ? health : 'https://ieeexplore.ieee.org/rest/document/9737357/';
  if (mode === 'mathml') {
    const html=JSON.parse(fs.readFileSync(path.join(DIR,'ieee-parser-content-first-v1.json'),'utf8')).content;
    const tex=html.match(/<p\b[^>]*\bid="uhv-real-tex"[^>]*>([^<]*)<\/p>/);
    assert(tex && !tex[1].includes('&'),'exact cached public TeX required');
    target='https://latex.codecogs.com/mathml.latex?'+encodeURIComponent(tex[1]);
  }
  const key = '--' + target + ',' + context.useHtmlRuleJson({bodyJs: code, timeout: 10000});
  const result = await client.debug(book.book.origin, key, mode === 'rest' ? 45000 : 15000);
  const summary = client.summarizeDebug(result, key);
  const match = result.messages.join('\n').match(/UHV-DIRECT-IEEE (\{[^\n]+\})/);
  const metadata = match ? JSON.parse(match[1]) : null;
  fs.writeFileSync(file, JSON.stringify({observedAt: new Date().toISOString(), ...result, metadata}, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  return {label, ...summary, metadata, fullIeeePipeline: false};
}
module.exports = {buildProbeCode};
if (require.main === module) run(process.argv[2], process.argv[3]).then(result => {
  console.log(JSON.stringify(result, null, 2)); if (result.isError || !result.metadata) process.exitCode = 1;
}).catch(error => {console.error(JSON.stringify(client.errorDetails(error))); process.exitCode = 1;});
