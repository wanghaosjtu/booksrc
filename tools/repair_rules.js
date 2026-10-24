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

fs.writeFileSync(file, JSON.stringify(sources, null, 2) + '\n');
console.log(`repaired ${file}`);
