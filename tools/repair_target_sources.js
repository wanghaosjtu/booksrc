const fs = require('fs');

const path = 'booksource/legado-book-sources-current.json';
const sources = JSON.parse(fs.readFileSync(path, 'utf8'));
const TARGET_SOURCE_URLS = new Set([
  'https://www.productplan.com', 'http://sage.cnpereading.com/', 'https://www.inc.com/',
  'https://navi.cnki.net/knavi/journals/KJGC/detail?uniplatform=NZKPT', 'https://russiancouncil.ru/',
  'https://mid.ru', 'https://cssn.cn/', 'http://www.ccg.org.cn', 'https://carnegie.ru/',
  'https://www.rand.org/', 'https://www.rand.org/pubs.html', 'https://www.state.gov',
  'https://www.science.org/toc/science/current'
]);

function byUrl(url) {
  const source = sources.find((item) => String(item.bookSourceUrl || '') === url);
  if (!source) throw new Error('source not found: ' + url);
  return source;
}

// Never persist the old debug login-info dump. It can expose proxy/login values.
for (const source of sources) {
  if (TARGET_SOURCE_URLS.has(source.bookSourceUrl) && source.loginUrl) source.loginUrl = String(source.loginUrl).replace(/\s*java\.log\('logininfo:' \+ source\.getLoginInfo\(\)\);\s*/g, '\n');
}

function normalizeAbsolute(prefix) {
  return [
    'var raw=result; if(Array.isArray(raw))raw=raw[0]||""; var u=String(raw||"").trim();',
    'if(u.charAt(0)==="["&&u.charAt(u.length-1)==="]")u=u.substring(1,u.length-1).trim();',
    'if(u.indexOf(\'http\')!==0){',
    '  if(u.indexOf(\'//\')===0)u=\'https:\'+u;',
    '  else if(u.indexOf(\'./\')===0)u=\'' + prefix + '/\'+u.substring(2);',
    '  else if(u.charAt(0)===\'/\')u=\'' + prefix + '\'+u;',
    '  else u=\'' + prefix + '/\'+u;',
    '}',
    'result=u;'
  ].join('\n');
}

function lightWebViewCleanup(selectors) {
  return [
    'var remove=[' + selectors.map((s) => JSON.stringify(s)).join(',') + '];',
    'for(var i=0;i<remove.length;i++){',
    '  var nodes=document.querySelectorAll(remove[i]);',
    '  for(var j=nodes.length-1;j>=0;j--){',
    '    if(nodes[j]&&nodes[j].parentNode)nodes[j].parentNode.removeChild(nodes[j]);',
    '  }',
    '}',
    'var imgs=document.querySelectorAll(\'img[data-src],img[data-original],img[data-lazy-src],img[data-original-src]\');',
    'for(var k=0;k<imgs.length;k++){',
    '  var img=imgs[k],src=img.getAttribute(\'data-src\')||img.getAttribute(\'data-original\')||img.getAttribute(\'data-lazy-src\')||img.getAttribute(\'data-original-src\');',
    '  if(src&&(!img.getAttribute(\'src\')||/placeholder|transparent|spacer/i.test(img.getAttribute(\'src\'))))img.setAttribute(\'src\',src);',
    '}',
    'document.body?document.body.outerHTML:document.documentElement.outerHTML;'
  ].join('\n');
}

