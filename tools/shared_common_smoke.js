#!/usr/bin/env node
'use strict';
// A fresh, task-owned source/book; never edits a pilot or an existing book.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createClient, changedPaths, summarizeDebug, errorDetails} = require('./usehtml_http_ws_client');
const {ROOT, privateDirectory, privateWrite, hash, single, readAllSources,testHost,sameHost} = require('./shared_common_phone');
const {loader} = require('./migrate_shared_common');
const {browserScript} = require('./simplify_source_js');
const HEALTH = 'http://127.0.0.1:1122/getJsSourceApiTokenRequired';
const VERSION = '3';
// AnalyzeUrl's timeout option controls HTTP reads, not BackstageWebView's
// native 60-second deadline. Leave time for that error to reach the WS client.
const NATIVE_WEBVIEW_CLIENT_TIMEOUT = 75000;
const guard = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-usehtml-rule-json.js'), 'utf8'), guard);
const safeJson = value => guard.useHtmlRuleJson(value);

function client(dir) {
  const host=testHost();
  if(dir&&fs.existsSync(path.join(dir,'smoke-state.json'))){
    const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
    assert(sameHost(host,state.host||'localhost'),'smoke evidence belongs to a different phone');
  }
  return createClient(host, {tokenFile: process.env.LEGADO_WEB_TOKEN_FILE,closeConnection:true,
    onMessage:value=>{for(const line of value.split('\n'))if(/COMMON-(?:SMOKE|DIAG)-STAGE /.test(line))console.log(line.slice(0,180));},
    debugTransport: process.env.LEGADO_WS_TRANSPORT === 'python' ? require('./usehtml_python_ws').debug : undefined});
}
function build(commit, capture, tag) {
  assert(/^[a-z0-9-]+$/.test(tag), 'safe unique smoke tag required');
  assert(capture.status === 200 && capture.host === 'ieeexplore.ieee.org', 'successful real IEEE capture required');
  const match = [...capture.body.matchAll(/<tex-math\b[^>]*>[\s\S]*?<\/tex-math>/g)]
    .find(item => item[0].replace(/\s+/g, '').includes('{{d\\mathrm{snr}'));
  assert(match, 'real derivative formula required');
  const fixture = '<div class="notranslate"><h1>COMMON-SMOKE-HEADING</h1>'
    + '<p>COMMON-SMOKE-START 公式原位：<inline-formula>' + match[0] + '</inline-formula></p>'
    + '<h2>COMMON-SMOKE-SECTION</h2><blockquote>COMMON-SMOKE-QUOTE</blockquote>'
    + '<p>COMMON-PATHS-A<img src="//cdn.example.test/a.svg">COMMON-PATHS-B'
    + '<img src="images/real.svg"><img src="/root.svg"></p>'
    + '<p>COMMON-SMOKE-END</p></div>';
  const jsLib = loader(commit);
  const content = `<js>
if (String(result).indexOf('COMMON-CONTROL-')===0) {
result=String(result);
} else {
java.log('COMMON-SMOKE-STAGE before-load');
var smokeLoadedInitially = !!commonJs;
var api=common(java);
var smokeHtml = api.TH(${safeJson(fixture)}, java, cache, {formula_mode:'codecogs',formula_selector:'inline-formula',notranslate_selector:['.notranslate']});
java.log('COMMON-SMOKE-STAGE after-load');
var smokeDoc = org.jsoup.Jsoup.parseBodyFragment(String(smokeHtml));
var smokeImage = smokeDoc.select('img').first();
var smokeSrc = smokeImage ? String(smokeImage.attr('src')) : '';
var smokeTex = smokeImage ? String(smokeImage.attr('alt')) : '';
var smokeCache = {get:function(){return null;},put:function(){}};
function smokeCaller(language) {
  return {get:function(){return language;},ajaxAll:function(urls){
    var out=[];
    for(var i=0;i<urls.length;i++) {
      var opt=JSON.parse(String(urls[i]).substring(String(urls[i]).indexOf(',')+1));
      var values=JSON.parse(opt.body);
      out.push(JSON.stringify([{translations:[{text:values[0].replace(/(<\\|L\\d+\\|>\\n)/g,'$1'+language+':')}]}]));
    }
    return out;
  }};
}
var smokeFirst = api.TT('first',smokeCaller('A'),smokeCache);
var smokeSecond = api.TT('second',smokeCaller('B'),smokeCache);
var smokeParserAccepted = true, smokeExactTex = true, smokeParserCalls = 0;
var smokeParserCaller = {get:function(){return 'en';},ajaxAll:function(urls){
  var out=[];
  for(var i=0;i<urls.length;i++) {
    var url=String(urls[i]),optText=url.substring(url.indexOf(',')+1);
    var values=JSON.parse(JSON.parse(optText).body);
    smokeExactTex = smokeExactTex && values[0].indexOf(smokeTex)>=0;
    smokeParserAccepted = smokeParserAccepted && optText.indexOf(String.fromCharCode(123,123))<0;
    var response=JSON.parse(String(java.ajax(${safeJson(HEALTH)}+','+optText.replace('"method":"post"','"method":"get"'))));
    smokeParserAccepted = smokeParserAccepted && response.isSuccess===true && typeof response.data==='boolean';
    smokeParserCalls++;
    out.push(JSON.stringify([{translations:[{text:values[0]}]}]));
  }
  return out;
}};
var smokeTexResult = api.TT(smokeTex,smokeParserCaller,smokeCache);
var smokeMode=String(java.get('RENDER_MODE')||'').trim().toLowerCase()||'html';
if(smokeMode==='html')smokeHtml = api.ltUseHtmlBlocks(String(smokeHtml),java);
var smokeUriDoc=org.jsoup.Jsoup.parseBodyFragment('<p>A<img src="//cdn.example.test/a.svg">B</p><img src="../lazy.svg" data-src="images/real.svg"><img src="/root.svg">');
api.ltPrepareImages(smokeUriDoc,java);
var smokeUris=smokeUriDoc.select('img');
var smokeImageUris=String(smokeUris.get(0).attr('src'))==='//cdn.example.test/a.svg'
  &&String(smokeUris.get(1).attr('src'))==='images/real.svg'
  &&String(smokeUris.get(2).attr('src'))==='/root.svg';
var smokeExtract=api.ltExtract('<usehtml><h3>Common extract</h3><p>A<img src="../x.svg">B</p></usehtml>',java,['usehtml']);
var smokeExtractDoc=org.jsoup.Jsoup.parseBodyFragment(String(smokeExtract));
var smokeHtmlExtraction=smokeExtractDoc.select('h3,img').size()===2&&smokeExtractDoc.select('usehtml').size()===0;
var smokeRepeat=api.ltUseHtmlBlocks(api.ltUseHtmlBlocks('<usehtml><h2>Repeat</h2><p>A<img src="../x.svg">B</p></usehtml>',java),java);
var smokeRepeatedHtml=org.jsoup.Jsoup.parseBodyFragment(String(smokeRepeat)).select('usehtml usehtml,usehtml img').size()===0;
var smokeUi=JSON.parse(api.loginUi(['language','render']));
var smokeSettings={},nativeForm=new Packages.java.util.HashMap();
nativeForm.put('翻译语言','繁体中文');nativeForm.put('渲染模式','TEXT');
api.login({put:function(k,v){smokeSettings[k]=v;}},nativeForm,{language:true,render:true});
var smokeLogin=smokeUi[1].default==='HTML'&&smokeSettings.TARGET_LANG==='zh-Hant'&&smokeSettings.RENDER_MODE==='text';
var smokeProgramErrors=false,smokeSelectorErrors=false;
try { var bad=smokeCaller('A');bad.ajaxAll=function(){throw new TypeError('COMMON-EXPECTED-BUG');};api.TT('uncached bug',bad,smokeCache); }
catch(e){smokeProgramErrors=e instanceof TypeError&&String(e).indexOf('COMMON-EXPECTED-BUG')>=0;}
try {api.TH('<p>bad selector</p>',java,smokeCache,{remove_selector:['[']});}
catch(e){smokeSelectorErrors=true;}
var smokeServiceJson=api.serviceJson('{"value":"kept"}').value==='kept'&&api.serviceJson('<html>blocked</html>')===null;
var smokeServiceConversionErrors=false,smokeConversionError=new SyntaxError('COMMON-EXPECTED-CONVERSION-BUG');
try{api.serviceJson({toString:function(){throw smokeConversionError;}});}
catch(e){smokeServiceConversionErrors=e===smokeConversionError;}
var smokePrimitiveErrors=false;
try{api.networkError(null,java);}catch(e){smokePrimitiveErrors=e===null;}
var smokeMetrics = {kind:'Android-pinned-common-short-smoke',initiallyLoaded:smokeLoadedInitially,
  loaded:!!commonJs,version:String(api.version),
  browserReadable:typeof api.browserReadable==='function',
  callerIsolation:smokeFirst==='A:first'&&smokeSecond==='B:second',
  siteFormulaConfig:smokeSrc.indexOf('/svg.latex.svg?')>=0&&smokeDoc.select('inline-formula').size()===0,
  parserAccepted:smokeParserAccepted,parserCalls:smokeParserCalls,exactTex:smokeExactTex&&smokeTexResult===smokeTex,
  svgAlias:/\\.svg$/.test(smokeSrc.split(',{')[0].split('?')[0]),
  imageUris:smokeImageUris,htmlExtraction:smokeHtmlExtraction,repeatedHtml:smokeRepeatedHtml,
  loginSettings:smokeLogin,programErrorsVisible:smokeProgramErrors,selectorErrorsVisible:smokeSelectorErrors,
  serviceJson:smokeServiceJson,serviceConversionErrors:smokeServiceConversionErrors,
  primitiveErrors:smokePrimitiveErrors,
  mode:smokeMode,headingsWrapped:String(smokeHtml).indexOf('<usehtml><h1>')>=0,
  imagesOutsideHtml:org.jsoup.Jsoup.parseBodyFragment(String(smokeHtml)).select('usehtml img').size()===0};
java.log('COMMON-SMOKE-METRICS '+JSON.stringify(smokeMetrics));
result=smokeHtml;
}
result;
</js>`;
  new vm.Script(content.replace(/^<js>\n/, '').replace(/\n<\/js>$/, ''));
  assert(!content.includes('{{'), 'literal TeX must not trigger rule interpolation');
  const source = {bookSourceUrl:'https://ieeexplore.ieee.org#common-smoke-'+tag,
    bookSourceName:'Common HTML/SVG 短验证 '+tag,bookSourceType:0,enabled:true,enabledExplore:false,
    concurrentRate:'1',header:'{}',jsLib,loginUi:'@js:common(java).loginUi(["language","render"])',
    loginUrl:'function login(){common(java).login(java,result,{language:true,render:true});}',
    ruleToc:{chapterList:'@js:[1]',chapterName:'@js:"COMMON-SMOKE-CHAPTER"',chapterUrl:'@js:'+JSON.stringify(HEALTH),nextTocUrl:''},
    ruleContent:{content,imageStyle:'FULL'}};
  return {source, key:'--'+HEALTH};
}

