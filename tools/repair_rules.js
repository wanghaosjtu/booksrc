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
for (var ii = 0; ii < issueLinks.length; ii++) {
  var issueDoc = org.jsoup.Jsoup.parse(responseBody(java.ajax(issueLinks[ii])));
  var articleLinks = issueDoc.select("a[href*='/doi/']");
  for (var ai = 0; ai < articleLinks.size(); ai++) {
    var anchor = articleLinks.get(ai), item = anchor.parent ? anchor.parent() : null;
    if (!item || !(item.hasClass && item.hasClass("issue-item"))) continue;
    var url = absolute(anchor.attr("href")), title = String(anchor.text() || "").replace(/\\s+/g, " ").trim();
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
  const replacement = String.raw`if(src&&/img-cdn\.inc\.com\/image\/upload\//i.test(src)){if(src.indexOf("/f_webp")>=0)src=src.replace("/f_webp","/f_jpg");else if(/\.webp(?:[?#]|$)/i.test(src)&&src.indexOf("/f_jpg/")<0)src=src.replace("/image/upload/","/image/upload/f_jpg/");}`;
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
  s.loginCheckJs = incLoginCheck.replace("<js>\n", "").replace("\n</js>", "");
}
fs.writeFileSync(file, JSON.stringify(sources, null, 2) + '\n');
console.log(`repaired ${file}`);