/* ProductPlan: the Resources navigation now lands on Downloads; every card keeps its own URL and title. */
{
  const s = byUrl('https://www.productplan.com');
  s.exploreUrl = 'Resources::https://www.productplan.com/resources/';
  s.ruleExplore = {
    author: '@js:"ProductPlan"',
    bookList: 'a.featured-collection, a.grid-item',
    bookUrl: '@href',
    coverUrl: 'img@src||@js:""',
    intro: '.plain-text@text||.eyebrow@text||@js:"ProductPlan resources"',
    kind: '"产品与创业"',
    name: 'h2@text||h4@text||@text'
  };
  s.ruleBookInfo = {
    name: 'h1@text',
    coverUrl: 'meta[property="og:image"]@content||main img@src',
    intro: 'main h1~p@text||main p@text',
    tocUrl: '@js:book.bookUrl'
  };
  s.ruleToc = {
    chapterList: 'main .rich-text > p, main .rich-text > div||main h1~p, main h1~div',
    chapterName: '@text',
    chapterUrl: '@text\n<js>\nvar t=String(result||""),h=0;for(var i=0;i<t.length;i++)h=((h<<5)-h+t.charCodeAt(i))|0;book.bookUrl+"#pp-"+Math.abs(h);\n</js>',
    updateTime: '@js:""'
  };
  s.ruleContent = {
    content: '@css:main .rich-text@html||main@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||""));\nd.select("script,noscript,style,nav,aside,form").remove();\nresult=""+d.body().html();\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>',
    imageStyle: 'FULL'
  };
}

/* Sage: translate issue/article names and unwrap all JATS/XML tags found in JOM 52/8. */
{
  const s = byUrl('http://sage.cnpereading.com/');
  const old = String(s.ruleContent && s.ruleContent.content || '');
  const marker = 'var doc = Jsoup.parse(html);';
  if (old.indexOf(marker) < 0) throw new Error('Sage content marker not found');
  const jats = ["list","list-item","table-wrap","table-wrap-foot","supplementary-material","disp-formula","inline-formula","person-group","given-names","surname","name","year","chapter-title","source","volume","fpage","lpage","publisher-loc","publisher-name","article-title","edition","issue","collab","conf-name","conf-loc","pub-id","tex-math"];
  const cleanup = 'var jats=["' + jats.join('","') + '"];\nfor(var ji=0;ji<jats.length;ji++){try{doc.select(jats[ji]).unwrap();}catch(e){}}';
  s.ruleContent.content = old.replace(marker, marker + '\n' + cleanup);
  s.ruleExplore.name = '@text\n<js>\nif(result && typeof TT==="function")result=TT(result,java,cache);\nresult;\n</js>';
  s.ruleToc = {
    chapterList: '-\narticle.journal-detail__article--card',
    chapterName: 'h3 a@text\n<js>\nif(result && typeof TT==="function")result=TT(result,java,cache);\nresult;\n</js>',
    chapterUrl: 'h3 a@href',
    isVip: 'span[aria-label="Access type: Restricted access"]@text\n@js:if(result){true}else{false}'
  };
}

/* Inc: WebView only performs bounded DOM cleanup and always returns HTML.
 * Readability-style candidate scoring lives in the content rule instead of a
 * long asynchronous WebView script. */
{
  const s = byUrl('https://www.inc.com/');
  s.exploreUrl = 'inc.com::https://www.inc.com,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nStartup::https://www.inc.com/startup,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nGrow::https://www.inc.com/grow,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nLead::https://www.inc.com/lead,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nTech::https://www.inc.com/technology,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nInnovate::https://www.inc.com/innovate,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nMoney::https://www.inc.com/money,{' + '"webView":true,"webViewDelayTime":5000}' +
    '\nBrandview::https://www.inc.com/brandview,{' + '"webView":true,"webViewDelayTime":5000}';
  s.ruleToc.chapterUrl = '//h2/../@href##$##,{"webView":true,"webViewDelayTime":5000}';
  s.ruleContent = {
    content: '@css:body@html\n<js>\nvar html=String(result||"");\nvar doc=org.jsoup.Jsoup.parseBodyFragment(html);\nvar candidates=doc.select("article,main,[role=main],.article-body,.article-content,.content-body,.entry-content,.story-body");\nvar best=null,bestScore=0;\nfor(var i=0;i<candidates.size();i++){\n  var e=candidates.get(i),txt=""+e.text(),cls=(""+e.className()).toLowerCase();\n  if(!txt||txt.length<120)continue;\n  var score=txt.length+e.select("p").size()*180+e.select("h2,h3").size()*80;\n  if(/nav|menu|footer|sidebar|related|comment|social|advert|promo/.test(cls))score-=txt.length;\n  if(score>bestScore){bestScore=score;best=e;}\n}\nif(!best)best=doc.body();\nbest.select("script,noscript,style,nav,header,footer,aside,form,.advertisement,.ad,.ads,.related,.social-share,.newsletter,.subscribe").remove();\nresult=""+best.html();\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>',
    imageStyle: 'FULL',
    webJs: lightWebViewCleanup(['script','noscript','style','nav','aside','header','footer','ent-hubspot-newsletter','ent-results','.ent-component','.ad','.advertisement'])
  };
}

