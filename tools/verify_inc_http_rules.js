#!/usr/bin/env node
/* Focused contract check for Inc.com transport rules. */
'use strict';

const fs = require('node:fs');

const sourceFile = process.argv[2] || 'booksource/legado-book-sources-current.json';
const sources = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const inc = sources.find((source) => source.bookSourceUrl === 'https://www.inc.com/');
if (!inc) throw new Error('Inc.com source not found');

const content = String(inc.ruleContent?.content || '');
const login = String(inc.loginCheckJs || '');
const chapterUrl = String(inc.ruleToc?.chapterUrl || '');
const fail = (message) => { throw new Error(message); };

if (chapterUrl !== '$.url' || /webView/i.test(chapterUrl)) fail('article URL must be the plain source URL');
if (!/webView/i.test(String(inc.exploreUrl || ''))) fail('category discovery WebView setting was unexpectedly removed');
if (!content.includes('article-container.readMoreArticle') || !content.includes('.content-chunk')) {
  fail('stable Inc body selector is missing');
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
  chapterUrl: 'plain HTTP',
  discovery: 'existing WebView preserved',
  content: 'HTTP-only',
  imageDownload: 'direct JPG-normalized HTTP',
  manualAuthPaths: 1,
}));
