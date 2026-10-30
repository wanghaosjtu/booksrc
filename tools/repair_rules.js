#!/usr/bin/env node
/* Deterministic source-rule repairs for the current canonical export. */
'use strict';

const fs = require('node:fs');

const file = process.argv[2] || 'booksource/legado-book-sources-current.json';
const sources = JSON.parse(fs.readFileSync(file, 'utf8'));

function source(url) {
  const value = sources.find((item) => item.bookSourceUrl === url);
  if (!value) throw new Error(`source not found: ${url}`);
  return value;
}

/* The two Qishi annual pages contain a relative first link.  `page` is not
 * guaranteed to exist when the discovery entry is opened directly, and the
 * first Hongqi link is a “重点推荐” landing page rather than an article. */
{
  const s = source('http://www.qstheory.cn/');
  s.ruleExplore.bookList = `- div.booktitle a
<js>
var p=java.get("page");
page=parseInt(p,10)||1;
var ele=result[page-1]||result[0];
if(!ele){result="";}else{
  var yearurl=String(ele.attr("href")||"");
  if(yearurl.indexOf("http")!==0){
    var base=String(baseUrl||"http://www.qstheory.cn/");
    if(yearurl.indexOf("//")===0)yearurl="http:"+yearurl;
    else if(yearurl.charAt(0)==="/")yearurl=base.replace(/\\/$/,"")+yearurl;
    else{
      var slash=base.lastIndexOf("/");
      yearurl=base.substring(0,slash+1)+yearurl;
    }
  }
  java.ajax(yearurl);
}
</js>
p:has(strong)`;
  s.ruleBookInfo.intro = `@js:
var purl=String(baseUrl||book.bookUrl||""),d=org.jsoup.Jsoup.parse(String(result||"")),ls=d.select("p a[href]"),idx=1,u="";
if(ls.size()>idx)u=String(ls.get(idx).attr("href")||"");
if(u&&u.indexOf("http")!==0){
  var h=purl.indexOf("https://")===0?"https://www.qstheory.cn":"http://www.qstheory.cn";
  if(u.indexOf("//")===0)u=(purl.indexOf("https://")===0?"https:":"http:")+u;
  else if(u.charAt(0)==="/")u=h+u;
  else{var slash=h.lastIndexOf("/");u=h.substring(0,slash+1)+u;}
}
if(u){var x=org.jsoup.Jsoup.parse(String(java.ajax(u)||"")),c=x.select("#detailContent,#detail,.text").first();result=c?String(c.text()):"";}else result="";
result;`;
  s.ruleBookInfo.name = 'meta[name="description"]@content\n<js>\nvar t=String(result||"").split("-")[0].trim();result=t;\n</js>';
  s.ruleBookInfo.intro = 'meta[name="description"]@content';
  s.ruleBookInfo.author = 'meta[name="author"]@content||@js:"求是网"';
}
/* Science has fewer archive links than arbitrary page values supplied by
 * Legado's discovery pager.  Do not call attr() on an out-of-range element;
 * an unavailable archive page should simply produce an empty list. */
{
  const s = source('https://www.science.org/toc/science/current');
  const old = String(s.ruleExplore && s.ruleExplore.bookList || '');
  const unsafe = "ele = result[length-page]\njava.log(ele.attr('href'))\nyearurl=basehost + ele.attr('href')\njava.ajax(yearurl)";
  const fixed = "var scienceIndex=length-page\nif(scienceIndex<0||scienceIndex>=length){result=\"\";}else{\nvar ele=result[scienceIndex]\njava.log(ele.attr('href'))\nyearurl=basehost + ele.attr('href')\nresult=java.ajax(yearurl)\n}";
  if (old.indexOf(unsafe) >= 0) {
    s.ruleExplore.bookList = old.replace('page=java.get(\"page\") ', 'page=parseInt(java.get(\"page\"),10)||1;').replace(unsafe, fixed);
  } else if (old.indexOf('var scienceIndex=length-page') < 0) {
    throw new Error('Science explore boundary marker not found');
  }
}