/* CNKI: identity loginCheckJs deliberately returns the original response;
 * it does not mistake the journal security page for an application login and
 * therefore lets the existing catalogue/content rules run. */
{
  const s = byUrl('https://navi.cnki.net/knavi/journals/KJGC/detail?uniplatform=NZKPT');
  s.loginCheckJs = String.raw`function cnkiBody(response){try{return String(response.body());}catch(e){return String(response||"");}}
function cnkiChallenge(body){var t=String(body||"").toLowerCase();return t.indexOf("安全验证")>=0||t.indexOf("人机识别")>=0||t.indexOf("captcha")>=0||t.indexOf("clickword")>=0||t.indexOf("verify/home")>=0||t.indexOf("errorpage")>=0||t.indexOf("访问请求")>=0;}
var cnkiResponse=result,cnkiText=cnkiBody(cnkiResponse);
if(cnkiChallenge(cnkiText)){
  var cnkiUrl=String(java.url||baseUrl||"");try{cnkiUrl=decodeURIComponent(cnkiUrl);}catch(e){}
  if(!/^https?:\/\//i.test(cnkiUrl))throw "CNKI验证地址无效";
  var browserResponse=java.startBrowserAwait(cnkiUrl,"CNKI安全验证",true);
  try{var refreshed=java.getStrResponse();if(!cnkiChallenge(cnkiBody(refreshed)))cnkiResponse=refreshed;else cnkiResponse=browserResponse;}catch(e){cnkiResponse=browserResponse;}
}
cnkiResponse;`;
  s.ruleToc.chapterUrl = 'span.name a@href\n<js>\n' + normalizeAbsolute('https://navi.cnki.net') + '\nresult;\n</js>';
  s.ruleContent = {
    content: '@css:body@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||""));\nvar candidates=d.select(".article-content,.article-body,#article-content,.content,.base-info.content,.catalog-list,.header");\nvar best=null,bestScore=0;\nfor(var i=0;i<candidates.size();i++){var e=candidates.get(i),t=""+e.text(),score=t.length+e.select("p").size()*120;if(score>bestScore){bestScore=score;best=e;}}\nif(best)result=""+best.html();else result=""+d.body().html();\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:["script","noscript","style","header","nav","aside"],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>',
    sourceRegex: '',
    webJs: ''
  };
}

/* RIAC: keep proxyUrl support, repair the accidentally imported RAND list,
 * and accept both a publication list and a single article as a TOC. */
{
  const s = byUrl('https://russiancouncil.ru/');
  s.ruleExplore = {
    author: '@js:"Российский совет по международным делам"',
    bookList: '<js>if(typeof TH==="function")result=TH(result,java,cache,{remove_selector:["script","noscript","style","nav","aside","footer","div.row.mb20","div.fdreedf","main aside"],extract_selector:[],formula_mode:"none",formula_selector:""});result;</js>\ndiv.article-list div.img-link',
    bookUrl: 'a.img-link__link@href\n<js>\n' + normalizeAbsolute('https://russiancouncil.ru') + '\nresult;\n</js>',
    coverUrl: 'img@src||@js:"https://russiancouncil.ru/img/logo_en.jpg"',
    intro: 'a.img-link__link@text',
    kind: '"智库"',
    name: 'a.img-link__link@text'
  };
  s.ruleBookInfo.coverUrl = 'div.article-list div.img-link.0@style\n<js>\nvar m=String(result||"").match(/url\\(["\\\']?([^"\\\')]+)["\\\']?\\)/i);\nresult=m?m[1]:"https://russiancouncil.ru/img/logo_en.jpg";\n</js>';
  s.ruleToc = {
    chapterList: '-\ndiv.article-list div.img-link||article||main article',
    chapterName: 'a.img-link__link@text||h1@text||h2@text',
    chapterUrl: 'a.img-link__link@href\n<js>\nif(!result)result=baseUrl;\n' + normalizeAbsolute('https://russiancouncil.ru') + '\nresult;\n</js>',
    nextTocUrl: 'a.btn.mb_top.js-more@href\n<js>\n' + normalizeAbsolute('https://russiancouncil.ru') + '\nresult;\n</js>',
    updateTime: 'p.date@text'
  };
  s.header = '@js:\nvar map=source.getLoginInfoMap();\nvar proxyUrl=(map&&map.get("proxyUrl"))?map.get("proxyUrl"):"";\nJSON.stringify({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36","Referer":"https://russiancouncil.ru/","proxy":proxyUrl})';
  if (s.ruleContent && s.ruleContent.webJs) s.ruleContent.webJs = lightWebViewCleanup(['script','noscript','style','nav','aside','footer','div.row.mb20','div.fdreedf','main aside']);
}

