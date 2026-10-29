'use strict';

/*
 * Inc.com article transport rules.
 *
 * Category and book pages are deliberately left to their existing rules.  This
 * module only handles an article request after Legado has made its normal HTTP
 * request: a DataDome response opens one explicit authentication window and
 * then returns the fresh HTTP response; body extraction never drives a
 * WebView.
 */

const incLoginCheck = String.raw`function incBody(response) {
  try {
    if (response == null) return '';
    var body = response.body;
    if (body != null && typeof body !== 'function') return String(body);
    if (typeof body === 'function') return String(body.call(response));
  } catch (e) {}
  return typeof response === 'string' ? String(response) : '';
}
function incDataDome(body) {
  var text = String(body || '').toLowerCase();
  return text.indexOf('datadome') >= 0 ||
    text.indexOf('geo.captcha-delivery.com') >= 0 ||
    text.indexOf('captcha-delivery.com') >= 0;
}
function incRequestUrl(response) {
  var url = '';
  try {
    url = response && response.url;
    if (typeof url === 'function') url = url.call(response);
    if (url) return String(url);
  } catch (e) {}
  try { url = String(java.url || baseUrl || ''); } catch (e) { url = ''; }
  var options = url.indexOf(',{');
  return options >= 0 ? url.substring(0, options) : url;
}
var incResponse = result;
if (incDataDome(incBody(incResponse))) {
  var incUrl = incRequestUrl(incResponse);
  if (!/^https?:\/\//i.test(incUrl) || incUrl.indexOf('{{') >= 0) throw 'Inc.com 验证地址无效';
  java.log('Inc.com DataDome 拦截，打开一次人工认证: ' + incUrl);
  var incFresh;
  try {
    // true asks Legado to refetch with the WebView-persisted cookies.  Do not
    // return a browser DOM snapshot to the content rule.
    incFresh = java.startBrowserAwait(incUrl, 'Inc.com 人工认证', true);
  } catch (e) {
    throw 'Inc.com 需要人工认证，请完成后重试';
  }
  try {
    var incHttpRefetch = java.getStrResponse();
    if (incHttpRefetch && !incDataDome(incBody(incHttpRefetch))) incFresh = incHttpRefetch;
  } catch (e) {}
  if (incDataDome(incBody(incFresh))) throw 'Inc.com 人工认证未解除 DataDome 拦截，请重试';
  incResponse = incFresh;
}
incResponse;`;

const incContent = String.raw`@css:body@html
<js>
var incHtml = String(result || '');
function incContainer(doc) {
  var node = doc.select('article .article-container.readMoreArticle').first();
  if (!node) node = doc.select('.article-container.readMoreArticle').first();
  return node;
}
function incLength(node) {
  if (!node) return 0;
  var chunks = node.select('.content-chunk');
  var text = chunks.size() ? String(chunks.text() || '') : String(node.text() || '');
  return text.replace(/\s+/g, ' ').trim().length;
}
function incFlightDocument(doc) {
  var scripts = doc.select('script'), fragments = [];
  for (var i = 0; i < scripts.size(); i++) {
    var source = String(scripts.get(i).html() || '').trim();
    if (source.indexOf('self.__next_f.push') < 0) continue;
    var matched = /self\.__next_f\.push\(([\s\S]*)\);?\s*$/.exec(source);
    if (!matched) continue;
    try {
      var payload = JSON.parse(matched[1]);
      var flight = Object.prototype.toString.call(payload) === '[object Array]' ? payload[1] : payload;
      if (typeof flight === 'string' && flight.indexOf('article-container') >= 0) fragments.push(flight);
    } catch (e) {}
  }
  if (!fragments.length) return null;
  var flightHtml = fragments.join('\n')
    .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').replace(/\\u0026/gi, '&')
    .replace(/\\\"/g, '"');
  return org.jsoup.Jsoup.parseBodyFragment(flightHtml);
}
var incDoc = org.jsoup.Jsoup.parse(incHtml);
var incArticle = incContainer(incDoc);
if (incLength(incArticle) < 80) {
  var incFlightDoc = incFlightDocument(incDoc);
  var incFlightArticle = incFlightDoc ? incContainer(incFlightDoc) : null;
  if (incLength(incFlightArticle) >= 80) incArticle = incFlightArticle;
}
if (incLength(incArticle) < 80) {
  java.log('Inc.com HTTP 响应没有可读正文；请完成 DataDome 认证后重试');
  throw 'Inc.com HTTP 正文不可用';
}
var incChunks = incArticle.select('.content-chunk'), incParts = [];
if (incChunks.size()) {
  for (var incIndex = 0; incIndex < incChunks.size(); incIndex++) incParts.push(String(incChunks.get(incIndex).outerHtml()));
} else {
  incParts.push(String(incArticle.html()));
}
var incBodyDoc = org.jsoup.Jsoup.parseBodyFragment(incParts.join('\n'));
incBodyDoc.select('script,noscript,style,template,button,form,.advertisement,.ad,.ads,.related,.social-share,.newsletter,.subscribe,.readMoreBtn,[class*="read-more"],[id*="readMore"],[id*="read-more"]').remove();
function incJpg(value) {
  var text = String(value || '');
  if (text.toLowerCase().indexOf('img-cdn.inc.com/image/upload/') < 0) return text;
  return text.replace(/f_webp/g, 'f_jpg').replace(/\.webp/gi, '.jpg');
}
var incImages = incBodyDoc.select('img[src],img[data-src],img[data-original],img[data-lazy-src],img[data-srcset],img[srcset]');
var incImageAttrs = ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset', 'srcset'];
for (var imageIndex = 0; imageIndex < incImages.size(); imageIndex++) {
  var image = incImages.get(imageIndex);
  for (var attrIndex = 0; attrIndex < incImageAttrs.length; attrIndex++) {
    var attrName = incImageAttrs[attrIndex], attrValue = image.attr(attrName);
    if (attrValue) image.attr(attrName, incJpg(attrValue));
  }
}
result = String(incBodyDoc.body().html());
if (typeof TH === 'function') result = TH(result, java, cache, {
  remove_selector: [], extract_selector: [], formula_mode: 'none', formula_selector: ''
});
result;
</js>`;

function applyIncHttpRules(source) {
  if (!source || source.bookSourceUrl !== 'https://www.inc.com/') {
    throw new Error('Inc.com source not found');
  }
  source.loginCheckJs = incLoginCheck;
  source.ruleToc = source.ruleToc || {};
  source.ruleToc.chapterUrl = '$.url';
  source.ruleContent = source.ruleContent || {};
  source.ruleContent.content = incContent;
  source.ruleContent.imageStyle = 'FULL';
  source.ruleContent.webJs = '';
  return source;
}

module.exports = { incLoginCheck, incContent, applyIncHttpRules };
