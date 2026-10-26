#!/usr/bin/env node
/* Generate canonical native-RSS sources from the live backup without mutating the phone. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'rsssource/legado-rss-sources-current.json');
const RUNTIME = path.join(ROOT, 'rsssource/runtime/legado-rss-translation-runtime.js');
const REPORT = path.join(ROOT, 'rsssource/reports/rss-migration.json');
const RUNTIME_MARKER = 'legado-rss-translation-runtime v1';
const LEGACY_TRANSLATION = /edge\.microsoft\.com|translatetext|api-edge\.cognitive\.microsofttranslator|Microsoft\.Translator|getAUTHkey\s*\(|trans_title\s*\(/i;

const LOGIN_UI = JSON.stringify([
  {name: '翻译语言', type: 'select', chars: ['简体中文', '繁体中文', '文言文'], default: '简体中文', action: 'setTargetLang()'},
  {name: 'proxyUrl', type: 'select', chars: ['', 'http://dept-haow:9090', 'http://secure-proxy4.qualcomm.com:9090'], default: ''},
  {name: '打开源站', type: 'button', action: 'java.startBrowser(source.sourceUrl, source.sourceName)'},
], null, 2);

const LOGIN_JS = String.raw`@js:
function setTargetLang() {
  var choice = '简体中文';
  try {
    if (typeof result !== 'undefined' && result && result['翻译语言']) choice = String(result['翻译语言']);
  } catch (e) {}
  var targets = {'简体中文': 'zh-Hans', '繁体中文': 'zh-Hant', '文言文': 'lzh'};
  java.put('TARGET_LANG', targets[choice] || 'zh-Hans');
}
function login() { setTargetLang(); }
`;

const DYNAMIC_HEADER = String.raw`@js:
var info = null, proxyUrl = '';
try { info = source.getLoginInfoMap(); } catch (e) {}
try { if (info && info.get('proxyUrl')) proxyUrl = String(info.get('proxyUrl')); } catch (e) {}
JSON.stringify({
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': String(source.sourceUrl || ''),
  'proxy': proxyUrl
})
`;

const LOGIN_CHECK = String.raw`function _rssBody(response) {
  try {
    if (response == null) return '';
    var body = response.body;
    if (body != null && typeof body !== 'function') return String(body);
    if (typeof body === 'function') return String(body.call(response));
  } catch (e) {}
  return typeof response === 'string' ? String(response) : '';
}
function _rssChallenge(body) {
  var text = String(body || '').toLowerCase();
  return text.indexOf('just a moment') >= 0 ||
    text.indexOf('performing security verification') >= 0 ||
    text.indexOf('verify you are human') >= 0 ||
    text.indexOf('enable javascript and cookies') >= 0 ||
    (text.indexOf('cf-chl-') >= 0 && (text.indexOf('challenge') >= 0 || text.indexOf('verify') >= 0)) ||
    (text.indexOf('access denied') >= 0 && (text.indexOf('ray id') >= 0 || text.indexOf('cloudflare') >= 0)) ||
    text.indexOf('forbidden') >= 0 || text.indexOf('访问被拒') >= 0 ||
    text.indexOf('拒绝访问') >= 0 || text.indexOf('禁止访问') >= 0 ||
    text.indexOf('errors.edgesuite.net') >= 0 || text.indexOf('reference #') >= 0 ||
    text.indexOf('waf_verification') >= 0 || text.indexOf('__waf_verification') >= 0 ||
    text.indexOf('正在进行安全检测') >= 0 || text.indexOf('系统正在检测') >= 0 ||
    // Some RSS sources return a member/login page instead of a challenge.
    // Treat only explicit access-denied/login phrases as a browser hand-off;
    // a normal article containing the word “登录” must not be interrupted.
    text.indexOf('您没有登录或者您没有权限访问此页面') >= 0 ||
    text.indexOf('您还不是站点会员') >= 0 ||
    text.indexOf('please log in to continue') >= 0 ||
    text.indexOf('please enable javascript') >= 0 ||
    text.indexOf('client challenge') >= 0 ||
    // DataDome/Inc.com challenge pages return a tiny JS bootstrap instead of
    // the usual Cloudflare title.  ScienceDirect's IP block page embeds a
    // stable Cloudflare error marker in an otherwise large HTML response.
    text.indexOf('please enable js and disable any ad blocker') >= 0 ||
    text.indexOf('captcha-delivery.com') >= 0 ||
    text.indexOf('cloudflare_error_') >= 0 ||
    (text.indexOf('there was a problem providing the content') >= 0 &&
      (text.indexOf('ip blocked') >= 0 || text.indexOf('cloudflare') >= 0)) ||
    text.indexOf('_fs-ch-') >= 0 ||
    // PhpWind/other forum login pages can be returned in GBK, so their
    // Chinese text is unreliable; stable form-field names are not.
    (text.indexOf('name="pwuser"') >= 0 &&
      (text.indexOf('name="pwpwd"') >= 0 || text.indexOf('name="password"') >= 0)) ||
    (text.indexOf('login.php') >= 0 && text.indexOf('name="password"') >= 0) ||
    (text.indexOf('challenge-platform') >= 0 && (text.indexOf('_cf_chl_opt') >= 0 || text.indexOf('challenge-error-text') >= 0)) ||
    (text.indexOf('challenge') >= 0 && (text.indexOf('captcha') >= 0 || text.indexOf('human verification') >= 0 || text.indexOf('security verification') >= 0));
}
var _rssResponse = result;
if (_rssChallenge(_rssBody(_rssResponse))) {
  var _rssUrl = '';
  try {
    var _responseUrl = _rssResponse && _rssResponse.url;
    if (typeof _responseUrl === 'function') _responseUrl = _responseUrl.call(_rssResponse);
    if (_responseUrl) _rssUrl = String(_responseUrl);
  } catch (e) {}
  if (!_rssUrl) try { _rssUrl = String(java.url || baseUrl || source.sourceUrl || ''); } catch (e) {}
  try { _rssUrl = decodeURIComponent(_rssUrl); } catch (e) {}
  if (!/^https?:\/\//i.test(_rssUrl) || _rssUrl.indexOf('{{') >= 0) throw 'Cloudflare验证地址无效';
  _rssResponse = java.startBrowserAwait(_rssUrl, 'Cloudflare人工验证', true);
  if (_rssChallenge(_rssBody(_rssResponse))) throw 'Cloudflare验证未解除拦截';
}
_rssResponse;
`;

function hasLegacyTranslation(source) {
  // The canonical runtime itself calls the Microsoft endpoint.  Do not
  // mistake that implementation for a legacy per-source translator when
  // this migration is run a second time.
  if (String(source.jsLib || '').includes('LEGADO_RSS_TRANSLATION_RUNTIME') ||
      String(source.jsLib || '').includes('LEGADO_TRANSLATION_RUNTIME')) return false;
  return LEGACY_TRANSLATION.test(JSON.stringify(source));
}

function isXmlSource(source) {
  const text = [source.sourceUrl, source.sortUrl, source.ruleArticles].join(' ');
  return /(?:\.xml\b|\.rss\b|\/rss\/|\/feed\b|rss\.ashx|atom)/i.test(text);
}

function arrayLiterals(text, variable) {
  const values = [];
  const expression = new RegExp('(?:var\\s+)?' + variable + '\\s*=\\s*\\[([\\s\\S]*?)\\]', 'g');
  let match;
  while ((match = expression.exec(String(text || ''))) !== null) {
    const quoted = /(['"])((?:\\.|[^\\])*)\1/g;
    let item;
    while ((item = quoted.exec(match[1])) !== null) {
      const value = item[2].replace(/\\(['"\\])/g, '$1').trim();
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

function cleanLegacyRule(value) {
  let text = String(value || '');
  text = text.replace(/<js>[\s\S]*?<\/js>/gi, (block) => LEGACY_TRANSLATION.test(block) ? '' : block);
  const at = text.search(/@js:/i);
  if (at >= 0 && LEGACY_TRANSLATION.test(text.slice(at))) text = text.slice(0, at);
  return text.replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
}

function translatedArticles(source, selector, removeSelectors) {
  const xml = isXmlSource(source);
  const fallback = xml ? '//item||//entry' : 'article||main article||li';
  const transform = xml
    ? "result=TX(result,java,cache,{fields:['title','subtitle']});"
    : 'result=TH(result,java,cache,{remove_selector:' + JSON.stringify(removeSelectors) + ',extract_selector:[],formula_mode:"none",formula_selector:""});';
  return '<js>\n' + transform + '\nresult;\n</js>\n' + (selector || fallback);
}

function translatedContent(selector, removeSelectors) {
  const base = selector || '@css:body@html';
  return base + '\n<js>\nresult=TH(result,java,cache,{remove_selector:' + JSON.stringify(removeSelectors) + ',extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>';
}

function migrateTranslation(source, runtime) {
  const before = JSON.stringify(source);
  const articleRule = String(source.ruleArticles || '');
  const contentRule = String(source.ruleContent || '');
  const removeSelectors = ['script', 'noscript', 'style', 'nav', 'aside', 'footer', 'form'];
  source.jsLib = runtime;
  source.injectJs = '';
  source.ruleArticles = translatedArticles(source, cleanLegacyRule(articleRule), removeSelectors);
  source.ruleTitle = cleanLegacyRule(source.ruleTitle);
  source.ruleDescription = cleanLegacyRule(source.ruleDescription);
  source.ruleLink = cleanLegacyRule(source.ruleLink);
  source.ruleContent = translatedContent(cleanLegacyRule(contentRule), removeSelectors);
  return JSON.stringify(source) !== before;
}

function applySiteFixes(source, runtime) {
  /* 36kr: the canonical feed is served from www.36kr.com and is genuine
   * RSS/XML.  The bare host currently returns a 火山引擎 interstitial, while
   * the www host returns item/title/link/pubDate/description XML.  Keep the
   * source identity unchanged, but use the working feed URL and consume the
   * description as the article body so article links do not trigger a second
   * anti-bot request.  This source does not need a Cloudflare browser handoff.
   */
  if (source.sourceName === '36kr') {
    source.sortUrl = String(source.sortUrl || '')
      .replace('36氪::https://36kr.com/feed', '36氪::https://www.36kr.com/feed');
    source.jsLib = runtime;
    source.injectJs = '';
    source.loginCheckJs = String.raw`// 36KR_RSS_XML_NO_WAF
var _rssResponse = result;
_rssResponse;
`;
    source.ruleArticles = String.raw`<js>
result=TX(result,java,cache,{fields:['title']});
result;
</js>
//item`;
    source.ruleTitle = 'title@text';
    source.rulePubDate = 'pubDate@text';
    source.ruleDescription = String.raw`description@html
<js>
result=TH(result,java,cache,{remove_selector:["script","style"],extract_selector:[],formula_mode:"none",formula_selector:""});
result;
</js>`;
    source.ruleImage = 'description img@src';
    source.ruleLink = 'link@text';
    source.ruleNextPage = '';
    source.ruleContent = String.raw`@css:body@html
<js>
result=TH(result,java,cache,{remove_selector:["script","noscript","style","nav","aside","footer","form"],extract_selector:[],formula_mode:"none",formula_selector:""});
result;
</js>`;
  }
  if (source.sourceName === 'Wi-Fi Alliance') {
    source.ruleArticles = '<js>\nresult=TC(result,java,cache);\nresult;\n</js>\ndiv#view-output div.card';
    source.ruleTitle = 'h5@text';
    source.ruleLink = 'a[rel="bookmark"]@href';
    source.ruleNextPage = 'nav.pager a[rel="next"]@href';
    source.ruleContent = 'main@html\n<js>\nresult=TH(result,java,cache,{remove_selector:["script","style","nav","aside","footer"],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>';
  }
  if (source.sourceName === '天天基金') {
    source.ruleArticles = 'div.content li';
    source.ruleTitle = 'a@text';
    source.rulePubDate = 'span@text';
    source.ruleLink = 'a@href';
    source.ruleNextPage = 'div.PageBox a.f12@href||div.PageBox a:last-child@href';
  }
  if (source.sourceName === '天天基金') {
    source.header = String(source.header || '').replace('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36');
  }
  if (source.sourceName === 'DoD' || source.sourceName === 'DoD - China') {
    source.sortUrl = String(source.sortUrl || '').replace(/https:\/\/www\.defense\.gov\//g, 'https://www.war.gov/');
    if (source.sourceName === 'DoD') {
      var dodLines = source.sortUrl.split('\n').filter(function(line) { return line; });
      var dodNews = dodLines.filter(function(line) { return /^News::/.test(line); });
      source.sortUrl = dodNews.concat(dodLines.filter(function(line) { return !/^News::/.test(line); })).join('\n');
    }
  }
  if (source.sourceName === 'russtrat.ru') {
    source.ruleArticles = "<js>\nresult=TH(result,java,cache,{remove_selector:[\"script\",\"noscript\",\"style\",\"nav\",\"aside\",\"footer\"],extract_selector:[],formula_mode:\"none\",formula_selector:\"\"});\nresult;\n</js>\n//div[@class=\"view-content\"]/div";
    source.ruleTitle = '//h6/text()';
    source.ruleLink = '//a/@href';
    source.rulePubDate = '//span[contains(@class,"row-pub-date")]/text()';
    source.ruleNextPage = '//li[@class="pager-next"]/a/@href';
  }
  if (source.sourceName === 'Carnegie Publications') {
    const carnegieRequest = (page) => `<js>
var carnegieInfo=null,carnegieKey="";
try{carnegieInfo=source.getLoginInfoMap();}catch(e){}
try{if(carnegieInfo&&carnegieInfo.get("typesenseApiKey"))carnegieKey=String(carnegieInfo.get("typesenseApiKey"));}catch(e){}
if(!carnegieKey)try{carnegieKey=String(java.get("TYPESENSE_API_KEY")||"");}catch(e){}
if(!carnegieKey)throw "请在登录设置中填写 Carnegie Typesense API Key";
var q={searches:[{query_by:'*',sort_by:'_text_match:desc,contentSummary.publishedAt:desc',highlight_full_fields:'*',collection:'content_en',q:'*',facet_by:'expertsByCenter.global,regions.title,topics.title,year',max_facet_values:500,page:${page},per_page:25}]};
result='https://search.carnegieendowment.org/multi_search?x-typesense-api-key='+encodeURIComponent(carnegieKey)+','+JSON.stringify({headers:{'accept':'application/json, text/plain, */*','accept-language':'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7','content-type':'text/plain','Referer':'https://carnegieendowment.org/'},body:JSON.stringify(q),method:'POST'});
result;
</js>`;
    const carnegieSort = (category) => `${category}::@js:(function(){var carnegieInfo=null,carnegieKey="";try{carnegieInfo=source.getLoginInfoMap();}catch(e){}try{if(carnegieInfo&&carnegieInfo.get("typesenseApiKey"))carnegieKey=String(carnegieInfo.get("typesenseApiKey"));}catch(e){}if(!carnegieKey)try{carnegieKey=String(java.get("TYPESENSE_API_KEY")||"");}catch(e){}if(!carnegieKey)throw "请在登录设置中填写 Carnegie Typesense API Key";var q={searches:[{query_by:'*',sort_by:'_text_match:desc,contentSummary.publishedAt:desc',highlight_full_fields:'*',collection:'content_en',q:'*',facet_by:'expertsByCenter.global,regions.title,topics.title,year',max_facet_values:500,page:1,per_page:25}]};return 'https://search.carnegieendowment.org/multi_search?x-typesense-api-key='+encodeURIComponent(carnegieKey)+','+JSON.stringify({headers:{'accept':'application/json, text/plain, */*','accept-language':'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7','content-type':'text/plain','Referer':'https://carnegieendowment.org/'},body:JSON.stringify(q),method:'POST'});})()`;
    source.ruleNextPage = carnegieRequest(2);
    source.sortUrl = `${carnegieSort('All')}\n${carnegieSort('Policies')}`;
    const carnegieUi = JSON.parse(String(source.loginUi || '[]'));
    if (!carnegieUi.some((item) => item.name === 'typesenseApiKey')) {
      carnegieUi.splice(1, 0, {name: 'typesenseApiKey', type: 'text'});
      source.loginUi = JSON.stringify(carnegieUi, null, 2);
    }
  }
}