/* MID: TSPD verification is a session event, not a per-page login popup. */
{
  const s = byUrl('https://mid.ru');
  s.loginCheckJs = String.raw`function midBody(response){
  try{return String(response.body());}catch(e){return String(response||"");}
}
function midChallenge(body){
  var t=String(body||"").toLowerCase();
  return t.indexOf("bobcmn")>=0||t.indexOf("what code is in the image")>=0||t.indexOf('id="ans"')>=0||t.indexOf("support id")>=0||t.indexOf("data processing... please, wait")>=0;
}
function midState(){
  var v="";
  try{v=cache.get("mid_tspd_state");}catch(e){}
  try{if(!v)v=java.get("mid_tspd_state");}catch(e){}
  return String(v||"");
}
function setMidState(v){
  try{cache.put("mid_tspd_state",v,1800);}catch(e){}
  try{java.put("mid_tspd_state",v);}catch(e){}
}
var midResponse=result,midHtml=midBody(midResponse);
if(midChallenge(midHtml)&&midState()!=="verified"){
  var midUrl=String(java.url||baseUrl||"");
  try{midUrl=decodeURIComponent(midUrl);}catch(e){}
  if(!/^https?:\/\//i.test(midUrl)||midUrl.indexOf("{{")>=0)throw "МИД验证地址无效";
  setMidState("verifying");
  midResponse=java.startBrowserAwait(midUrl,"МИД俄罗斯人工验证",true);
  if(midChallenge(midBody(midResponse))){setMidState("blocked");throw "МИД验证未解除反爬拦截";}
  setMidState("verified");
}else if(midChallenge(midHtml)&&midState()==="verified"){
  try{midResponse=java.getStrResponse();}catch(e){}
}
midResponse;`;
  s.ruleContent.content = '.text.article-content@html||.article-content@html||article .text@html||article@html||main@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||""));\nd.select("script,noscript,style,.masha_index,header,nav,aside,footer,.advertisement").remove();\nresult=""+d.body().html();\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult=String(result).replace(/src="\\//g,"src=\"https://mid.ru/").replace(/href="\\//g,"href=\"https://mid.ru/");\nresult;\n</js>';
}

