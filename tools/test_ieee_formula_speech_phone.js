#!/usr/bin/env node
/* Real Jsoup + IEEE/Codecogs regression. Never saves or deploys any source. */
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const client = require('./phone_source_client');
const SOURCE_URL = 'https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=';

// This function is serialized and evaluated by the phone's ES5/Rhino engine.
function regression(nativeJava, nativeCache, useSavedCache) {
  function check(ok, message) { if (!ok) throw new Error(message); }
  function memoryCache() {
    var values = {}, puts = [];
    return {puts: puts, get: function(key) { return values["$" + key]; },
      put: function(key, value, seconds) { values["$" + key] = value; puts.push({key:key, seconds:seconds}); }};
  }
  function speechOnlyCache() {
    var local = memoryCache();
    // The test echoes translation responses. Never cache those echoes in
    // the reader's real translation cache, even when testing a saved source.
    return {
      get: function(key) { return key.indexOf('codecogs_speech:v2:') === 0 ? nativeCache.get(key) : local.get(key); },
      put: function(key, value, seconds) {
        if (key.indexOf('codecogs_speech:v2:') === 0) nativeCache.put(key, value, seconds);
        else local.put(key, value, seconds);
      }};
  }
  var selector = 'disp-formula, inline-formula, .InlineEquation, .Equation, math';
  var options = {formula_mode:'codecogs', formula_speech:true, formula_selector:selector,
    remove_selector:[], extract_selector:[]};
  function router(live, failed) {
    var j = {speechRequests:0, waves:[], translated:[], successes:0,
      get: function() { return 'zh-Hans'; },
      ajax: function() { throw new Error('unexpected serial request'); },
      ajaxAll: function(urls, webView) {
        check(webView === false, 'must not use WebView');
        if (String(urls[0]).indexOf('https://latex.codecogs.com/mathml.latex?') === 0) {
          check(urls.length <= 4, 'too many concurrent speech requests');
          j.speechRequests += urls.length; j.waves.push(urls.length);
          if (failed) return urls.map(function() { return 'bad reply'; });
          if (live) {
            var responses = nativeJava.ajaxAll(urls, false);
            for (var r = 0; r < responses.length; r++) if (_ltCodecogsSpeechText(responses[r])) j.successes++;
            return responses;
          }
          return urls.map(function(url) {
            var tex = decodeURIComponent(String(url).split('?')[1]);
            return {body:'<math><mi>x</mi></math><span class="cc-speech"> speech: ' + tex + ' </span>'};
          });
        }
        // Echo translation responses to inspect exclusions without touching
        // the real translation cache or depending on another network service.
        return urls.map(function(url) {
          var opt = JSON.parse(String(url).substring(String(url).indexOf(',') + 1));
          var text = JSON.parse(opt.body)[0]; j.translated.push(text);
          return JSON.stringify([{translations:[{text:text}]}]);
        });
      }};
    return j;
  }
  function inspect(html, expected) {
    var doc = org.jsoup.Jsoup.parse(String(html));
    var imgs = doc.select('img[src^="https://latex.codecogs.com/svg.latex?"]');
    check(imgs.size() === expected, 'formula image count: ' + imgs.size() + ', expected ' + expected);
    check(doc.select('span.formula-speech.notranslate').size() === expected, 'speech label count');
    for (var i = 0; i < imgs.size(); i++) {
      var img = imgs.get(i), alt = String(img.attr('alt')), next = img.nextElementSibling();
      check(alt === _ltFormulaTex(alt), 'outer delimiters remain in alt: ' + alt);
      check(decodeURIComponent(String(img.attr('src')).split('?')[1]) === alt, 'SVG TeX differs from alt');
      check(next && next.hasClass('formula-speech') && next.hasClass('notranslate') &&
        String(next.text()).trim(), 'missing adjacent readable speech');
    }
    return doc;
  }
  check(String(LEGADO_TRANSLATION_RUNTIME) === '3', 'wrong runtime version');
  var fixture = '<p id="prose">Costs $10 and $20. Before <inline-formula><tex-math>$x$</tex-math></inline-formula> after.</p>' +
    '<p><inline-formula><tex-math>$x$</tex-math></inline-formula></p>' +
    '<div class="InlineEquation" data-original-tex=" $$\\tau _{1}$$ " data-semantic-speech="tau semantic"><span class="mi">tau fallback</span></div>' +
    '<disp-formula><tex-math>\\[a+b\\]</tex-math></disp-formula>' +
    '<div class="Equation"><math alttext="\\(z\\)"><mi>z</mi></math></div>' +
    '<div class="Equation" data-tex="$q$"><math alttext="$q$"><mi>q</mi></math></div>' +
    '<inline-formula><tex-math>$$ $$</tex-math></inline-formula>';
  var j = router(false, false), c = memoryCache(), first = TH(fixture, j, c, options);
  var fixtureDoc = inspect(first, 6);
  check(j.speechRequests === 5 && j.waves.join(',') === '4,1', 'duplicate/nested formulas not deduplicated');
  check(String(fixtureDoc.select('#prose').text()).indexOf('Costs $10 and $20.') >= 0, 'prose currency changed');
  check(j.translated.join('\n').indexOf('speech:') < 0, 'speech entered translation');
  check(c.puts.filter(function(p) { return p.key.indexOf('codecogs_speech:') === 0; })
    .every(function(p) { return p.seconds === 2592000; }), 'speech cache TTL');
  inspect(TH(fixture, j, c, options), 6);
  inspect(TH(first, j, c, options), 6);
  check(j.speechRequests === 5, 'warm/idempotent fixture requested speech again');

  var failed = router(false, true), failedCache = memoryCache();
  var fallback = inspect(TH(fixture, failed, failedCache, options), 6);
  check(String(fallback.select('span.formula-speech').text()).indexOf('tau semantic') >= 0, 'semantic fallback missing');
  check(failedCache.puts.filter(function(p) { return p.key.indexOf('codecogs_speech:') === 0; }).length === 0,
    'failed speech cached');
  inspect(TH(fixture, failed, failedCache, options), 6);
  check(failed.speechRequests === 10, 'failed speech poisoned retry cache');
  var legacy = org.jsoup.Jsoup.parse(TH('<inline-formula><tex-math>$x$</tex-math></inline-formula>', j, c,
    {formula_mode:'codecogs', formula_selector:selector, remove_selector:[], extract_selector:[]}));
  check(String(legacy.select('img').attr('alt')) === '$x$' && !legacy.select('.formula-speech').size(),
    'default Codecogs behavior changed');
  var wirisJava = router(false, false);
  wirisJava.ajax = function() { return '<svg><text>x</text></svg>'; };
  wirisJava.base64Encode = function() { return 'PHN2Zz48L3N2Zz4='; };
  var wiris = org.jsoup.Jsoup.parse(TH('<math data-semantic-speech="x plus 1"><mi>x</mi></math>',
    wirisJava, memoryCache(), {formula_mode:'wiris', formula_selector:'math', remove_selector:[], extract_selector:[]}));
  check(wiris.select('img').size() === 1 && String(wiris.select('.formula-speech.notranslate').text()) === 'x plus 1',
    'WIRIS behavior changed');

  var article = 'https://ieeexplore.ieee.org/document/11753535/';
  var raw = String(nativeJava.connect('https://ieeexplore.ieee.org/rest/document/11753535/?logAccess=true',
    JSON.stringify({Referer:article}), 15000).body());
  var input = org.jsoup.Jsoup.parse(raw);
  check(input.select(selector).size() === 138, 'unexpected target article or blocked REST response');
  var live = router(true, false), articleCache = useSavedCache ? speechOnlyCache() : memoryCache(), start = Date.now();
  var cold = TH(raw, live, articleCache, options);
  inspect(cold, 138);
  var coldMs = Date.now() - start, coldRequests = live.speechRequests, successes = live.successes;
  start = Date.now();
  inspect(TH(raw, live, articleCache, options), 138);
  var warmMs = Date.now() - start, warmRequests = live.speechRequests - coldRequests;
  // Only successful speech is cached; failures may be retried on a fresh read.
  check(warmRequests === coldRequests - successes, 'warm cache lookup count');
  check(live.translated.join('\n').indexOf('speech:') < 0, 'fixture speech translated');
  return JSON.stringify({runtime:String(LEGADO_TRANSLATION_RUNTIME), fixture:'PASS', fallback:'PASS',
    defaultCodecogs:'PASS', wiris:'PASS', article:'11753535', inline:input.select('inline-formula').size(),
    display:input.select('disp-formula').size(), images:138, labels:138, coldRequests:coldRequests,
    successfulSpeech:successes, warmRequests:warmRequests, coldMs:coldMs, warmMs:warmMs});
}

(async () => {
  const saved = process.argv.includes('--saved');
  const runtime = saved ? '' : fs.readFileSync('booksource/runtime/legado-translation-runtime.js', 'utf8');
  const js = '(function(nativeJava,nativeCache){\n' + runtime + '\nreturn (' + regression.toString() +
    ')(nativeJava,nativeCache,' + saved + ');\n})(java,cache);';
  const reply = await client.mcp('eval_js', {js, url:SOURCE_URL, timeoutSec:240}, 255000);
  const text = client.resultText(reply);
  console.log(text);
  assert(!reply.isError, 'phone formula speech regression failed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