/* DoD pages may mention Cloudflare in normal HTML after verification. Only
 * treat concrete challenge markers as a failed response. */
{
  const antiBotLoginCheck = String.raw`function antiBotBody(response) {
    try {
        if (response == null) return "";
        var body = response.body;
        if (body != null && typeof body !== "function") return String(body);
        if (typeof body === "function") return String(body.call(response));
    } catch (e) {}
    return typeof response === "string" ? String(response) : "";
}
function antiBotBlocked(body) {
    var text = String(body || "").toLowerCase();
    return text.indexOf("just a moment") >= 0 ||
        text.indexOf("performing security verification") >= 0 ||
        text.indexOf("challenge-platform") >= 0 ||
        text.indexOf("verify you are human") >= 0 ||
        text.indexOf("enable javascript and cookies to continue") >= 0 ||
        (text.indexOf("cf-chl-") >= 0 && text.indexOf("challenge") >= 0) ||
        (text.indexOf("access denied") >= 0 && (text.indexOf("ray id") >= 0 || text.indexOf("cloudflare") >= 0)) ||
        text.indexOf("errors.edgesuite.net") >= 0 ||
        (text.indexOf("akamai") >= 0 && text.indexOf("reference #") >= 0);
}
var antiBotResponse = result;
if (antiBotBlocked(antiBotBody(antiBotResponse))) {
    var antiBotUrl = "";
    try {
        var antiBotResponseUrl = antiBotResponse && antiBotResponse.url;
        if (typeof antiBotResponseUrl === "function") antiBotResponseUrl = antiBotResponseUrl.call(antiBotResponse);
        if (antiBotResponseUrl) antiBotUrl = String(antiBotResponseUrl);
    } catch (e) {}
    if (!antiBotUrl) try { antiBotUrl = String(java.url || baseUrl || ""); } catch (e) {}
    try { antiBotUrl = decodeURIComponent(antiBotUrl); } catch (e) {}
    if (!/^https?:\/\//i.test(antiBotUrl) || antiBotUrl.indexOf("{{") >= 0) throw "反爬验证地址无效";
    java.log("站点反爬拦截，打开原请求验证页: " + antiBotUrl);
    antiBotResponse = java.startBrowserAwait(antiBotUrl, "站点人工验证", false);
    if (antiBotBlocked(antiBotBody(antiBotResponse))) throw "人工验证未解除站点反爬拦截";
}
antiBotResponse;`;
  for (const url of ['https://www.defense.gov', 'https://www.defense.gov/News']) source(url).loginCheckJs = antiBotLoginCheck;
}

/* Sage's loginUrl is a script hook, not the unrelated “文献虫” URL. Keep the
 * existing loginUi/header (including the user's proxy choices) untouched. */
{
  const s = source('http://sage.cnpereading.com/');
  s.loginUrl = `function setTargetLang() {
    var choice = result && result["翻译语言"] ? String(result["翻译语言"]) : "简体中文";
    var targets = {"简体中文": "zh-Hans", "繁体中文": "zh-Hant", "文言文": "lzh"};
    java.put("TARGET_LANG", targets[choice] || "zh-Hans");
}

function login() {
    setTargetLang();
}
`;
}