/* CSSN: split each section page into the real subsection books instead of a synthetic single book. */
{
  const s = byUrl('https://cssn.cn/');
  s.ruleExplore = {
    author: '@js:"中国社会科学网"',
    bookList: '<js>\nvar defs=[];\nif(/\\/kgxc\\//i.test(String(baseUrl||""))) defs=[["/kgxc/kgxc_xccz/","现场传真"],["/kgxc/kgxc_kgxl/","考古新论"],["/kgxc/kgxc_mjft/","名家访谈"],["/kgxc/kgxc_kgdz/","考古队长"],["/kgxc/kgxc_kghs/","考古好书"],["/kgxc/kgxc_bwzc/","博物之窗"],["/kgxc/kgxc_kgsb/","考古随笔"],["/kgxc/kgxc_ggkg/","公共考古"]];\nelse if(/\\/zkzg\\//i.test(String(baseUrl||""))) defs=[["/zkzg/zkzg_zkfx/","智库风向"],["/zkzg/zkzg_zkxl/","智库新论"],["/zkzg/zkzg_zkyc/","智库观察"],["/zkzg/zkzg_gdzk/","各地智库"],["/zkzg/zkzg_zkpj/","智库评价"],["/zkzg/zkzg_skyskl/zkzg_skyskl_yw/","社科院所·动态"],["/zkzg/zkzg_skyskl/zkzg_skyskl_yc/","社科院所·成果"],["/zkzg/zkzg_skyskl/zkzg_skyskl_zt/","社科院所·专题"],["/skgz/","社科关注"],["/skyl/","社科要论"]];\nvar out="";for(var di=0;di<defs.length;di++)out+="<li><a href=\\\""+defs[di][0]+"\\\">"+defs[di][1]+"</a></li>";result=out;\n</js>\nli',
    bookUrl: 'a@href\n<js>\n' + normalizeAbsolute('https://www.cssn.cn') + '\nresult;\n</js>',
    coverUrl: 'img@src||@js:"https://www.cssn.cn/favicon.ico"',
    intro: '@js:"中国社会科学网栏目"',
    kind: '"社科"',
    name: 'a@text'
  };
  s.ruleToc = {
    chapterList: '-\n<js>\nvar d=org.jsoup.Jsoup.parse(String(result||""));\nvar as=d.select("a[href]"),out="",seen={};\nfor(var i=0;i<as.size();i++){var a=as.get(i),u=""+a.attr("href"),t=""+a.text();if(!/\\/\\d{6}\\/t\\d+_\\d+\\.shtml(?:[?#].*)?$/i.test(u)||!t.trim()||seen[u])continue;seen[u]=1;out+="<li>"+a.outerHtml()+"</li>";}result=out;\n</js>\nli',
    chapterName: 'a@text',
    chapterUrl: 'a@href\n<js>\n' + normalizeAbsolute('https://www.cssn.cn') + '\nresult;\n</js>',
    nextTocUrl: '<js>\nvar d=org.jsoup.Jsoup.parse(String(result||"")),as=d.select("a[href]"),u="";for(var i=0;i<as.size();i++){var a=as.get(i),t=""+a.text();if(/下一页|下页|next/i.test(t)){u=""+a.attr("href");break;}}if(u&&u.indexOf("http")!==0)u="https://www.cssn.cn"+u;result=u;\n</js>',
    updateTime: 'time@text||span@text'
  };
  s.ruleContent = {
    content: 'div.warp_center_content@html||article@html||main@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||""));\nd.select("script,noscript,style,.ywXqFxBox,nav,aside,footer").remove();\nresult=""+d.body().html();\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>',
    imageStyle: 'FULL',
    webJs: ''
  };
}

/* CCG: list cards are direct archive anchors, not .news-list li. */
{
  const s = byUrl('http://www.ccg.org.cn');
  s.ruleToc = {
    chapterList: 'a[href*="/archives/"]',
    chapterName: 'h5@text||@text',
    chapterUrl: '@href\n<js>\n' + normalizeAbsolute('http://www.ccg.org.cn') + '\nresult;\n</js>',
    nextTocUrl: '<js>\nvar d=org.jsoup.Jsoup.parse(String(result||""));var as=d.select(".page .page_list a[href]");var cur=0,m=String(baseUrl||"").match(/\\/page\\/(\\d+)/);if(m)cur=parseInt(m[1],10);var u="";for(var i=0;i<as.size();i++){var h=""+as.get(i).attr("href"),mm=h.match(/\\/page\\/(\\d+)/);if(mm&&parseInt(mm[1],10)>cur){u=h;break;}}if(u&&u.indexOf("http")!==0)u="http://www.ccg.org.cn"+u;result=u;\n</js>',
    updateTime: 'span@text||time@text'
  };
  s.ruleContent.content = "div.baogao-page1@html||main.huodong@html||article@html||.article-content@html||.content@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||\"\"));\nd.select(\"script,noscript,style,nav,aside,footer,.pinpai-bottom\").remove();\nresult=String(d.body().html()).replace(/src=\"\\/(UpFiles|UpDir|wp-content)\\//g,\"src=\\\"http://www.ccg.org.cn/$1/\").replace(/href=\"\\/archives\\//g,\"href=\\\"http://www.ccg.org.cn/archives/\");\nif(typeof TH===\"function\")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:\"none\",formula_selector:\"\"});\nresult;\n</js>";
}