function configureLogin(source) {
  if (source.singleUrl || /^test$/i.test(String(source.sourceName || ''))) return false;
  const before = JSON.stringify({
    loginUrl: source.loginUrl, loginUi: source.loginUi, loginCheckJs: source.loginCheckJs,
    header: source.header, enabledCookieJar: source.enabledCookieJar,
  });
  source.loginUrl = LOGIN_JS;
  source.loginUi = LOGIN_UI;
  source.loginCheckJs = LOGIN_CHECK;
  source.header = DYNAMIC_HEADER;
  // Preserve the phone's existing CookieJar switch; login UI/header changes
  // must not silently alter unrelated source state.
  return JSON.stringify({
    loginUrl: source.loginUrl, loginUi: source.loginUi, loginCheckJs: source.loginCheckJs,
    header: source.header, enabledCookieJar: source.enabledCookieJar,
  }) !== before;
}

function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const runtime = fs.readFileSync(RUNTIME, 'utf8').trim();
  if (!runtime.includes(RUNTIME_MARKER) || !runtime.includes('function TX')) {
    throw new Error('RSS translation runtime is missing TX or its version marker');
  }
  const changed = [];
  const translated = [];
  for (const source of sources) {
    const record = {name: source.sourceName, url: source.sourceUrl, translation: false, login: false};
    if (hasLegacyTranslation(source)) {
      record.translation = migrateTranslation(source, runtime);
      translated.push(record.name);
    }
    record.login = configureLogin(source);
    applySiteFixes(source, runtime);
    if (source.sourceName === '36kr') {
      record.translation = true;
      if (!translated.includes(record.name)) translated.push(record.name);
    }
    if (record.translation || record.login) changed.push(record);
  }
  fs.writeFileSync(SOURCE, JSON.stringify(sources, null, 2) + '\n');
  fs.mkdirSync(path.dirname(REPORT), {recursive: true});
  fs.writeFileSync(REPORT, JSON.stringify({
    generatedAt: new Date().toISOString(), total: sources.length, translated, changed,
  }, null, 2) + '\n');
  console.log(JSON.stringify({total: sources.length, translated: translated.length, changed: changed.length}));
}

main();
