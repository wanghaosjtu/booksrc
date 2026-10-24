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
  if (!/^https?:\\/\\//i.test(irisRequestUrl)) throw "IRIS验证地址无效";
  var irisVerified = java.startBrowserAwait(irisRequestUrl, "IRIS Cloudflare验证", true);
  if (irisChallenge(irisBody(irisVerified))) throw "IRIS Cloudflare验证未解除";
  irisResponse = irisVerified;
}
irisResponse;`;
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
/* Inc.com: the category pages are DataDome-protected, while the public RSS
 * feed remains available. Use it for discovery so the source still produces
 * chapters when a category WebView cannot pass the challenge. */
const incRssExplore = `<js>
function responseBody(response) {
  try {
    if (!response) return "";
    var body = response.body;
    if (body != null && typeof body !== "function") return String(body);
    if (typeof body === "function") return String(body.call(response));
  } catch (e) {}
  return String(response || "");
}
var feed = org.jsoup.Jsoup.parse(responseBody(java.ajax("https://www.inc.com/rss")), "", org.jsoup.parser.Parser.xmlParser());
var rows = [];
feed.select("item").forEach(function(item) {
  var link = item.select("link").first(), title = item.select("title").text().trim();
  var url = link ? String(link.text() || link.html() || "").trim() : "";
  var description = item.select("description").text().trim();
  var enclosure = item.select("enclosure").first(), cover = enclosure ? String(enclosure.attr("url") || "").trim() : "";
  if (cover && cover.indexOf("/f_webp") >= 0) cover = cover.replace("/f_webp", "/f_jpg"); else if (cover && cover.toLowerCase().indexOf(".webp") >= 0 && cover.indexOf("/f_jpg/") < 0) cover = cover.replace("/image/upload/", "/image/upload/f_jpg/");
  if (url && title) rows.push({title: title, url: url, description: description, cover: cover});
});
JSON.stringify(rows);
</js>$[*]`;
{
  const s = source('https://www.inc.com/');
  s.ruleExplore.bookList = incRssExplore;
  s.ruleExplore.bookUrl = '$.url';
  s.ruleExplore.name = '$.title';
  s.ruleExplore.intro = '$.description';
  s.ruleExplore.coverUrl = '$.cover';
}
const incRssToc = `<js>
function responseBody(response) {
  try {
    if (!response) return "";
    var body = response.body;
    if (body != null && typeof body !== "function") return String(body);
    if (typeof body === "function") return String(body.call(response));
  } catch (e) {}
  return String(response || "");
}
var target = String(baseUrl || ""), comma = target.indexOf(",{");
if (comma >= 0) target = target.substring(0, comma);
function sameUrl(a, b) {
  a = String(a || ""); b = String(b || "");
  while (a.length && a.charAt(a.length - 1) === "/") a = a.substring(0, a.length - 1);
  while (b.length && b.charAt(b.length - 1) === "/") b = b.substring(0, b.length - 1);
  return a === b;
}
var feed = org.jsoup.Jsoup.parse(responseBody(java.ajax("https://www.inc.com/rss")), "", org.jsoup.parser.Parser.xmlParser());
var rows = [];
feed.select("item").forEach(function(item) {
  var link = item.select("link").first(), url = link ? String(link.text() || link.html() || "").trim() : "";
  var title = item.select("title").text().trim();
  if (url && title && sameUrl(url, target)) rows.push({title: title, url: url});
});
result = TJ(JSON.stringify(rows), java, cache, ["title"]);
result;
</js>$[*]`;
{
  const s = source('https://www.inc.com/');
  s.ruleToc.chapterList = incRssToc;
  s.ruleToc.chapterName = '$.title';
  s.ruleToc.chapterUrl = '$.url';
  s.ruleToc.nextTocUrl = '';
}
{
  const s = source('https://www.inc.com/');
  const content = String(s.ruleContent && s.ruleContent.content || '');
  const replacement = String.raw`function incJpg(value) {
  var text = String(value || '');
  if (text.toLowerCase().indexOf('img-cdn.inc.com/image/upload/') < 0) return text;
  return text.replace('f_webp', 'f_jpg').replace('.webp', '.jpg');
}
var imageAttrs = ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset', 'srcset'];
for (var imageIndex = 0; imageIndex < imgs.size(); imageIndex++) {
  var image = imgs.get(imageIndex);
  for (var attrIndex = 0; attrIndex < imageAttrs.length; attrIndex++) {
    var attrName = imageAttrs[attrIndex], attrValue = image.attr(attrName);
    if (attrValue) image.attr(attrName, incJpg(attrValue));
  }
}`;
  const parts = content.split("\n");
  const idx = parts.findIndex(function(line) { return line.indexOf('img-cdn') >= 0 && line.indexOf('f_jpg') >= 0; });
  if (idx >= 0) s.ruleContent.content = parts.slice(0, idx).concat([replacement], parts.slice(idx + 1)).join("\n");
  else if (content.indexOf(replacement) < 0) throw Error('inc image marker');
}
const incLoginCheck = `<js>
function incBody(response) {
  try {
    if (!response) return "";
    var body = response.body;
    if (body != null && typeof body !== "function") return String(body);
    if (typeof body === "function") return String(body.call(response));
  } catch (e) {}
  return String(response || "");
}
function incChallenge(body) {
  var t = String(body || "").toLowerCase();
  return t.indexOf("datadome") >= 0 ||
    t.indexOf("please enable js and disable any ad blocker") >= 0 ||
    t.indexOf("enable javascript and cookies") >= 0 ||
    t.indexOf("verify you are human") >= 0;
}
function incResponseUrl(response) {
  try {
    var u = response && response.url;
    if (typeof u === "function") u = u.call(response);
    if (u) return String(u);
  } catch (e) {}
  var fallback = String(java.url || baseUrl || ""), cut = fallback.indexOf(",{ ");
  if (cut < 0) cut = fallback.indexOf(",{");
  return cut >= 0 ? fallback.substring(0, cut) : fallback;
}
var incResponse = result;
if (incChallenge(incBody(incResponse))) {
  var incUrl = incResponseUrl(incResponse);
  if (incUrl.indexOf("https://") !== 0 && incUrl.indexOf("http://") !== 0) throw "Inc.com验证地址无效";
  java.log("Inc.com 触发 DataDome，打开人工验证: " + incUrl);
  java.startBrowser(incUrl, "Inc.com 人工验证");
  throw "Inc.com需要人工验证，请完成后重试";
}
incResponse;
</js>`;
{
  const s = source('https://www.inc.com/');
  s.loginCheckJs = "";
}
{
  const s = source('https://www.inc.com/');
  const content = String(s.ruleContent && s.ruleContent.content || '');
  const replacement = String.raw`var incLower=html.toLowerCase(),incBlocked=incLower.indexOf("datadome")>=0||incLower.indexOf("please enable js and disable any ad blocker")>=0||incLower.indexOf("enable javascript and cookies")>=0||incLower.indexOf("verify you are human")>=0;