/* Carnegie Moscow: publication cards use the clean-list/li.clearfix layout. */
{
  const s = byUrl('https://carnegie.ru/');
  s.ruleToc = {
    chapterList: '-\nul.clean-list.list-spaced--more > li.clearfix||div.commentary-landing div.push-down',
    chapterName: 'h4 a@text||h2 a@text',
    chapterUrl: 'h4 a@href||h2 a@href\n<js>\n' + normalizeAbsolute('https://carnegie.ru') + '\nresult;\n</js>',
    nextTocUrl: "a.page-links__next@href\n<js>\nvar r=result;if(Array.isArray(r))r=r[0]||\"\";var u=String(r||\"\").trim(),current=String(baseUrl||\"\"),m=current.match(/[?&](?:pageOn|page|p)=(\\d+)/i),page=m?parseInt(m[1],10):1;if(page>=10){result=\"\";}else{if(u.charAt(0)===\"[\"&&u.charAt(u.length-1)===\"]\")u=u.slice(1,-1).trim();if(u.indexOf(\"http\")!==0){if(u.indexOf(\"//\")===0)u=\"https:\"+u;else if(u.charAt(0)===\"/\")u=\"https://carnegie.ru\"+u;else u=\"https://carnegie.ru/\"+u;}result=u&&u!==current?u:\"\";}\n</js>",
    updateTime: 'ul@text&&p@text'
  };
  s.ruleBookInfo.coverUrl = 'ul.clean-list.list-spaced--more li.clearfix img@src||meta[property="og:image"]@content';
  s.ruleContent.content = 'div.commentary-detail@html||div.article-body@html||#printtext@html||main@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||""));\nd.select("script,noscript,style,nav,aside,footer,.related,.social-share,.newsletter").remove();\nresult=String(d.body().html());\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>';
  s.header = '@js:\nvar map=source.getLoginInfoMap();\nvar proxyUrl=(map&&map.get("proxyUrl"))?map.get("proxyUrl"):"";\nJSON.stringify({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36","Referer":"https://carnegie.ru/","proxy":proxyUrl})';
}

/* RAND (both enabled and disabled variants): increment the real start offset
 * deterministically and stop after ten 12-item pages. */
{
  const randNext = String.raw`<js>
var u=String(baseUrl||"");
var hash="",hp=u.indexOf("#");if(hp>=0){hash=u.substring(hp);u=u.substring(0,hp);}
var m=u.match(/[?&]start=(\d+)/),start=m?parseInt(m[1],10):0;
if(start>=108){result="";}else{
  var next=start+12;
  if(m)u=u.replace(/[?&]start=\d+/,function(x){return x.charAt(0)+"start="+next;});
  else u+=(u.indexOf("?")>=0?"&":"?")+"start="+next;
  result=u+hash;
}
result;
</js>`;
  for (const url of ['https://www.rand.org/', 'https://www.rand.org/pubs.html']) {
    const s = byUrl(url);
    s.ruleToc.nextTocUrl = randNext;
  }
}

