'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {stripCommon, configuredLib, loader, build} = require('../migrate_shared_common');
const {simplifySource,runtimeData} = require('../simplify_source_js');
const {ROOT, IEEE, IDS, hash, readAllSources, saveWithReadback} = require('../shared_common_phone');
const {build: buildSmoke,browserRequest,NATIVE_WEBVIEW_CLIENT_TIMEOUT} = require('../shared_common_smoke');
const runtime = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-shared-runtime.js'), 'utf8');
const legacy = fs.readFileSync(path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'), 'utf8');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const cache = {get: () => null, put: () => {}};

function caller(lang, text = () => runtime) {
  let imports = 0;
  return {
    get: key => key === 'TARGET_LANG' ? lang : null,
    importScript: () => { imports++; return text(); },
    log: () => {},
    ajaxAll: urls => Array.from(urls, url => {
      const options = JSON.parse(url.slice(url.indexOf(',') + 1));
      return JSON.stringify(JSON.parse(options.body).map(v => ({translations: [{text:
        v.replace(/(<\|L\d+\|>\n)/g, '$1' + lang + ':')}]})));
    }),
    imports: () => imports
  };
}
function loaded(site = '') {
  const scope = vm.createContext({});
  vm.runInContext(site + '\n' + loader(COMMIT), scope);
  return scope;
}
function common() { const c = vm.createContext({}); vm.runInContext(runtime, c); return c; }

test('phone smoke safely embeds TeX and keeps a no-load control branch', () => {
  const capture = {status:200,host:'ieeexplore.ieee.org',body:String.raw`<tex-math>$\frac{{d\mathrm{snr}}}{1+x}$</tex-math>`};
  const {source,key} = buildSmoke(COMMIT,capture,'test-control');
  assert(source.jsLib.includes(COMMIT));
  assert(!source.jsLib.includes('function _ltString'));
  assert(!source.ruleContent.content.includes('{{'));
  assert(source.ruleContent.content.includes("String(result).indexOf('COMMON-CONTROL-')===0"));
  assert(source.ruleContent.content.includes("select('usehtml img').size()===0"));
  assert.equal(source.header,'{}');
  assert(key.startsWith('--http://127.0.0.1:1122/'));
});
test('native browser probe uses real URL webView/webJs and reports browser errors without a nested Java call',()=>{
  assert(NATIVE_WEBVIEW_CLIENT_TIMEOUT>=70000,'WS must outlive the native 60-second deadline');
  for(const control of [true,false]){
    const key=browserRequest(COMMIT,control),options=JSON.parse(key.slice(key.indexOf(',')+1));
    assert.equal(options.webView,true);
    assert(!options.bodyJs);
    assert(!options.timeout,'HTTP read timeout would not constrain Native WebView');
    assert(!options.webJs.includes('java.webView')&&!options.webJs.includes('java.importScript'));
    assert(options.webJs.includes('COMMON-CONTROL-WEBVIEW'));
    assert.equal(options.webJs.includes('XMLHttpRequest'),!control);
    new vm.Script(options.webJs);
  }
});

test('jsLib initializes without java and only first successful call loads common', () => {
  const c = loaded(), j = caller('zh');
  assert.equal(c.commonJs, undefined);
  assert.equal(j.imports(), 0);
  assert.equal(c.common(j).TT('Hello', j, cache), 'zh:Hello');
  assert.equal(c.common(j).TT('Again', j, cache), 'zh:Again');
  assert.equal(j.imports(), 1);
});
test('cached API uses fresh caller/language and TJ never translates URLs/IDs', () => {
  const c = loaded(), first = caller('zh'), second = caller('fr');
  c.common(first).TT('Hello', first, cache);
  const result = JSON.parse(c.common(second).TJ('{"name":"World","href":"https://example.test/x","id":"123"}', second, cache));
  assert.deepEqual(result, {name: 'fr:World', href: 'https://example.test/x', id: '123'});
  assert.equal(first.imports(), 1);
  assert.equal(second.imports(), 0);
});
for (const [kind, invalid] of [['empty', ''], ['syntax', 'function {'], ['no-result', 'var LEGADO_SHARED_RUNTIME="999";']]) {
  test('failed ' + kind + ' load is explicit, never half-cached, and can retry', () => {
    let text = invalid;
    const c = loaded(), j = caller('zh', () => text);
    assert.throws(() => c.common(j).TT('Hello', j, cache), /Unexpected token|undefined/);
    assert.equal(c.commonJs, undefined);
    text = runtime;
    assert.equal(c.common(j).TT('Hello', j, cache), 'zh:Hello');
    assert.equal(j.imports(), 2);
  });
}
test('importer and caller programming errors preserve their exact original exception',()=>{
  const c=loaded(),error=new TypeError('actual importer bug'),j=caller('zh',()=>{throw error;});
  assert.throws(()=>c.common(j),e=>e===error);
  assert.equal(c.commonJs,undefined);
  const api=common(),bad=caller('zh');bad.ajaxAll=()=>{throw error;};
  assert.throws(()=>api.TT('Hello',bad,cache),e=>e===error);
  assert.throws(()=>api.TJ('{broken',bad,cache),/JSON|Unexpected/);
});
test('literal JSON is safe for rule parsing and preserves every decoded option', () => {
  const c = common();
  const values = [String.raw`{{d\mathrm{snr}}}`, '{{1+2}}', '<js>throw Error("literal")</js>',
    '@js:literal @get:{literal}', 'A & B 😀\n第二行', String.raw`\u007b \\ "quoted"`];
  const options = {method: 'POST', headers: {Referer: 'https://example.test/{{literal}}'}, body: JSON.stringify(values)};
  const encoded = c.useHtmlRuleJson(options);
  assert.deepEqual(JSON.parse(encoded), options);
  assert(!/{{|<js>|@js:|@get:/i.test(encoded));
  const translate = JSON.parse(c._ltOptions(values));
  assert.deepEqual(JSON.parse(translate.body), values);
  assert.deepEqual(translate.headers, {Authorization: 'Bearer ', 'Content-Type': 'application/json'});
});
test('SVG alias keeps exact TeX but request js restores the real CodeCogs endpoint', () => {
  const c = common(), tex = String.raw`\frac{d\mathrm{snr}}{1+x}, a&b`;
  const value = c._ltFormulaSvgUrl(tex), split = value.indexOf(',{');
  const visible = value.slice(0, split), options = JSON.parse(value.slice(split + 1));
  assert(visible.startsWith('https://latex.codecogs.com/svg.latex.svg?'));
  assert.equal(decodeURIComponent(visible.slice(visible.indexOf('?') + 1)), tex);
  assert.equal(vm.runInNewContext(options.js, {result: visible}),
    'https://latex.codecogs.com/svg.latex?' + encodeURIComponent(tex));
});
test('AST removal preserves site declarations before and after embedded common', () => {
  const before = 'var extract_selector=["strong"];\nfunction siteBefore(){return "inline";}\n';
  const after = '\nvar siteTail=42;\nfunction siteAfter(){return siteTail;}\n';
  const stripped = stripCommon(before + legacy + after);
  assert(stripped.includes(before));
  assert(stripped.includes('function siteAfter(){return siteTail;}'));
  assert(!stripped.includes('function _ltString'));
  const result = configuredLib(before + legacy + after, {extract_selector: ['em'], toc_mode: 'html'}, COMMIT);
  const c = loaded();
  vm.runInContext(result, c);
  assert.equal(c.siteBefore(), 'inline');
  assert.equal(c.siteAfter(), 42);
  assert.deepEqual(Array.from(c.extract_selector), ['strong']);
  assert.equal(configuredLib(result, {toc_mode: 'html'}, COMMIT), result);
});
test('mixed common/site declarations fail rather than truncate source code', () => {
  assert.throws(() => stripCommon(legacy + '\nvar LEGADO_TRANSLATION_RUNTIME="3",privateAfter=7;'), /mixed common\/site/);
  assert.throws(() => loader('master'), /immutable Git commit/);
});
test('empty/custom libraries and site code after a network loader survive', () => {
  const custom = 'function datestr(page){return "page:"+page;}';
  for (const text of ['', custom, loader(COMMIT) + '\n' + custom]) {
    const converted = configuredLib(text, {}, COMMIT);
    assert(converted.endsWith(loader(COMMIT)));
    assert.equal(configuredLib(converted, {}, COMMIT), converted);
    const c = loaded();
    vm.runInContext(converted, c);
    assert.equal(c.commonJs, undefined);
    if (text) assert.equal(c.datestr(2), 'page:2');
  }
});
test('image, extraction and HTML APIs receive the current caller and explicit options', () => {
  const c = loaded(), j = caller('zh'), options = {image_anchor_mode:'href'};
  c.commonJs = {ltUseHtmlBlocks:(v,current,o) => [v,current,o], ltPrepareImages:(v,current,o) => [v,current,o], ltExtract:(v,current,s) => [v,current,s]};
  assert.deepEqual(c.common(j).ltUseHtmlBlocks('html',j,options), ['html',j,options]);
  assert.deepEqual(c.common(j).ltPrepareImages('html',j,options), ['html',j,options]);
  assert.deepEqual(c.common(j).ltExtract('html',j,['usehtml']), ['html',j,['usehtml']]);
});
test('srcset respects descriptors and data-URI commas', () => {
  const c = common(), data = 'data:image/png;base64,aGVsbG8=';
  assert.equal(c._ltSrcset('large.svg 2x, small.svg 1x'), 'large.svg');
  assert.equal(c._ltSrcset('small.svg 200w,large.svg 800w'), 'large.svg');
  assert.equal(c._ltSrcset(data + ' 1x'), data);
  assert.equal(c._ltSrcset(data + ' 1x, https://example.test/large.png 2x'), 'https://example.test/large.png');
});
test('protocol-relative image URLs inherit the source scheme without altering signed options',()=>{
  const c=common(),src='//cdn.example.test/image.svg?sig=a%2Fb+1,{"webView":true}';
  assert.equal(c._ltProtocolRelativeImageUrl(src,{image_base_url:'https://www.nature.com/article'}),'https:'+src);
  assert.equal(c._ltProtocolRelativeImageUrl(src,{image_base_url:'http://www.qstheory.cn/article'}),'http:'+src);
  assert.equal(c._ltProtocolRelativeImageUrl(src,{}),src);
  assert.equal(c._ltProtocolRelativeImageUrl('https://cdn.example.test/image.svg?sig=a%2Fb+1',{}),
    'https://cdn.example.test/image.svg?sig=a%2Fb+1');
});
test('login verification rechecks both redirect destinations and HTTP codes after verification',()=>{
  const c=common(),root='https://sage.cnpereading.com/';
  const response=(body,url,code=200)=>({body:()=>body,url:()=>url,code:()=>code});
  const j={url:root+'doi/full/123',startBrowserAwait:()=>response('<p>root page</p>',root)};
  const options={kind:'genericVerification',requestUrl:true,redirectHost:'sage\\.cnpereading\\.com',codes:[403]};
  assert.throws(()=>c._ltCheck(response('captcha',j.url),j,options),/验证后仍被阻断/);
  j.startBrowserAwait=()=>response('<p>article</p>',j.url,403);
  assert.throws(()=>c._ltCheck(response('captcha',j.url),j,options),/验证后仍被阻断/);
  const good=response('<p>article</p>',j.url);j.startBrowserAwait=()=>good;
  assert.equal(c._ltCheck(response('captcha',j.url),j,options),good);
});
test('a known I/O failure preserves text and logs, but an ordinary JS error cannot be masked',()=>{
  const c=common(),messages=[];
  class IOException {getClass(){return {getSimpleName:()=> 'IOException'};}}
  c.Packages={java:{io:{IOException}}};
  const j=caller('zh');j.log=v=>messages.push(v);j.ajaxAll=()=>{throw {javaException:new IOException()};};
  assert.equal(c.TT('original',j,cache),'original');
  assert(messages.length>0&&messages.every(m=>m==='Common service unavailable: IOException'));
  const error=new Error('actual bug');j.ajaxAll=()=>{throw error;};
  assert.throws(()=>c.TT('uncached',j,cache),e=>e===error);
});
test('literal thrown values, including null and undefined, stay the original failure',()=>{
  const c=loaded(),api=c.common(caller('en'));
  for(const value of [null,undefined,false,0,'literal bug']){
    let caught=false;
    try{api.networkError(value,null);}catch(error){caught=true;assert.equal(error,value);}
    assert(caught);
  }
});
test('service JSON accepts server data only and never hides caller conversion errors',()=>{
  const c=loaded(),api=c.common(caller('en'));
  assert.deepEqual(JSON.parse(JSON.stringify(api.serviceJson('{"title":"article"}'))),{title:'article'});
  assert.equal(api.serviceJson('<html>blocked</html>'),null);
  assert.equal(api.serviceJson('"broken'),null);
  assert.equal(api.serviceJson('"https://example.test/a.svg?sig=a%2Fb+1"'),'https://example.test/a.svg?sig=a%2Fb+1');
  const messages=[];
  assert.equal(api.serviceJson('<html>private server response</html>',{log:v=>messages.push(v)}),null);
  assert.deepEqual(messages,['Common service returned invalid JSON']);
  for(const ErrorType of [SyntaxError,TypeError]){
    const error=new ErrorType('caller conversion bug');
    assert.throws(()=>api.serviceJson({toString(){throw error;}}),e=>e===error);
  }
});
test('Next.js wire HTML decoding preserves raw TeX backslashes rather than interpreting them as newlines',()=>{
  const c=common(),html=String.raw`<article class="article-body"><p>x \neq y, d\mathrm{snr}, literal \n text</p></article>`;
  assert.equal(c._ltRscHtml('self.__next_f.push([1,'+JSON.stringify(html)+']);'),html);
  const row='1:'+JSON.stringify({body:html});
  assert.equal(c._ltRscHtml('self.__next_f.push([1,'+JSON.stringify(row)+']);'),html);
});
function ieeeFixture() {
  return {bookSourceUrl: IEEE, bookSourceName: 'IEEE', jsLib: 'var sitePrivate=7;\n' + legacy,
    ruleContent: {content: '<js>var ieeeMode=String(java.get("RENDER_MODE") || "").trim().toLowerCase() || "html";\nif(ieeeMode==="html")result=ltUseHtmlBlocks(String(result || ""),java,baseUrl);result;</js>'},
    loginUi: JSON.stringify([{name: 'SourceUrl', type: 'text'}, {name: '渲染模式', type: 'toggle', chars: ['TEXT', 'HTML'], default: 'HTML', action: 'setRenderMode()'}]),
    loginUrl: 'function setRenderMode(){var raw=result["渲染模式"];var s=String(raw === undefined || raw === null ? "" : raw).toUpperCase();java.put("RENDER_MODE",s.indexOf("HTML")>=0?"html":"text");}',
    header: 'unchanged', enabled: false, customOrder: 17};
}
test('IEEE keeps its HTML default and explicit TEXT choice through simplification', () => {
  const original = ieeeFixture(), converted = simplifySource(original,COMMIT,runtimeData());
  assert(converted.ruleContent.content.includes('.trim().toLowerCase() || "html"'));
  assert(converted.ruleContent.content.includes('common(java).ltUseHtmlBlocks(String(result || ""), java)'));
  const api=common();
  assert.equal(JSON.parse(vm.runInNewContext(converted.loginUi.slice(4),{common:()=>({loginUi:api._ltLoginUi}),java:{}}))[1].default, 'HTML');
  for (const [choice, expected] of [[undefined, 'html'], ['HTML', 'html'], ['TEXT', 'text']]) {
    let mode;
    api._ltSetRenderMode({put:(k,v)=>{mode=v;}},{'渲染模式':choice});
    assert.equal(mode, expected);
  }
  assert.equal(converted.ruleContent.webJs, original.ruleContent.webJs);
  assert.equal(converted.header, original.header);
  assert.equal(converted.enabled, false);
  for (const choice of [null,'',new String(''),'HTML',new String('TEXT')]) {
    const expected=String(choice||'').toLowerCase()==='text'?'body':'HTML:body';
    const scope=vm.createContext({result:'body',java:{get:()=>choice},common:()=>({ltUseHtmlBlocks:v=>'HTML:'+v})});
    vm.runInContext(converted.ruleContent.content.replace(/^<js>\s*|\s*<\/js>$/g,''),scope);
    assert.equal(scope.result,expected);
  }
});
test('all-source migration includes empty/custom libraries and preserves unrelated fields', () => {
  const ieee = ieeeFixture();
  const local = [ieee, ...IDS.slice(1).map(bookSourceUrl => ({bookSourceUrl, jsLib: legacy, toc_mode: 'html', ruleToc: {kept: 'yes'}})),
    {bookSourceUrl: 'https://custom.test', jsLib: 'function burl(p,r){return p+r;}', header: 'untouched', enabled: false},
    {bookSourceUrl: 'https://audio.test', jsLib: '', bookSourceType:1, ruleContent:{content:'@json:audio.url'}}];
  const phone = local.map(s => JSON.parse(JSON.stringify(s)));
  const result = build(local, phone, COMMIT);
  assert.equal(result.sources[3].header, local[3].header);
  assert.equal(result.sources[3].enabled, false);
  assert(result.sources[3].jsLib.includes('function burl('));
  assert.deepEqual(result.sources[4].ruleContent, local[4].ruleContent);
  assert.equal(result.sources[4].bookSourceType,1);
  assert.equal(result.candidates.length, local.length);
  assert.equal(result.sources[0].customOrder, 17);
  for (const source of result.sources) {
    assert(source.jsLib.includes('/' + COMMIT + '/booksource/runtime/legado-shared-runtime.js'));
    assert(!source.jsLib.includes('/sites/'));
    assert(!source.jsLib.includes('/* legado-translation-runtime v1'));
  }
});
test('the actual complete canonical inventory migrates and is idempotent', () => {
  const local = JSON.parse(fs.readFileSync(path.join(ROOT,'booksource/legado-book-sources-current.json'),'utf8'));
  const result = build(local,local,COMMIT);
  assert.equal(result.sources.length,local.length);
  assert(local.length >= 108, 'do not narrow the formal inventory');
  for (let i=0;i<local.length;i++) {
    const s=result.sources[i];
    assert.equal(s.bookSourceUrl,local[i].bookSourceUrl);
    assert.equal(s.enabled,local[i].enabled);
    assert.equal(s.bookSourceType,local[i].bookSourceType);
    assert(s.jsLib.endsWith(loader(COMMIT)));
    assert(!s.jsLib.includes('/* legado-translation-runtime'));
  }
  const again=build(result.sources,result.sources,COMMIT);
  assert.equal(hash(again.sources),hash(result.sources));
  for(const name of ['中国社会科学期刊','Test']) {
    const before=local.find(s=>s.bookSourceName===name),after=result.sources.find(s=>s.bookSourceName===name);
    assert(after.jsLib.includes('function '+(name==='Test'?'datestr':'burl')+'('));
  }
});
test('Nature/Qiushi use common image/extraction processing with the page scheme', () => {
  const local = JSON.parse(fs.readFileSync(path.join(ROOT,'booksource/legado-book-sources-current.json'),'utf8'));
  for (const name of ['Nature','求是网']) {
    const before=local.find(s=>s.bookSourceName===name),after=simplifySource(before,COMMIT,runtimeData()),r=after.ruleContent.content;
    assert.equal((r.match(/\bTH\(/g)||[]).length,(before.ruleContent.content.match(/\bTH\(/g)||[]).length);
    assert(!r.includes('<usehtml>'));
    assert(r.includes('image_base_url: String(baseUrl || "")'));
    if(name==='Nature') assert(r.includes('extract_selector: ["inline-formula tex-math"]'));
    else assert(r.includes('common(java).ltPrepareImages(')&&!r.includes('attributes().iterator()'));
    assert.deepEqual({...after.ruleContent,content:''},{...before.ruleContent,content:''});
  }
  const optional={jsLib:'',ruleContent:{content:'<js>if(typeof TH==="function")result=TH(result,java,cache,{remove_selector:["header"]});result;</js>'}};
  const converted=simplifySource(optional,COMMIT,runtimeData()).ruleContent.content;
  assert(converted.includes('ltPrepareImages(result, java)'));
  assert(!converted.includes('result=TH('));
});
test('bounded HTTP snapshot reads every full source and verifies a stable revision inventory', async () => {
  const values=Array.from({length:7},(_,i)=>({bookSourceUrl:'https://source.test/'+i,jsLib:'custom:'+i,enabled:i%2===0}));
  let inventories=0,gets=0,active=0,maxActive=0;
  const c={request:async route=>{
    if(route==='/getBookSourceCheckStates'){inventories++;return {states:values.map(v=>({bookSourceUrl:v.bookSourceUrl,sourceRevision:'same'}))};}
    assert(route.startsWith('/getBookSource?url='));
    gets++;active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
    return values.find(v=>v.bookSourceUrl===decodeURIComponent(route.split('url=')[1]));
  }};
  assert.deepEqual(await readAllSources(c),values);
  assert.equal(inventories,2);assert.equal(gets,values.length);assert(maxActive<=3);
  let n=0;
  const changed={request:async route=>route==='/getBookSourceCheckStates'
    ? {states:values.map(v=>({bookSourceUrl:v.bookSourceUrl,sourceRevision:String(++n)}))}
    : values.find(v=>v.bookSourceUrl===decodeURIComponent(route.split('url=')[1]))};
  await assert.rejects(readAllSources(changed),/revisions changed/);
});

test('save response failure is recovered only by exact readback, never a repeated POST', async () => {
  const before={bookSourceUrl:'https://example.test',jsLib:'old'},candidate={...before,jsLib:'new'},calls=[];
  const c={request:async(route,body)=>{
    calls.push({route,body});
    if(body!==undefined)throw new Error('HTTP 500');
    return candidate;
  }};
  assert.deepEqual(await saveWithReadback(c,candidate,before),candidate);
  assert.equal(calls.length,2);
  assert.equal(calls.filter(c=>c.body!==undefined).length,1);
  assert.equal(calls[1].route,'/getBookSource?url='+encodeURIComponent(candidate.bookSourceUrl));
});
for(const [state,expected] of [['old','unchanged'],['external','changed unexpectedly']]) {
  test('failed save with '+expected+' readback stops without overwriting or retry', async () => {
    const before={bookSourceUrl:'https://example.test',jsLib:'old'},candidate={...before,jsLib:'new'};
    let posts=0,gets=0;
    const c={request:async(route,body)=>{
      if(body!==undefined){posts++;throw new Error('HTTP 500');}
      gets++;return {...before,jsLib:state};
    }};
    await assert.rejects(saveWithReadback(c,candidate,before),new RegExp('readback '+expected+', no retry'));
    assert.equal(posts,1);assert.equal(gets,1);
  });
}
test('failed save and failed state query cannot be mistaken for successful deployment', async () => {
  const candidate={bookSourceUrl:'https://example.test',jsLib:'new'};
  let calls=0;
  const c={request:async()=>{calls++;throw new Error('HTTP 500');}};
  await assert.rejects(saveWithReadback(c,candidate,{...candidate,jsLib:'old'}),/state unknown, no retry/);
  assert.equal(calls,2);
});
test('actual Rhino, Jsoup and Kotlin rule parser verify closures, HTML and formula encoding', () => {
  const home = process.env.USEHTML_JAVA_HOME, engine = process.env.USEHTML_ENGINE_JAR;
  const jsoup = process.env.USEHTML_JSOUP_JAR, compiler = process.env.USEHTML_KOTLIN_LIB;
  assert(home && engine && jsoup && compiler, 'set USEHTML_JAVA_HOME, USEHTML_ENGINE_JAR, USEHTML_JSOUP_JAR and USEHTML_KOTLIN_LIB');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booksrc-common-test-'));
  const stdlib = path.join(compiler, 'kotlin-stdlib-2.0.21.jar');
  const annotations = fs.readdirSync(compiler).filter(n => /^annotations-.*\.jar$/.test(n)).map(n => path.join(compiler, n));
  function run(cmd, args) {
    const r = spawnSync(cmd, args, {encoding: 'utf8', timeout: 45000});
    assert.equal(r.status, 0, r.stderr || r.error?.message);
    return r;
  }
  const java = path.join(home, 'bin/java'), javac = path.join(home, 'bin/javac');
  // Compile the actual formatter and the native URL methods. Only unrelated
  // Android networking/logging dependencies are omitted in this JVM harness.
  const network=fs.readFileSync(path.join(ROOT,'legado/app/src/main/java/io/legado/app/utils/NetworkUtils.kt'),'utf8');
  const methods=network.slice(network.indexOf('    fun getAbsoluteURL(baseURL: String?'),network.indexOf('    fun getBaseUrl('));
  assert(methods.includes('fun getAbsoluteURL(baseURL: URL?'),'native URL method extraction failed');
  const extensions=fs.readFileSync(path.join(ROOT,'legado/app/src/main/java/io/legado/app/utils/StringExtensions.kt'),'utf8');
  const strings=extensions.slice(extensions.indexOf('fun String?.isAbsUrl()'),extensions.indexOf('fun String?.isJson()'));
  const pattern=fs.readFileSync(path.join(ROOT,'legado/app/src/main/java/io/legado/app/constant/AppPattern.kt'),'utf8').match(/val dataUriRegex = Regex\([^\n]+\)/)[0];
  const params=fs.readFileSync(path.join(ROOT,'legado/app/src/main/java/io/legado/app/model/analyzeRule/AnalyzeUrl.kt'),'utf8').match(/val paramPattern: Pattern = Pattern\.compile\([^\n]+\)/)[0];
  const chapterSource=fs.readFileSync(path.join(ROOT,'legado/app/src/main/java/io/legado/app/data/entities/BookChapter.kt'),'utf8');
  const chapterMethod=chapterSource.slice(chapterSource.indexOf('    fun getAbsoluteURL(): String {'),chapterSource.indexOf('    private fun ensureTitleMD5Init()'));
  assert(chapterMethod.includes('AnalyzeUrl.paramPattern.matcher(url)'),'actual chapter URL option handling extraction failed');
  const dependencies=path.join(dir,'FormatterDependencies.kt'),analyze=path.join(dir,'AnalyzeUrl.kt'),chapter=path.join(dir,'BookChapter.kt');
  fs.writeFileSync(dependencies,'package io.legado.app.utils\nimport java.net.URL\n'+pattern+'\n'+strings+'\nobject NetworkUtils {\n'+methods+'}\n'
    +'fun Exception.printOnDebug(){throw this}\nobject AppLog {fun put(message:String,error:Exception){throw error}}\n');
  fs.writeFileSync(analyze,'package io.legado.app.model.analyzeRule\nimport java.util.regex.Pattern\nobject AnalyzeUrl { '+params+' }\n');
  fs.writeFileSync(chapter,'package io.legado.app.data.entities\nimport io.legado.app.model.analyzeRule.AnalyzeUrl\nimport io.legado.app.utils.NetworkUtils\n'
    +'class BookChapter(var baseUrl:String,var url:String,var title:String,var isVolume:Boolean){\n'+chapterMethod+'}\n');
  const canonical=path.join(dir,'canonical-v3.json');
  const current=JSON.parse(fs.readFileSync(path.join(ROOT,'booksource/legado-book-sources-current.json'),'utf8'));
  fs.writeFileSync(canonical,JSON.stringify(build(current,current,COMMIT).sources),{mode:0o600});
  run(java, ['-cp', path.join(compiler, '*'), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect',
    '-jvm-target', '1.8', '-classpath', [stdlib, ...annotations].join(path.delimiter), '-d', dir,
    path.join(ROOT, 'legado/app/src/main/java/io/legado/app/model/analyzeRule/RuleAnalyzer.kt'),
    path.join(ROOT,'legado/app/src/main/java/io/legado/app/utils/HtmlFormatter.kt'),dependencies,analyze,chapter]);
  const cp = [dir, stdlib, jsoup, engine, ...annotations].join(path.delimiter);
  run(javac, ['-encoding', 'UTF-8', '-cp', cp, '-d', dir, path.join(ROOT, 'tools/tests/SharedCommonRuntime.java')]);
  const r = run(java, ['-cp', cp, 'SharedCommonRuntime',
    path.join(ROOT, 'booksource/runtime/legado-translation-runtime.js'),
    path.join(ROOT, 'booksource/runtime/legado-shared-runtime.js'),
    path.join(ROOT, 'booksource/runtime/legado-common-loader.js'),
    process.env.USEHTML_ENGINE_PACKAGE || 'org.htmlunit.corejs.javascript',
    canonical,
    ...(process.env.USEHTML_IEEE_CAPTURE ? [process.env.USEHTML_IEEE_CAPTURE] : [])]);
  const report = JSON.parse(r.stdout.trim());
  assert.equal(report.status, 'PASS');
  assert(report.checks >= 20);
  console.log(JSON.stringify({...report, buildArtifacts: dir}));
});