if(incBlocked){var incUrl=String(baseUrl||""),incCut=incUrl.indexOf(",{ ");if(incCut<0)incCut=incUrl.indexOf(",{");if(incCut>=0)incUrl=incUrl.substring(0,incCut);if(incUrl.indexOf("http://")===0||incUrl.indexOf("https://")===0)java.log("Inc.com DataDome challenge: " + incUrl);throw "Inc.com需要人工验证，请完成后重试";}
if(html.length<5000||/展开以继续阅读|continue reading|read more/i.test(html)){`;
  const parts = content.split("\n");
  const start = parts.findIndex(function(line) { return line.indexOf('var incLower=html.toLowerCase()') >= 0; });
  const body = parts.findIndex(function(line, index) { return index > start && line.indexOf('try{var u=String(baseUrl') >= 0; });
  if (body >= 0) {
    const begin = start >= 0 ? start : parts.findIndex(function(line) { return line.indexOf('if(html.length<5000') >= 0; });
    if (begin < 0) throw Error('inc content marker');
    s.ruleContent.content = parts.slice(0, begin).concat(replacement.split("\n"), parts.slice(body)).join("\n");
  } else if (content.indexOf(replacement) < 0) throw Error('inc content marker');
}
{
  const s = source('https://www.inc.com/');
  if (!s.loginUi) s.loginUi = JSON.stringify([{
    name: "Inc.com人工验证",
    type: "button",
    action: 'java.startBrowser("https://www.inc.com/","Inc.com人工验证")'
  }]);
}
fs.writeFileSync(file, JSON.stringify(sources, null, 2) + '\n');
console.log(`repaired ${file}`);