/* State.gov covers: section imagery wins over the department seal, including
 * discovery/search synthetic books and the book-info page. */
{
  const s = byUrl('https://www.state.gov');
  const cover = String.raw`@js:
var DEFAULT="https://www.state.gov/wp-content/uploads/2025/01/Seal_only-1.png";
var d=org.jsoup.Jsoup.parse(String(result||""));
var img=d.select(".bureau-header__image img,.country-header__bg img,.wp-block-cover__image-background").first();
var u=img?String(img.attr("src")||img.attr("data-src")||img.attr("data-lazy-src")):"";
if(u&&u.indexOf("http")!==0){if(u.indexOf("//")===0)u="https:"+u;else if(u.charAt(0)==="/")u="https://www.state.gov"+u;}
u||DEFAULT;`;
  s.ruleExplore.coverUrl = cover;
  if (s.ruleSearch) s.ruleSearch.coverUrl = cover;
  s.ruleBookInfo.coverUrl = String.raw`@js:
var DEFAULT="https://www.state.gov/wp-content/uploads/2025/01/Seal_only-1.png";
var SPOKES="https://www.state.gov/bureaus-offices/under-secretary-for-public-diplomacy-and-public-affairs/bureau-of-global-public-affairs/office-of-the-spokesman/";
var d=org.jsoup.Jsoup.parse(String(result||""));
var img=d.select(".bureau-header__image img,.country-header__bg img,.wp-block-cover__image-background").first();
if(!img&&(String(baseUrl||"").indexOf("/press-releases/")>=0||String(baseUrl||"").indexOf("/department-press-briefings/")>=0)){var sd=org.jsoup.Jsoup.parse(String(java.ajax(SPOKES)));img=sd.select(".wp-block-cover__image-background").first();}
var u=img?String(img.attr("src")||img.attr("data-src")||img.attr("data-lazy-src")):"";
if(u&&u.indexOf("http")!==0){if(u.indexOf("//")===0)u="https:"+u;else if(u.charAt(0)==="/")u="https://www.state.gov"+u;}
u||DEFAULT;`;
}

/* Science: classify only actual Cloudflare challenges and refetch the same
 * URL after WebView verification; the former Springer proxy content rule was
 * unrelated to Science.org. */
{
  const s = byUrl('https://www.science.org/toc/science/current');
  s.loginCheckJs = String.raw`function scienceBody(response){try{return String(response.body());}catch(e){return String(response||"");}}
function scienceChallenge(body){
  var t=String(body||"").toLowerCase();
  return t.indexOf("just a moment")>=0||t.indexOf("performing security verification")>=0||t.indexOf("verify you are human")>=0||t.indexOf("enable javascript and cookies to continue")>=0||(t.indexOf("cf-chl-")>=0&&t.indexOf("challenge")>=0)||(t.indexOf("access denied")>=0&&t.indexOf("ray id")>=0);
}
var scienceResponse=result,scienceHtml=scienceBody(scienceResponse);
if(scienceChallenge(scienceHtml)){
  var scienceUrl=String(java.url||baseUrl||"");try{scienceUrl=decodeURIComponent(scienceUrl);}catch(e){}
  if(!/^https?:\/\//i.test(scienceUrl)||scienceUrl.indexOf("{{")>=0)throw "Science Cloudflare验证地址无效";
  scienceResponse=java.startBrowserAwait(scienceUrl,"Science Cloudflare验证",true);
  if(scienceChallenge(scienceBody(scienceResponse)))throw "Science Cloudflare验证未解除";
}
scienceResponse;`;
  s.ruleContent = {
    content: '@css:main@html||[data-extent="article-wrapper"]@html||article@html\n<js>\nvar d=org.jsoup.Jsoup.parseBodyFragment(String(result||""));\nd.select("script,noscript,style,nav,aside,footer,#donation-blackbud-modal,.meta-panel,.to-authors-affiliations,.core-self-citation,.info-panel,.pb-ad,.orcid-id,[data-core-nav=header],#backmatter,.core-collateral,template,div.audio-player,div.mb-2x,form.mb-4,.multi-search").remove();\nvar best=d.select("[data-extent=article-body],.article-body,.article-body__content,.article-content,#article-body").first();\nif(best)result=""+best.html();else result=""+d.body().html();\nif(typeof TH==="function")result=TH(result,java,cache,{remove_selector:[],extract_selector:[],formula_mode:"none",formula_selector:""});\nresult;\n</js>',
    imageStyle: 'FULL'
  };
}

fs.writeFileSync(path, JSON.stringify(sources, null, 2) + '\n');
console.log('updated target sources');
