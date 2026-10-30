#!/usr/bin/env node
/* Focused contract check for Inc.com transport rules. */
'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

const sourceFile = process.argv[2] || 'booksource/legado-book-sources-current.json';
const sources = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const inc = sources.find((source) => source.bookSourceUrl === 'https://www.inc.com/');
if (!inc) throw new Error('Inc.com source not found');

const content = String(inc.ruleContent?.content || '');
const login = String(inc.loginCheckJs || '');
const chapterUrl = String(inc.ruleToc?.chapterUrl || '');
const fail = (message) => { throw new Error(message); };

if (!chapterUrl.startsWith('//h2/../@href\n<js>\n// Inc article URL: absolute HTTP link') || /webView/i.test(chapterUrl)) fail('article URL must preserve the phone selector as an absolute HTTP link');
if (!/webView/i.test(String(inc.exploreUrl || ''))) fail('category discovery WebView setting was unexpectedly removed');
const chapterScripts = [...chapterUrl.matchAll(/<js>\n([\s\S]*?)\n<\/js>/g)];
if (chapterScripts.length !== 1) fail('article URL must have exactly one postprocessor');
const chapterContext = {result: '/ali-donaldson/glen-powell-smash-kitchen-walmart-100-million-growth/91423818,{"webView":true,"webViewDelayTime":5000}', String};
vm.runInNewContext(chapterScripts[0][1], chapterContext, {timeout: 1000});
if (chapterContext.result !== 'https://www.inc.com/ali-donaldson/glen-powell-smash-kitchen-walmart-100-million-growth/91423818') {
  fail('article URL postprocessor did not remove inherited WebView options');
}
const exploreRule = String(inc.ruleExplore?.bookList || '');
const tocRule = String(inc.ruleToc?.chapterList || '');
if (!exploreRule.includes('src=\`Web::https://www.inc.com/') || /https:\/\/www\.inc\.com\/rss/i.test(exploreRule)) {
  fail('phone category/book discovery rule was not preserved');
}
if (!tocRule.includes('article')) fail('phone category article-list rule was not preserved');
if (!content.includes('article .article-container.readMoreArticle') || !content.includes("article .article-container').first()") || !content.includes('.content-chunk')) {
  fail('old/current Inc body selectors are missing');
}
if (!content.includes('self.__next_f.push') || !content.includes('JSON.parse(matched[1])')) {
  fail('Next Flight fallback must only JSON-decode payloads');
}
if (/java\.webView|startBrowserAwait|\bwebView\b/.test(content)) {
  fail('article content must not invoke or request a WebView');
}
if (!content.includes('img-cdn.inc.com/image/upload/') || !content.includes('f_jpg')) {
  fail('direct Inc image JPG normalization is missing');
}
if (!login.includes('incDataDome') || (login.match(/startBrowserAwait/g) || []).length !== 1) {
  fail('loginCheck must contain exactly one DataDome manual-auth path');
}
if (/java\.webView/.test(login) || !login.includes('java.getStrResponse')) {
  fail('loginCheck must return the refreshed HTTP response without a WebView fallback');
}

console.log(JSON.stringify({
  source: inc.bookSourceName,
  chapterUrl: 'plain absolute HTTP',
  discovery: 'existing WebView preserved',
  content: 'HTTP-only',
  imageDownload: 'direct JPG-normalized HTTP',
  manualAuthPaths: 1,
}));