/* IRIS: use ordinary HTTP first; only invoke WebView when Cloudflare actually
 * returns a challenge page, so normal requests avoid the slow browser path. */
{
  const s = source('https://www.iris-france.org/search/all/all/post/');
  s.loginCheckJs = String.raw`function irisBody(response){
  try {
    if (!response) return "";
    var body = response.body;
    if (body != null && typeof body !== "function") return String(body);
    if (typeof body === "function") return String(body.call(response));
  } catch (e) {}
  return String(response || "");
}
function irisChallenge(body){
  var t = String(body || "").toLowerCase();
  return t.indexOf("just a moment") >= 0 ||
    t.indexOf("enable javascript and cookies") >= 0 ||
    t.indexOf("verify you are human") >= 0 ||
    (t.indexOf("cf-chl-") >= 0 && t.indexOf("challenge") >= 0) ||
    (t.indexOf("access denied") >= 0 && t.indexOf("ray id") >= 0);
}
function irisUrl(response){
  try {
    var u = response && response.url;
    if (typeof u === "function") u = u.call(response);
    if (u) return String(u);
  } catch (e) {}
  return String(java.url || baseUrl || "");
}
var irisResponse = result;
if (irisChallenge(irisBody(irisResponse))) {
  var irisRequestUrl = irisUrl(irisResponse);
  if (!/^https?:\/\//i.test(irisRequestUrl)) throw "IRIS验证地址无效";
  var irisVerified = java.startBrowserAwait(irisRequestUrl, "IRIS Cloudflare验证", true);
  if (irisChallenge(irisBody(irisVerified))) throw "IRIS Cloudflare验证未解除";
  irisResponse = irisVerified;
}
irisResponse;`;
}
/* Annual Reviews is reachable from the phone through its plain-HTTP
 * endpoint. Keep the bookSourceUrl (the source identity) unchanged, but make
 * discovery, pagination, and article requests use the direct HTTP endpoint
 * the user selected. Links in the returned HTML are often absolute HTTPS
 * links, so normalize those before Legado opens the next request. */
{
  const s = source('https://www.annualreviews.org');
  const http = (value) => String(value || '').replace(/https:\/\/www\.annualreviews\.org/gi, 'http://www.annualreviews.org');
  const normalizeRule = `<js>\nvar annualUrl=Array.isArray(result)?(result[0]||\"\"):String(result||\"\");\nvar annualPrefix=\"https://www.annualreviews.org\";\nif(annualUrl.indexOf(annualPrefix)===0)annualUrl=\"http://www.annualreviews.org\"+annualUrl.substring(annualPrefix.length);\nresult=annualUrl;\nresult;\n</js>`;
  s.exploreUrl = http(s.exploreUrl);
  s.searchUrl = http(s.searchUrl);
  const cleanRule = (value) => {
    const text = String(value || '');
    const marker = '\n<js>\nvar annualUrl=';
    const at = text.indexOf(marker);
    return at >= 0 ? text.substring(0, at) : text;
  };
  s.ruleExplore.bookUrl = cleanRule(s.ruleExplore.bookUrl) + '\n' + normalizeRule;
  s.ruleToc.chapterUrl = cleanRule(s.ruleToc.chapterUrl) + '\n' + normalizeRule;
  s.ruleToc.nextTocUrl = cleanRule(s.ruleToc.nextTocUrl) + '\n' + normalizeRule;
}
/* Carnegie's HTTPS endpoint stalls on the phone while the same public pages
 * are served immediately over HTTP. The user explicitly approved this
 * transport downgrade for this source. Keep the source identity HTTPS, but
 * use the working direct endpoint for discovery, pagination, and chapter links. */
{
  const s = source('https://carnegie.ru/');
  const http = (value) => String(value || '').replace(/https:\/\/carnegie\.ru/gi, 'http://carnegie.ru');
  s.exploreUrl = http(s.exploreUrl);
  s.header = String(s.header || '').replace(/https:\/\/carnegie\.ru/gi, 'http://carnegie.ru');
  s.ruleToc.chapterUrl = http(s.ruleToc.chapterUrl).replace(/https:/g, 'http:');
  s.ruleToc.nextTocUrl = http(s.ruleToc.nextTocUrl).replace(/https:/g, 'http:');
}

/* IEEE directory pages only need article titles translated.  Abstracts remain
 * available as raw update metadata and are not sent through Edge. */
{
  const s = source('https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=');
  const content = String(s.ruleToc && s.ruleToc.chapterList || '');
  s.ruleToc.chapterList = content.replace('TJ(raw,java,cache,["articleTitle","abstract"])', 'TJ(raw,java,cache,["articleTitle"])');
}

{ const s=source('https://www.engineering.org.cn/'); const old=String(s.ruleContent&&s.ruleContent.content||''); const needle='d.select(".main_content_center_left_one_cankaowenxian,.ckankaowenfdifn,.main_content_center_left_yinyong,.main_content_center_right,.main_content_center_right_pdf").remove();'; const replacement='d.select(".main_content_top_div,.main_content_top_title,.main_content_top_btn,.Author_contribution,.Author_contribution_content,#correspAuthorsNoteTextCn,.main_content_center_left_one_title.yijibiaotidkk,.main_content_center_left_zhengwen_bao_denglu,.main_content_center_left_one_cankaowenxian,.ckankaowenfdifn,.main_content_center_left_yinyong,.main_content_center_right,.main_content_center_right_pdf").remove();'; if(old.indexOf(needle)>=0) s.ruleContent.content=old.replace(needle,replacement); else if(old.indexOf(replacement)<0) throw Error('marker'); }

/* Wiley: let the ordinary HTTP response reach loginCheckJs. A forced
 * webView on the issue URL can wait for the Cloudflare page for 60 seconds
 * before the source's existing manual-verification handler gets a chance to
 * run. */
