#!/usr/bin/env node
/* Six scoped repairs. Importing this module never reads/writes the phone. */
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {changedPaths} = require('./phone_source_client');
const IDS = {
  carnegie: 'https://carnegie.ru/',
  journal: 'https://cssn.cn/dkzgxp/zgxp_zgshkx/',
  mid: 'https://mid.ru',
  cas: 'http://www.bulletin.cas.cn',
  annual: 'https://www.annualreviews.org',
  productplan: 'https://www.productplan.com'
};
const PRODUCT_CATEGORIES = {
  '/blog': 'Blog', '/case-studies': 'Case Studies', '/videos': 'Videos',
  '/webinars': 'Webinars', '/templates': 'Templates', '/glossary': 'Glossary'
};

// These functions are serialized into Rhino rules, so deliberately use ES5.
function sixAbsolute(value, base) {
  if (Array.isArray(value)) value = value[0] || '';
  var u = String(value || '').trim();
  if (!u || /^(?:javascript:|data:|mailto:|#)/i.test(u)) return '';
  u = u.replace(/,\s*\{[\s\S]*$/, '');
  try { return String(new Packages.java.net.URI(String(base)).resolve(u).toString()); }
  catch (e) { return /^https?:\/\//i.test(u) ? u : ''; }
}
function sixBody(response) {
  if (response == null) return '';
  if (typeof response === 'string') return response;
  try {
    var b = response.body;
    if (typeof b === 'function') return String(b.call(response));
    if (b != null) return String(b);
  } catch (e) {}
  return String(response);
}
function sixChallenge(html) {
  var d = org.jsoup.Jsoup.parse(String(html || ''));
  var title = String(d.title()).toLowerCase();
  var text = String(d.body().text()).toLowerCase();
  return /^(just a moment|attention required|access denied)/.test(title) ||
    d.select('#challenge-running,#challenge-stage,#cf-challenge-running').size() > 0 ||
    (text.length < 1200 && /enable javascript and cookies|verify you are human|performing security verification/.test(text));
}
function sixClean(doc, url) {
  doc.select('script,noscript,style,nav,aside,footer,form,iframe,template').remove();
  var elements = doc.getAllElements();
  for (var e = 0; e < elements.size(); e++) {
    var attrs = elements.get(e).attributes().iterator();
    while (attrs.hasNext()) {
      var attr = attrs.next();
      if (/^on/i.test(String(attr.getKey())) || /^javascript:/i.test(String(attr.getValue()))) attrs.remove();
    }
  }
  var imgs = doc.select('img');
  for (var i = 0; i < imgs.size(); i++) {
    var img = imgs.get(i);
    var src = String(img.attr('data-src')) || String(img.attr('data-original')) || String(img.attr('src'));
    if (src && !/^data:/i.test(src)) img.attr('src', sixAbsolute(src, url));
  }
  var links = doc.select('a[href]');
  for (var j = 0; j < links.size(); j++) {
    var a = links.get(j), href = sixAbsolute(a.attr('href'), url);
    if (href) a.attr('href', href);
  }
  return doc;
}
function sixFinish(doc, url, translate) {
  sixClean(doc, url);
  var html = String(doc.body().html());
  if (translate && typeof TH === 'function') html = TH(html, java, cache, {
    remove_selector: [], extract_selector: [], formula_mode: 'none', formula_selector: '',
    image_base_url: url, notranslate_selector: ['.notranslate', 'math', '.MathJax_Display']
  });
  return String(html);
}
const COMMON = [sixAbsolute, sixBody, sixChallenge, sixClean, sixFinish].map(String).join('\n');
function js(fn, extra = '', selector = '') {
  return '<js>\n' + COMMON + '\n' + extra + '\nresult=(' + fn.toString() +
    ')(result,String(typeof baseUrl===\"undefined\"?\"\":baseUrl));\nresult;\n</js>' + (selector ? '\n' + selector : '');
}
function translated(selector) {
  return selector + '\n<js>\nif(result && typeof TT===\"function\") result=TT(result, java, cache);\nresult;\n</js>';
}
function directVerification(label) {
  return COMMON + '\nvar sixResponse=result;\n' +
    'if(sixChallenge(sixBody(sixResponse))){\n' +
    ' var u=\"\";try{var v=sixResponse.url;u=String(typeof v===\"function\"?v.call(sixResponse):v||\"\");}catch(e){}\n' +
    ' if(!u)u=String(java.url||baseUrl||\"\");u=sixAbsolute(u,u);\n' +
    ' if(!/^https?:\\/\\//i.test(u)||u.indexOf(\"{{\")>=0)throw \"验证地址无效\";\n' +
    ' java.startBrowserAwait(u,' + JSON.stringify(label) + ',false);\n' +
    ' sixResponse=java.connect(u,null,20000);\n' +
    ' if(sixChallenge(sixBody(sixResponse)))throw \"BLOCKED: 人工验证后 HTTP 请求仍被阻断\";\n' +
    '}\nsixResponse;';
}

function carnegieNext(raw, url) {
  var d = org.jsoup.Jsoup.parse(String(raw || ''), url);
  var a = d.select('a.page-links__next[href]').first();
  var m = url.match(/[?&](?:pageOn|page|p)=(\d+)/i);
  if (!a || (m && parseInt(m[1], 10) >= 10)) return '';
  var next = sixAbsolute(a.attr('href'), url).replace(/^https:\/\/carnegie\.ru/i, 'http://carnegie.ru');
  return next && next !== url ? next : '';
}
function carnegieContent(raw, url) {
  var d = org.jsoup.Jsoup.parse(String(raw || ''), url);
  if (sixChallenge(raw)) throw 'BLOCKED: Carnegie 验证页不是正文';
  var body = d.select('div.commentary-detail,div.article-body,#printtext').first();
  if (!body) throw 'Carnegie 未找到文章正文';
  var out = org.jsoup.Jsoup.parseBodyFragment(String(body.outerHtml()), url);
  out.select('.related,.related-content,.social-share,.newsletter,.btn-row,.print-button').remove();
  var hero = out.select('.zone-title.background-cover[style]').first();
  if (hero) {
    var background = String(hero.attr('style')).match(/background-image:\s*url\(\s*['"]?([^'")]+)/i);
    if (background) {
      var image = sixAbsolute(background[1].trim(), url);
      if (image) hero.prependElement('img').attr('src', image);
      hero.removeAttr('style');
    }
  }
  return sixFinish(out, url, true);
}
function journalCover(raw, url) {
  var fallback = 'https://www.cssn.cn/images/sk02-zgxp-book0.png';
  var doc = org.jsoup.Jsoup.parse(String(raw || ''), url);
  var img = doc.select('.list_text_left .list_img img[src],.list_text_left .list_img img[data-src]').first();
  if (img) {
    var own = sixAbsolute(String(img.attr('data-src')) || String(img.attr('src')), url);
    if (own) return own;
  }
  var match = url.match(/\/dkzgxp\/([^/]+)\//);
  if (!match) return fallback;
  try {
    var portal = '', key = 'six:cssn:journal-covers:v1';
    try { portal = cache.get(key) || ''; } catch (e) {}
    if (!portal) {
      portal = String(java.ajax('https://www.cssn.cn/dkzgxp/', 15000) || '');
      var test = org.jsoup.Jsoup.parse(portal).select('.zgxp-top .qk-cont .imgs-cont img[src]');
      if (test.size()) try { cache.put(key, portal, 3600); } catch (e) {}
    }
    var root = org.jsoup.Jsoup.parse(String(portal), 'https://www.cssn.cn/dkzgxp/');
    var covers = root.select('.zgxp-top .qk-cont .imgs-cont img[src]');
    for (var i = 0; i < covers.size(); i++) {
      var u = sixAbsolute(covers.get(i).attr('src'), 'https://www.cssn.cn/dkzgxp/');
      if (u.indexOf('/dkzgxp/' + match[1] + '/images/') >= 0) return u;
    }
  } catch (e) {}
  return fallback;
}
function casContent(raw, url) {
  var host = 'http://www.bulletin.cas.cn';
  var page = String(raw || ''), d = org.jsoup.Jsoup.parse(page, url);
  var doi = url.match(/\/doi\/([^?#]+)/), idMatch = page.match(/(?:articleBaseId|minici_baseId)\s*[:=]\s*['\"]([A-Fa-f0-9]{32})['\"]/);
  if (!doi || !idMatch) throw '中科院文章页缺少 DOI 或 articleBaseId';
  var baseId = idMatch[1];
  var basic = JSON.parse(String(java.ajax(host + '/rest/v4/article/basic?articleBaseId=' +
    encodeURIComponent(baseId) + '&doi=' + encodeURIComponent(doi[1]), 20000) || '{}'));
  var article = basic.article || {}, id = String(article.baseId || baseId);
  if (!/^[A-Fa-f0-9]{32}$/.test(id)) throw '中科院 baseId 无效';
  var options = {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Referer: url},
    body: 'baseId=' + encodeURIComponent(id) + '&pdfRemark=&translate='};
  var full = String(java.ajax(host + '/doi/getFulltext,' + JSON.stringify(options), 20000) || '');
  var out = org.jsoup.Jsoup.parseBodyFragment(/^\s*%PDF-/.test(full) ? '' : full, url);
  var pdf = d.select('meta[name=citation_pdf_url]').attr('content');
  if (out.select('p,h3,table,fig,img').size() === 0 || String(out.body().text()).trim().length < 80) {
    if (pdf && (/catalog/i.test(String(article.doi || doi[1])) || out.select('#pdfDownUrl').size())) {
      out = org.jsoup.Jsoup.parseBodyFragment('', url);
      out.body().appendElement('p').text('此条目仅提供 PDF，没有 HTML 全文。');
      out.body().appendElement('a').attr('href', sixAbsolute(pdf, url)).text('打开原站 PDF');
      return sixFinish(out, url, false);
    }
    throw '中科院未取得 HTML 全文（可能无权限或仅 PDF）；不以摘要代替';
  }
  if (article.title) out.body().prependElement('h1').html(String(article.title));
  if (out.select('xref[ref-type=fig],xref[ref-type=table]').size()) {
    try {
      var ft = JSON.parse(String(java.ajax(host + '/rest/v4/article/figAndTable?articleBaseId=' + encodeURIComponent(id) + '&trans=', 15000) || '{}'));
      var list = ft.figureList || [];
      for (var f = 0; f < list.length; f++) {
        var item = list[f], rid = String(item.labelId || item.label_id || '');
        if (!rid) continue;
        var refs = out.select('xref[rid="' + rid.replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
        if (!refs.size()) continue;
        var figure = org.jsoup.Jsoup.parseBodyFragment('').body().appendElement('div');
        if (item.tableText) figure.append(String(item.tableText));
        else {
          var covers = item.pArticleFigCoverList || (item.figCover ? [{figCover:item.figCover}] : []);
          if (!covers.length) continue;
          for (var c = 0; c < covers.length; c++) {
            var image = String(covers[c].figCover || '');
            if (image) figure.appendElement('img').attr('src', sixAbsolute(image, host + '/figures/'));
          }
        }
        if (item.caption) figure.appendElement('p').html(String(item.labelName || '') + ' ' + String(item.caption));
        refs.first().after(figure);
      }
    } catch (e) { java.log('中科院图表补充失败，保留正文及原图表引用'); }
  }
  var italic = out.select('italic'), bold = out.select('bold');
  for (var a = 0; a < italic.size(); a++) italic.get(a).tagName('i');
  for (var b = 0; b < bold.size(); b++) bold.get(b).tagName('b');
  return sixFinish(out, url, false);
}
function annualContent(raw, url) {
  var html = String(raw || ''), doc = org.jsoup.Jsoup.parse(html, url);
  if (sixChallenge(html)) throw 'BLOCKED: Annual Reviews 返回验证页';
  var originalDoc = doc;
  var full = doc.select('#html_fulltext').first();
  var delivery = doc.select('#itemFullTextId[data-fulltexturl]').first();
  if (delivery) {
    var deliveryUrl = sixAbsolute(String(delivery.attr('data-fulltexturl')), url);
    if (!/\/deliver\/fulltext\/.*\.html(?:[?]|$)/i.test(deliveryUrl)) throw 'Annual Reviews 未提供 HTML 全文地址';
    var response = java.connect(deliveryUrl, null, 20000);
    html = sixBody(response);
    if (sixChallenge(html)) throw 'BLOCKED: Annual Reviews HTML 全文接口被阻断';
    // The delivery endpoint can return a short-lived docserver URL, not HTML.
    var docserver = html.trim();
    if (/^https?:\/\/www\.annualreviews\.org\/docserver\/ahah\/fulltext\/[^\s<>]+\.html(?:\?[^\s<>]*)?$/i.test(docserver)) {
      deliveryUrl = docserver;
      html = sixBody(java.connect(deliveryUrl, null, 20000));
      if (sixChallenge(html)) throw 'BLOCKED: Annual Reviews docserver 全文被阻断';
    }
    if (/^\s*%PDF-/.test(html)) throw 'Annual Reviews HTML 接口返回 PDF，不能作为文本正文';
    var fragment = org.jsoup.Jsoup.parseBodyFragment(html, deliveryUrl);
    full = fragment.select('#html_fulltext').first() || fragment.body();
    if (full.select('p').size() === 0 || String(full.text()).trim().length < 80) throw 'Annual Reviews HTML 全文不可用；不以摘要代替';
    url = deliveryUrl;
  }
  if (!full || String(full.text()).trim().length < 80) {
    var links = doc.select('a[href]'), next = '';
    for (var i = 0; i < links.size(); i++) {
      var a = links.get(i), label = String(a.text() + ' ' + a.attr('title')).toLowerCase();
      var u = sixAbsolute(a.attr('href'), url);
      if (/full.?text|full article|全文|html/.test(label) && /annualreviews\.org\//i.test(u) && !/\/pdf|\.pdf(?:[?#]|$)/i.test(u) && u !== url) { next = u; break; }
    }
    if (next) {
      var response = java.connect(next, null, 20000);
      html = sixBody(response);
      if (sixChallenge(html)) throw 'BLOCKED: Annual Reviews HTML 全文被阻断';
      doc = org.jsoup.Jsoup.parse(html, next); url = next;
      full = doc.select('#html_fulltext').first();
    }
  }
  if (!full || String(full.text()).trim().length < 80) throw 'Annual Reviews 未取得 HTML 全文（可能无权限或仅 PDF）；不以摘要代替';
  var out = org.jsoup.Jsoup.parseBodyFragment('', url), title = originalDoc.select('div.title-box').first();
  if (title) out.body().append(String(title.outerHtml()));
  out.body().append(String(full.outerHtml()));
  out.select('.btn-row,.menuButton,.dropDownMenu,span.references,.itemFullTextLoading,#multimediadialog').remove();
  if (out.select('p').size() === 0 || String(full.text()).trim().length < 80) throw 'Annual Reviews 未取得正文段落；不以加载提示代替';
  return sixFinish(out, url, true);
}
function productExplore(raw, url) {
  var d = org.jsoup.Jsoup.parse(String(raw || ''), url), out = org.jsoup.Jsoup.parseBodyFragment(''), seen = {};
  var items = d.select('nav.navbar_dropdown-list li.navbar_dropdown-inner-list-item');
  for (var i = 0; i < items.size(); i++) {
    var a = items.get(i).select('a[href]').first();
    if (!a) continue;
    var u = sixAbsolute(a.attr('href'), url), path = u.replace(/^https?:\/\/www\.productplan\.com/i, '').replace(/\/$/, '');
    if (!PRODUCT_CATEGORIES[path] || seen[u]) continue;
    seen[u] = true;
    out.body().appendElement('li').appendElement('a').attr('href', u).text(PRODUCT_CATEGORIES[path]);
  }
  return String(out.body().html());
}
function productToc(raw, url) {
  var d = org.jsoup.Jsoup.parse(String(raw || ''), url), out = org.jsoup.Jsoup.parseBodyFragment(''), seen = {};
  var category = url.replace(/^https?:\/\/www\.productplan\.com/i, '').split(/[?#]/)[0].replace(/\/$/, '');
  if (!PRODUCT_CATEGORIES[category]) throw 'ProductPlan 不是内容栏目 URL';
  var cards = d.select('main a.grid-item[href],main a.featured-collection[href]');
  var later = /[?&][^=&]+_page=([2-9]|\d{2,})\b/.test(url);
  for (var i = 0; i < cards.size(); i++) {
    var a = cards.get(i), u = sixAbsolute(a.attr('href'), url);
    if (seen[u] || u.indexOf('https://www.productplan.com' + category + '/') !== 0) continue;
    if (later && (a.hasClass('cc-featured') || a.hasClass('featured-collection'))) continue;
    var heading = a.select('h2,h3,h4').first();
    var name = heading ? String(heading.text()) : String(a.text());
    if (!name.trim()) continue;
    seen[u] = true;
    var clone = a.clone().attr('href', u);
    if (!heading) clone.prependElement('h4').text(name);
    out.body().appendElement('li').appendChild(clone);
  }
  var html = String(out.body().html());
  if (typeof TH === 'function') html = TH(html, java, cache, {remove_selector:[], extract_selector:[], formula_mode:'none', formula_selector:''});
  return String(html);
}
function productNext(raw, url) {
  var doc = org.jsoup.Jsoup.parse(String(raw || ''), url);
  var a = doc.select('main a.w-pagination-next[href]').first();
  if (!a) return '';
  var next = sixAbsolute(a.attr('href'), url);
  // Finsweet marks server-side pagination disabled until JS initializes.
  // The actual href remains valid over HTTP: do not discard it by class.
  return next && next !== url ? next : '';
}
function productContent(raw, url) {
  var doc = org.jsoup.Jsoup.parse(String(raw || ''), url), main = doc.select('main').first();
  if (!main || sixChallenge(raw)) throw 'ProductPlan 未取得内容页';
  var rich = main.select('.rich-text'), out = org.jsoup.Jsoup.parseBodyFragment('', url);
  var title = main.select('h1').first();
  if (title) out.body().append(String(title.outerHtml()));
  for (var i = 0; i < rich.size(); i++) out.body().append(String(rich.get(i).outerHtml()));
  if (!rich.size()) {
    var description = main.select('.plain-text').first();
    var text = description ? String(description.text()) : String(doc.select('meta[name=description]').attr('content'));
    if (!text.trim()) throw 'ProductPlan 未找到资源说明或正文';
    out.body().appendElement('p').text(text);
    var image = String(doc.select('meta[property=og:image]').attr('content'));
    if (image) out.body().appendElement('img').attr('src', sixAbsolute(image, url));
  }
  out.body().appendElement('p').addClass('six-original-resource').appendElement('a').attr('href', url).text('原站内容 / Original resource');
  return sixFinish(out, url, true);
}

function repair(source) {
  const s = source;
  if (!Object.values(IDS).includes(s.bookSourceUrl)) return s;
  s.ruleBookInfo ||= {};
  s.ruleContent ||= {};
  s.ruleToc ||= {};
  if (s.bookSourceUrl === IDS.carnegie) {
    s.exploreUrl = String(s.exploreUrl).replace(/https:\/\/carnegie\.ru/gi, 'http://carnegie.ru');
    s.ruleExplore.name = '@js:/\\/commentary\\//.test(String(baseUrl))?\"卡内基莫斯科：俄语评论\":\"卡内基莫斯科：英文评论\"';
    s.ruleToc.chapterUrl = 'h4 a@href||h2 a@href\n' + js(function(raw, url) {
      return sixAbsolute(raw, url).replace(/^https:\/\/carnegie\.ru/i, 'http://carnegie.ru');
    });
    s.ruleToc.chapterName = translated('h4 a@text||h2 a@text');
    s.ruleToc.nextTocUrl = js(carnegieNext);
    s.ruleContent.content = js(carnegieContent);
    s.ruleContent.webJs = '';
    s.loginCheckJs = directVerification('Carnegie 人工验证（正文仍用 HTTP）');
  } else if (s.bookSourceUrl === IDS.journal) {
    s.ruleBookInfo.coverUrl = js(journalCover);
  } else if (s.bookSourceUrl === IDS.mid) {
    s.exploreUrl = '俄罗斯外交部::https://mid.ru/ru/foreign_policy/news/';
    s.ruleBookInfo.name = '@js:book.name||\"俄罗斯外交部\"';
    s.ruleBookInfo.tocUrl = '@js:book.bookUrl';
  } else if (s.bookSourceUrl === IDS.cas) {
    s.ruleToc.chapterUrl = 'http://www.bulletin.cas.cn/BCAS_CH/doi/{{$.doi}}';
    s.ruleContent.content = js(casContent);
    s.ruleContent.webJs = '';
  } else if (s.bookSourceUrl === IDS.annual) {
    s.ruleContent.content = js(annualContent);
    s.ruleContent.webJs = '';
    s.loginCheckJs = directVerification('Annual Reviews 人工验证（正文仍用 HTTP）');
  } else if (s.bookSourceUrl === IDS.productplan) {
    const categories = 'var PRODUCT_CATEGORIES=' + JSON.stringify(PRODUCT_CATEGORIES) + ';';
    s.exploreUrl = 'Resources::https://www.productplan.com/';
    s.ruleExplore.bookList = js(productExplore, categories, 'li');
    s.ruleExplore.bookUrl = 'a@href';
    s.ruleExplore.name = translated('a@text');
    s.ruleBookInfo.name = '@js:book.name||\"ProductPlan\"';
    s.ruleBookInfo.coverUrl = 'main a.grid-item img@src||meta[property="og:image"]@content';
    s.ruleBookInfo.tocUrl = '@js:book.bookUrl';
    s.ruleToc.chapterList = '-\n' + js(productToc, categories, 'li');
    s.ruleToc.chapterName = 'h2@text||h3@text||h4@text';
    s.ruleToc.chapterUrl = 'a@href';
    s.ruleToc.updateTime = '[fs-list-field="description"]@text';
    s.ruleToc.nextTocUrl = js(productNext);
    s.ruleContent.content = js(productContent);
    s.ruleContent.webJs = '';
  }
  return s;
}

function repaired(sources) {
  return sources.map(s => repair(structuredClone(s)));
}
function applyLeaf(target, value, path) {
  const keys = path.split('.');
  let t = target, v = value;
  for (const key of keys.slice(0, -1)) { t = t[key] ||= {}; v = v[key]; }
  const key = keys.at(-1);
  if (v[key] === undefined) delete t[key]; else t[key] = structuredClone(v[key]);
}

module.exports = {IDS, PRODUCT_CATEGORIES, repair, repaired, applyLeaf, js, COMMON,
  carnegieNext, carnegieContent, journalCover, casContent, annualContent,
  productExplore, productToc, productNext, productContent, directVerification};

if (require.main === module) {
  const [command, baselineFile = '/tmp/booksrc-six-20261102/phone-before.json'] = process.argv.slice(2);
  if (command === 'bundle') {
    const local = JSON.parse(fs.readFileSync('booksource/legado-book-sources-current.json', 'utf8'));
    const six = local.filter(s => Object.values(IDS).includes(s.bookSourceUrl));
    assert.equal(six.length, 6, 'six-source import must contain exactly six sources');
    assert.deepEqual(repaired(six), six, 'canonical repairs must be applied before export');
    assert(six.every(s => !Object.keys(s).some(k => /^(loginInfo|cookies?|password)$/i.test(k))), 'private session data cannot be exported');
    fs.writeFileSync('booksource/legado-six-source-repairs.json', JSON.stringify(six, null, 2) + '\n');
    console.log('exported six sources without private phone backups');
    process.exit(0);
  }
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const candidate = repaired(baseline);
  if (command === 'candidate') {
    const output = baselineFile.replace(/phone-before\.json$/, 'phone-candidate.json');
    assert.notEqual(output, baselineFile);
    fs.writeFileSync(output, JSON.stringify(candidate, null, 2) + '\n', {mode: 0o600});
    for (const s of candidate.filter(s => Object.values(IDS).includes(s.bookSourceUrl))) {
      const before = baseline.find(x => x.bookSourceUrl === s.bookSourceUrl);
      console.log(JSON.stringify({name:s.bookSourceName,changed:changedPaths(before,s)}));
    }
  } else if (command === 'patch' || command === 'apply') {
    const path = 'booksource/legado-book-sources-current.json';
    const before = fs.readFileSync(path, 'utf8'), local = repaired(JSON.parse(before));
    for (const s of candidate.filter(s => Object.values(IDS).includes(s.bookSourceUrl))) {
      const old = baseline.find(x => x.bookSourceUrl === s.bookSourceUrl);
      const target = local.find(x => x.bookSourceUrl === s.bookSourceUrl);
      assert(target, 'local source missing: ' + s.bookSourceUrl);
      for (const key of changedPaths(old,s)) applyLeaf(target,s,key);
    }
    const after = JSON.stringify(local,null,2) + '\n';
    if (command === 'apply') {
      // Mechanical JSON regeneration; all rule edits are authored above.
      fs.writeFileSync(path, after);
      console.log('updated only the six scoped canonical sources');
    } else {
    const a = '/tmp/booksrc-six-20261102/canonical-a.json', b = '/tmp/booksrc-six-20261102/canonical-b.json';
    fs.writeFileSync(a,before,{mode:0o600}); fs.writeFileSync(b,after,{mode:0o600});
    let diff = '';
    try { diff = execFileSync('diff',['-u',a,b],{encoding:'utf8',maxBuffer:8*1024*1024}); }
    catch (e) { if(e.status!==1)throw e; diff=String(e.stdout); }
    if (diff) process.stdout.write('*** Begin Patch\n*** Update File: ' + path + '\n' +
      diff.split('\n').slice(2).join('\n').replace(/^@@[^\n]*@@[^\n]*/gm,'@@') + '*** End Patch\n');
    }
  } else throw Error('Usage: repair_six_sources.js candidate|patch|apply [phone-baseline]|bundle');
}
