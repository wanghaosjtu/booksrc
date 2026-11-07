#!/usr/bin/env node
/* Reconstructed real-formula request through Android's parser; no account changes. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const client = require('./usehtml_http_ws_client');
const {ROOT} = require('./build_usehtml_validation');
const DIR = path.join(ROOT, 'booksource/.usehtml-validation-phone');
const HEALTH = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
const guard = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-rule-json.js'), 'utf8');

function build(capture) {
  assert(capture.status === 200 && capture.host === 'ieeexplore.ieee.org', 'successful actual IEEE capture required');
  const match = [...capture.body.matchAll(/<tex-math\b[^>]*>[\s\S]*?<\/tex-math>/g)]
    .find(item => item[0].replace(/\s+/g, '').includes('{{d\\mathrm{snr}'));
  assert(match, 'actual derivative formula required');
  const markup = match[0];
  const code = `(function(){
    var tex=String(org.jsoup.Jsoup.parseBodyFragment(${JSON.stringify(markup)}).select('tex-math').first().wholeText());
    var original=_ltOptions;
    var post=JSON.parse(original([tex]));
    var baseline=JSON.stringify(post).replace('"method":"post"','"method":"get"');
    var rejected=false,illegal=false;
    var marker=String.fromCharCode(0x4e0d,0x5141,0x8bb8,0x7684,0x5b57,0x7b26);
    try{var response=String(java.ajax(${JSON.stringify(HEALTH)}+','+baseline));
      rejected=response.indexOf(marker)>=0||/illegal character/i.test(response);illegal=rejected;
    }catch(error){rejected=true;illegal=String(error).indexOf(marker)>=0||/illegal character/i.test(String(error));}
    ${guard}
    var metrics;
    try{
      var safe=_ltOptions([tex]);
      var restored=JSON.parse(safe);
      var result=JSON.parse(String(java.ajax(${JSON.stringify(HEALTH)}+','+safe.replace('"method":"post"','"method":"get"'))));
      metrics={kind:'Android-parser-reconstructed-IEEE-9737357-formula',legacyRejected:rejected,
        legacyIllegalCharacter:illegal,guardAccepted:result.isSuccess===true&&typeof result.data==='boolean',
        exactTex:JSON.parse(restored.body)[0]===tex,
        exactHeaders:JSON.stringify(restored.headers)===JSON.stringify(post.headers),
        formulaLength:tex.length,fullIeeePipeline:false,translationService:false};
    }finally{_ltOptions=original;}
    java.log('UHV-FORMULA-PROBE '+JSON.stringify(metrics));
    var doc=org.jsoup.Jsoup.parseBodyFragment('<h1 class="notranslate">UHV-FORMULA-HEADING</h1><p class="notranslate" id="uhv-formula-result"></p><p class="notranslate" id="uhv-real-tex"></p><p class="notranslate">UHV-FORMULA-END</p>');
    doc.getElementById('uhv-formula-result').text('UHV-FORMULA-RESULT '+JSON.stringify(metrics));
    doc.getElementById('uhv-real-tex').text(tex);
    return String(doc.body().html());
  })()`;
  new vm.Script(code);
  const context = vm.createContext({});
  vm.runInContext(guard, context);
  return {key: '--' + HEALTH + ',' + context.useHtmlRuleJson({bodyJs: code, timeout: 10000}), markup};
}

async function run(label) {
  assert(label && /^[a-zA-Z0-9_-]+$/.test(label), 'explicit fresh evidence label required');
  const file = path.join(DIR, label + '.json');
  assert(!fs.existsSync(file), 'evidence already exists');
  const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8'));
  assert(process.env.LEGADO_PHONE && state.host === process.env.LEGADO_PHONE, 'matching explicit phone required');
  const book = state.books.find(b => b.kind === 'local' && b.status === 'created');
  assert(book, 'owned local test source required');
  const capture = JSON.parse(fs.readFileSync(path.join(DIR, 'ieee-rest-browser-first-v1.json'), 'utf8'));
  const {key} = build(capture);
  const result = await client.debug(book.book.origin, key, 45000);
  const summary = client.summarizeDebug(result, key);
  const match = result.messages.join('\n').match(/UHV-FORMULA-PROBE (\{[^\n]+\})/);
  const metrics = match ? JSON.parse(match[1]) : null;
  const passed = !summary.isError && metrics && ['legacyRejected', 'legacyIllegalCharacter', 'guardAccepted', 'exactTex', 'exactHeaders'].every(k => metrics[k] === true);
  fs.writeFileSync(file, JSON.stringify({observedAt: new Date().toISOString(), ...result, metrics, passed: !!passed}, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  return {label, ...summary, metrics, passed: !!passed};
}

module.exports = {build};
if (require.main === module) run(process.argv[2]).then(result => {
  console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1;
}).catch(error => {console.error(JSON.stringify(client.errorDetails(error))); process.exitCode = 1;});