for (const url of ['https://onlinelibrary.wiley.com/search', 'https://onlinelibrary.wiley.com/back']) {
  const s = source(url);
  s.exploreUrl = String(s.exploreUrl || '').replace(/,\{"webView":true\}/g, '');
  s.ruleExplore.bookUrl = String(s.ruleExplore && s.ruleExplore.bookUrl || '').replace('##$##,{"webView":true}', '');
  if (s.ruleSearch) s.ruleSearch.bookUrl = String(s.ruleSearch.bookUrl || '').replace('##$##,{"webView":true}', '').replace(',{"webView":true}', '');
  const directFetch = String.raw`<js>
var rawUrl=String(baseUrl||"");
var comma=rawUrl.indexOf(",{" );if(comma>=0)rawUrl=rawUrl.substring(0,comma);
var path=rawUrl.replace("https://onlinelibrary.wiley.com/","").replace("http://onlinelibrary.wiley.com/","");
var proxy="";try{proxy=String(source.getLoginInfoMap().get("proxyUrl")||"");}catch(e){}
if(proxy&&proxy.charAt(proxy.length-1)!=="/")proxy+="/";
var requestUrl=proxy?proxy+path:"http://onlinelibrary.wiley.com/"+path;
try{var response=java.ajax(requestUrl);if(response)result=response;}catch(e){java.log("Wiley HTTP refetch failed: "+e);}
result;
</js>`;
  const marker = 'div.article__body@html';
  const markerAt = String(s.ruleContent && s.ruleContent.content || '').indexOf(marker);
  if (markerAt >= 0) s.ruleContent.content = directFetch + String(s.ruleContent.content).substring(markerAt);
}

/* Wiley changed its issue pages from the old item__body markup to a journal
 * issue list.  The annual page only contains issue links; each issue page
 * contains article DOI links under .issue-item.  Build one small JSON list so
 * the normal chapter rules do not need to parse several nested pages. */
const wileyChapterList = `<js>
var raw = String(result || "");
var root = org.jsoup.Jsoup.parse(raw);
var base = "https://onlinelibrary.wiley.com";
function absolute(href) {
  var u = String(href || "").trim();
  if (!u) return "";
  if (/^https?:\\/\\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return base + (u.charAt(0) === "/" ? u : "/" + u);
}
function responseBody(response) {
  try {
    if (!response) return "";
    var body = response.body;
    if (body != null && typeof body !== "function") return String(body);
    if (typeof body === "function") return String(body.call(response));
  } catch (e) {}
  return String(response || "");
}
var issueLinks = [], issueAnchors = root.select("ul.rlist.loi__issues h4.parent-item a");
for (var i = 0; i < issueAnchors.size(); i++) {
  var issueUrl = absolute(issueAnchors.get(i).attr("href"));
  if (issueUrl && issueLinks.indexOf(issueUrl) < 0) issueLinks.push(issueUrl);
}
var rows = [], seen = {};
var freeWords = ["开放获取", "open access", "社论", "editorial", "出版商更正", "correction", "免费使用"];
var issueDocs = [];
if (root.select("a[href*='/doi/']").size() > 0) issueDocs.push(root);
for (var il = 0; il < issueLinks.length; il++) issueDocs.push(org.jsoup.Jsoup.parse(responseBody(java.ajax(issueLinks[il]))));
for (var ii = 0; ii < issueDocs.length; ii++) {
  var issueDoc = issueDocs[ii];
  var articleLinks = issueDoc.select("a[href*='/doi/']");
  for (var ai = 0; ai < articleLinks.size(); ai++) {
    var anchor = articleLinks.get(ai), item = anchor.parent ? anchor.parent() : null;
    if (!item || !(item.hasClass && item.hasClass("issue-item"))) continue;
    var url = absolute(anchor.attr("href")), title = String(anchor.text() || "").replace(/\s+/g, " ").trim();
    if (!url || !title || title.toLowerCase() === "issue information" || seen[url]) continue;
    seen[url] = true;
    var itemText = String(item.text() || "").toLowerCase(), isFree = false;
    for (var wi = 0; wi < freeWords.length; wi++) if (itemText.indexOf(freeWords[wi].toLowerCase()) >= 0) { isFree = true; break; }
    rows.push({title: title, url: url, vip: !isFree});
  }
}
var json = JSON.stringify(rows);
result = TJ(json, java, cache, ["title"]);
result;
</js>$[*]`;
for (const url of ['https://onlinelibrary.wiley.com/search', 'https://onlinelibrary.wiley.com/back']) {
  const s = source(url);
  s.ruleToc.chapterList = wileyChapterList;
  s.ruleToc.chapterName = '$.title';
  s.ruleToc.chapterUrl = '$.url';
  s.ruleToc.isVip = '$.vip';
  s.ruleToc.nextTocUrl = '';
}
/* Inc.com is maintained directly in the canonical source.  Do not replace its
 * user-reviewed category, directory, or article rules here. */
fs.writeFileSync(file, JSON.stringify(sources, null, 2) + '\n');
console.log(`repaired ${file}`);