async function prepare(dir, commit, capturePath) {
  dir = privateDirectory(dir);
  const tag = 'v3-' + crypto.randomBytes(6).toString('hex');
  const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  const {source,key} = build(commit,capture,tag);
  const c=client(dir),before=await readAllSources(c);
  assert(!before.some(s=>s.bookSourceUrl===source.bookSourceUrl),'source collision');
  privateWrite(dir,'smoke-sources-before.json',before);
  privateWrite(dir,'smoke-source.json',source);
  privateWrite(dir,'smoke-state.json',{host:testHost(),tag,id:source.bookSourceUrl,key,commit});
  await c.request('/saveBookSource',source);
  const actual=await single(c,source.bookSourceUrl);
  for(const key of Object.keys(source))assert(!changedPaths(source[key],actual[key]).length,'source readback mismatch: '+key);
  privateWrite(dir,'smoke-source-readback.json',actual);
  return verifyPrepared(dir);
}
async function verifyPrepared(dir) {
  dir=privateDirectory(dir);
  const c=client(dir),before=JSON.parse(fs.readFileSync(path.join(dir,'smoke-sources-before.json'),'utf8'));
  const expected=JSON.parse(fs.readFileSync(path.join(dir,'smoke-source-readback.json'),'utf8'));
  const current=await single(c,expected.bookSourceUrl);
  assert(!changedPaths(current,expected).length,'owned smoke source changed since save');
  const after=await readAllSources(c);
  assert.equal(after.length,before.length+1,'unexpected source count while preparing smoke');
  for(const s of before)assert.equal(hash(after.find(a=>a.bookSourceUrl===s.bookSourceUrl)),hash(s),'unrelated source changed');
  const report={sourceCreated:true,readback:'verified',unrelatedSources:before.length};
  privateWrite(dir,'smoke-preparation-verified.json',report);
  return report;
}
async function smoke(dir) {
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const result=await client(dir).debug(state.id,state.key,55000);
  privateWrite(dir,'smoke-debug-'+Date.now()+'.json',result);
  const summary=summarizeDebug(result,state.key);
  const match=result.messages.join('\n').match(/COMMON-SMOKE-METRICS (\{[^\n]+\})/);
  const metrics=match?JSON.parse(match[1]):null;
  const passed=!summary.isError&&metrics&&metrics.loaded&&metrics.version===VERSION&&metrics.browserReadable&&metrics.callerIsolation
    &&metrics.siteFormulaConfig&&metrics.parserAccepted&&metrics.parserCalls>0&&metrics.exactTex
    &&metrics.svgAlias&&metrics.headingsWrapped&&metrics.imagesOutsideHtml
    &&metrics.imageUris&&metrics.htmlExtraction&&metrics.repeatedHtml
    &&metrics.loginSettings&&metrics.programErrorsVisible&&metrics.selectorErrorsVisible
    &&metrics.serviceJson&&metrics.serviceConversionErrors&&metrics.primitiveErrors;
  privateWrite(dir,'smoke-summary-'+Date.now()+'.json',{...summary,metrics,passed:!!passed});
  return {...summary,metrics,passed:!!passed};
}
async function refresh(dir,capturePath) {
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const old=JSON.parse(fs.readFileSync(path.join(dir,'smoke-source.json'),'utf8'));
  const c=client(dir),current=await single(c,state.id);
  assert(current,'owned smoke source missing');
  for(const key of Object.keys(old))assert(!changedPaths(old[key],current[key]).length,'owned source edited externally: '+key);
  const capture=JSON.parse(fs.readFileSync(capturePath,'utf8'));
  const {source}=build(state.commit,capture,state.tag);
  privateWrite(dir,'smoke-source-before-refresh-'+Date.now()+'.json',current);
  await c.request('/saveBookSource',source);
  const actual=await single(c,source.bookSourceUrl);
  for(const key of Object.keys(source))assert(!changedPaths(source[key],actual[key]).length,'refreshed readback mismatch: '+key);
  privateWrite(dir,'smoke-source-readback-before-refresh-'+Date.now()+'.json',JSON.parse(fs.readFileSync(path.join(dir,'smoke-source-readback.json'),'utf8')));
  fs.writeFileSync(path.join(dir,'smoke-source-readback.json'),JSON.stringify(actual,null,2)+'\n',{mode:0o600});
  fs.writeFileSync(path.join(dir,'smoke-source.json'),JSON.stringify(source,null,2)+'\n',{mode:0o600});
  return {refreshedOwnedSource:true,changes:changedPaths(old,source)};
}
async function diagnostic(dir,kind='network') {
  if(kind==='webview-control')return webView(dir,true);
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const url='https://raw.githubusercontent.com/wanghaosjtu/booksrc/'+state.commit+'/booksource/runtime/legado-shared-runtime.js';
  let code=`(function(){
    java.log('COMMON-DIAG-STAGE begin');
    var started=new Date().getTime(),metrics={kind:'phone-pinned-runtime-network',ok:false};
    try {
      var response=String(${kind==='import'?'java.importScript':'java.ajax'}(${safeJson(url)}+',{"timeout":10000}'));
      metrics.characters=response.length;
      metrics.expectedMarker=response.indexOf('/* legado-shared-runtime v3:')===0;
      metrics.ok=metrics.expectedMarker;
    } catch(error) { metrics.error=String(error).replace(/https?:\\/\\/\\S+/g,'[URL]').slice(0,250); }
    metrics.elapsedMs=new Date().getTime()-started;
    java.log('COMMON-DIAG-METRICS '+JSON.stringify(metrics));
    return 'COMMON-CONTROL-DIAG';
  })()`;
  let marker='COMMON-DIAG-METRICS';
  if(kind==='threads') {
    code=require('./usehtml_ieee_direct_probe').buildProbeCode('threads')
      .replace("return '<p class=\"notranslate\">UHV-THREAD-PROJECTION-END</p>'", "return 'COMMON-CONTROL-THREADS'");
    assert(code.includes('COMMON-CONTROL-THREADS'),'thread diagnostic must bypass runtime');
    marker='UHV-DIRECT-IEEE';
  } else if(kind==='cache') {
    code=`(function(){
      java.log('COMMON-DIAG-STAGE cache-begin');
      var started=new Date().getTime();
      var value=cache.get('common-runtime-smoke-readonly-missing');
      java.log('COMMON-DIAG-METRICS '+JSON.stringify({kind:'native-cache-read',ok:true,present:value!=null,elapsedMs:new Date().getTime()-started}));
      return 'COMMON-CONTROL-CACHE';
    })()`;
  } else if(kind==='ajax-eval'){
    code=`(function(){java.log('COMMON-DIAG-STAGE ajax-eval-begin');var started=new Date().getTime();var text=String(java.ajax(${safeJson(url)},10000));var api=eval(text);var doc=org.jsoup.Jsoup.parseBodyFragment(api.ltPrepareImages('<p>A<img src="//cdn.example.test/x.svg">B</p>',java));var jsonOk=api.serviceJson('{"value":"kept"}').value==='kept'&&api.serviceJson('<html>blocked</html>')===null;var original=new SyntaxError('COMMON-DIAG-CONVERSION-BUG'),conversionOk=false;try{api.serviceJson({toString:function(){throw original;}});}catch(e){conversionOk=e===original;}var primitiveOk=false;try{api.networkError(null,java);}catch(e){primitiveOk=e===null;}var metrics={kind:'phone-ajax-runtime-eval',ok:api.version==='3'&&String(doc.select('img').attr('src'))==='//cdn.example.test/x.svg'&&jsonOk&&conversionOk&&primitiveOk,serviceJson:jsonOk,serviceConversionErrors:conversionOk,primitiveErrors:primitiveOk,version:String(api.version),characters:text.length,elapsedMs:new Date().getTime()-started};java.log('COMMON-DIAG-METRICS '+JSON.stringify(metrics));return 'COMMON-CONTROL-AJAX-EVAL';})()`;
  } else assert(kind==='network'||kind==='import','known diagnostic required');
  const key='--'+HEALTH+','+safeJson({bodyJs:code,timeout:10000});
  const result=await client(dir).debug(state.id,key,25000);
  privateWrite(dir,'smoke-diag-'+Date.now()+'.json',result);
  const summary=summarizeDebug(result,key);
  const match=result.messages.join('\n').match(new RegExp(marker+' (\\{[^\\n]+\\})'));
  return {...summary,metrics:match?JSON.parse(match[1]):null};
}
function browserRequest(commit,control=false){
  const paragraph='COMMON-WEBVIEW-PARAGRAPH: a native browser prepares the document without translating or discarding the original article text. '.repeat(8);
  const html='<nav>COMMON-NAVIGATION-NOISE</nav><article class="article-body"><h1>COMMON-WEBVIEW-HEADING</h1><p>'+paragraph+'</p><p>'+paragraph+'</p></article><footer>COMMON-FOOTER-NOISE</footer>';
  // Exercise the same URL webView/webJs path as production, not a nested
  // java.webView call. Replace only this owned loopback test page's DOM.
  const script='(function(){try{document.head.innerHTML='+safeJson('<title>COMMON-WEBVIEW-TITLE</title>')+';document.body.innerHTML='+safeJson(html)+';\n'
    +(control?'':browserScript(commit,{readable:true,title:true,remove:['script','noscript','style','nav','footer']})+'\n')
    +'var text=document.body.textContent;var metrics={kind:'+JSON.stringify(control?'native-URL-WebView-no-library-local-http-only':'native-URL-WebView-shared-common')+',javaBridge:typeof java!=="undefined",'
    +(control?'':'version:String(window.legadoCommon.version),')
    +'paragraphs:document.querySelectorAll("p").length,title:document.title.indexOf("COMMON-WEBVIEW-TITLE")>=0,readable:text.indexOf("COMMON-WEBVIEW-PARAGRAPH")>=0,noiseRemoved:text.indexOf("COMMON-NAVIGATION-NOISE")<0&&text.indexOf("COMMON-FOOTER-NOISE")<0,noDuplicateTranslation:text.indexOf("a native browser prepares the document")>=0};'
    +'return "COMMON-CONTROL-WEBVIEW "+JSON.stringify(metrics);'
    +'}catch(error){return "COMMON-CONTROL-WEBVIEW "+JSON.stringify({kind:"native-URL-WebView-error",error:String(error)});}})()';
  return '--'+HEALTH+','+safeJson({webView:true,webJs:script});
}
async function webView(dir,control=false){
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const key=browserRequest(state.commit,control);
  const result=await client(dir).debug(state.id,key,NATIVE_WEBVIEW_CLIENT_TIMEOUT);
  privateWrite(dir,'smoke-webview-debug-'+Date.now()+'.json',result);
  const summary=summarizeDebug(result,key);
  const match=result.messages.join('\n').match(/COMMON-CONTROL-WEBVIEW (\{[^\n]+\})/);
  const metrics=match?JSON.parse(match[1]):null;
  const passed=!summary.isError&&metrics&&!metrics.error&&!metrics.javaBridge&&metrics.readable
    &&(control||metrics.version===VERSION&&metrics.paragraphs>=2&&metrics.title&&metrics.noiseRemoved&&metrics.noDuplicateTranslation);
  privateWrite(dir,'smoke-webview-summary-'+Date.now()+'.json',{...summary,metrics,passed:!!passed});
  return {...summary,metrics,passed:!!passed};
}
async function cachedBook(dir) {
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const source=JSON.parse(fs.readFileSync(path.join(dir,'smoke-source.json'),'utf8'));
  const c=client(dir),books=await c.request('/getBookshelf');
  const book={bookUrl:'https://ieeexplore.ieee.org/document/9737357/#common-smoke-'+state.tag,
    tocUrl:HEALTH,origin:state.id,originName:source.bookSourceName,
    name:'COMMON HTML SVG '+state.tag,author:'common-runtime-validation',
    canUpdate:false,totalChapterNum:0,durChapterIndex:0,durChapterPos:0};
  assert(!books.some(b=>b.bookUrl===book.bookUrl),'book collision');
  privateWrite(dir,'smoke-books-before.json',books);
  privateWrite(dir,'smoke-book.json',book);
  await c.request('/saveBook',book);
  const chapters=await c.request('/getChapterList?url='+encodeURIComponent(book.bookUrl),undefined,55000);
  assert(Array.isArray(chapters)&&chapters.length===1,'exactly one owned chapter required');
  privateWrite(dir,'smoke-chapters.json',chapters);
  const api='/getBookContent?url='+encodeURIComponent(book.bookUrl)+'&index='+chapters[0].index;
  const first=await c.request(api,undefined,55000),second=await c.request(api,undefined,15000);
  assert(typeof first==='string'&&first===second,'cached reread must match');
  assert(first.includes('COMMON-SMOKE-END')&&first.includes('<usehtml><h1>'),'cached semantic heading required');
  assert(first.includes('/svg.latex.svg?'),'cached SVG alias required');
  assert(first.includes('http://cdn.example.test/a.svg')&&first.includes('http://127.0.0.1:1122/images/real.svg')&&first.includes('http://127.0.0.1:1122/root.svg'),'native Formatter must resolve protocol-relative, relative and root image src');
  privateWrite(dir,'smoke-content.json',{content:first,rereadIdentical:true});
  return {created:true,chapters:chapters.length,characters:first.length,cachedRereadIdentical:true,nativeImageResolution:true};
}
async function image(dir) {
  dir=privateDirectory(dir);
  const c=client(dir),book=JSON.parse(fs.readFileSync(path.join(dir,'smoke-book.json'),'utf8'));
  const content=JSON.parse(fs.readFileSync(path.join(dir,'smoke-content.json'),'utf8')).content;
  // Match Legado's AppPattern.imgPattern, including raw quotes in URL options.
  const match=content.match(/<img[^>]*src="([^"]*(?:"[^>]+\})?)"[^>]*>/);
  assert(match,'cached formula image required');
  const src=match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  assert(src.startsWith('https://latex.codecogs.com/svg.latex.svg?'),'image must use SVG alias');
  assert(src.includes(',{"js":'),'complete native image options required');
  assert.equal(await c.request('/getJsSourceApiTokenRequired'),false,'token policy requires explicit support');
  const url='http://'+testHost()+':1122/image?url='+encodeURIComponent(book.bookUrl)+'&path='+encodeURIComponent(src)+'&width=640';
  const started=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(55000)});
  const type=response.headers.get('content-type')||'';
  assert(response.ok&&/^image\//.test(type),'image endpoint failed');
  const bytes=Buffer.from(await response.arrayBuffer());
  assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'expected App PNG rendering');
  const filename=path.join(dir,'smoke-formula-render-native-options.png');
  fs.writeFileSync(filename,bytes,{mode:0o600,flag:'wx'});
  const result={kind:'App-rendered-real-IEEE-formula-through-SVG-alias',nativeRequestOptions:true,httpStatus:response.status,contentType:type,
    elapsedMs:Date.now()-started,bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),
    sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  privateWrite(dir,'smoke-image-summary-native-options.json',result);
  return result;
}
async function textMode(dir) {
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const source=JSON.parse(fs.readFileSync(path.join(dir,'smoke-source.json'),'utf8'));
  const c=client(dir),before=await c.request('/getBookshelf');
  const book={bookUrl:'https://ieeexplore.ieee.org/document/9737357/#common-smoke-'+state.tag+'-text',
    tocUrl:HEALTH,origin:state.id,originName:source.bookSourceName,
    name:'COMMON TEXT SVG '+state.tag,author:'common-runtime-validation',canUpdate:false,
    totalChapterNum:0,durChapterIndex:0,durChapterPos:0,variable:JSON.stringify({RENDER_MODE:'text'})};
  assert(!before.some(b=>b.bookUrl===book.bookUrl),'text fixture collision');
  privateWrite(dir,'smoke-text-book.json',book);
  await c.request('/saveBook',book);
  const chapters=await c.request('/getChapterList?url='+encodeURIComponent(book.bookUrl),undefined,55000);
  assert(chapters.length===1,'single owned text chapter required');
  const api='/getBookContent?url='+encodeURIComponent(book.bookUrl)+'&index='+chapters[0].index;
  const first=await c.request(api,undefined,55000),second=await c.request(api,undefined,15000);
  assert(typeof first==='string'&&first===second,'TEXT cache reread must match');
  const result={kind:'native-book-explicit-TEXT-choice',readable:first.includes('COMMON-SMOKE-END'),
    noUsehtml:!first.includes('<usehtml>'),noHeadingTags:!/<h[1-6]\b/.test(first),
    svgAliasPreserved:first.includes('/svg.latex.svg?'),cachedRereadIdentical:true};
  privateWrite(dir,'smoke-text-content.json',{content:first});
  privateWrite(dir,'smoke-text-summary.json',result);
  const actual=(await c.request('/getBookshelf')).find(b=>b.bookUrl===book.bookUrl);
  assert(actual&&actual.origin===book.origin&&actual.name===book.name&&actual.author===book.author,'text fixture ownership changed');
  await c.request('/deleteBook',actual);
  assert(!(await c.request('/getBookshelf')).some(b=>b.bookUrl===book.bookUrl),'temporary TEXT fixture not removed');
  privateWrite(dir,'smoke-text-cleanup.json',{ownedTextBookRemoved:true,htmlFixturePreserved:true});
  assert(result.readable&&result.noUsehtml&&result.noHeadingTags&&result.svgAliasPreserved,'native TEXT mode failed');
  return {...result,ownedTextBookRemoved:true};
}
async function cleanup(dir,deploymentDirectory) {
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8')),c=client(dir);
  const bookFile=path.join(dir,'smoke-book.json');
  if(fs.existsSync(bookFile)){
    const owned=JSON.parse(fs.readFileSync(bookFile,'utf8'));
    const actual=(await c.request('/getBookshelf')).find(b=>b.bookUrl===owned.bookUrl);
    if(actual){
      assert(actual.origin===state.id&&actual.name===owned.name&&actual.author===owned.author,'owned book changed; do not delete');
      await c.request('/deleteBook',actual);
    }
  }
  const expected=JSON.parse(fs.readFileSync(path.join(dir,'smoke-source-readback.json'),'utf8'));
  const current=await single(c,state.id);
  assert(!changedPaths(expected,current).length,'owned smoke source changed; do not delete');
  await c.deleteSources([current]);
  const before=JSON.parse(fs.readFileSync(path.join(dir,'smoke-sources-before.json'),'utf8'));
  const after=await readAllSources(c);
  assert.equal(after.length,before.length,'smoke source cleanup did not restore source count');
  const expectedSources=new Map(before.map(s=>[s.bookSourceUrl,s]));
  let knownDeployments=0;
  if(deploymentDirectory){
    const root=privateDirectory(deploymentDirectory);
    const candidates=JSON.parse(fs.readFileSync(path.join(root,'phone-targets-candidate.json'),'utf8'));
    for(const file of fs.readdirSync(root).filter(f=>/^deployed-[0-9a-f]+\.json$/.test(f))){
      const record=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
      const candidate=candidates.find(s=>s.bookSourceUrl===record.id);
      assert(candidate&&hash(candidate)===record.candidateSha256,'cannot reconcile unknown deployment');
      assert(expectedSources.has(record.id),'deployed target missing from smoke baseline');
      expectedSources.set(record.id,candidate);knownDeployments++;
    }
  }
  for(const s of expectedSources.values())assert.equal(hash(after.find(a=>a.bookSourceUrl===s.bookSourceUrl)),hash(s),'source changed outside recorded deployments');
  if(fs.existsSync(bookFile)){
    const booksBefore=JSON.parse(fs.readFileSync(path.join(dir,'smoke-books-before.json'),'utf8'));
    const booksAfter=await c.request('/getBookshelf');
    for(const b of booksBefore){
      const a=booksAfter.find(a=>a.bookUrl===b.bookUrl);
      assert(a&&a.name===b.name&&a.origin===b.origin,'original book was removed or replaced');
    }
    privateWrite(dir,'smoke-original-books-preserved.json',{before:booksBefore.length,after:booksAfter.length,identitiesPreserved:true});
  }
  const report={ownedSmokeSourceRemoved:true,ownedHtmlBookRemoved:fs.existsSync(bookFile),
    verifiedOriginalSources:before.length,recordedDeploymentsPreserved:knownDeployments};
  privateWrite(dir,'smoke-cleanup.json',report);
  return report;
}
async function main() {
  const [operation,dir,...args]=process.argv.slice(2);
  assert(dir,'private evidence directory required');
  let result;
  if(operation==='prepare')result=await prepare(dir,args[0],args[1]);
  else if(operation==='verify-prepared')result=await verifyPrepared(dir);
  else if(operation==='smoke')result=await smoke(dir);
  else if(operation==='refresh')result=await refresh(dir,args[0]);
  else if(operation==='diagnostic')result=await diagnostic(dir,args[0]);
  else if(operation==='webview')result=await webView(dir);
  else if(operation==='book')result=await cachedBook(dir);
  else if(operation==='image')result=await image(dir);
  else if(operation==='text')result=await textMode(dir);
  else if(operation==='cleanup')result=await cleanup(dir,args[0]);
  else throw Error('unknown operation');
  console.log(JSON.stringify(result,null,2));
  if(result.passed===false)process.exitCode=1;
}
module.exports={build,client,safeJson,browserRequest,HEALTH,NATIVE_WEBVIEW_CLIENT_TIMEOUT};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify(errorDetails(error)));process.exitCode=1;});
