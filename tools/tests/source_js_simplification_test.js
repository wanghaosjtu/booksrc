'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const m=require('../simplify_source_js');
const {stripCommon,loader,build:oldBuild}=require('../migrate_shared_common');
const {ROOT,hash}=require('../shared_common_phone');
const COMMIT='0123456789abcdef0123456789abcdef01234567';
const local=JSON.parse(fs.readFileSync(path.join(ROOT,'booksource/legado-book-sources-current.json'),'utf8'));
const runtime=m.runtimeData();
const convert=s=>m.simplifySource(s,COMMIT,runtime);
const sources=local.map(convert);
const scope=vm.createContext({});
const api=vm.runInContext(fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-shared-runtime.js'),'utf8'),scope);

test('the loader is exactly two lines, lazy, with no bridge/version/fallback framework',()=>{
  const code=loader(COMMIT).trimEnd();
  assert.equal(code.split('\n').length,2);
  assert(!/try|catch|__ltBuildCommon|__ltCommonApi|LEGADO_COMMON_VERSION/.test(code));
  assert(code.includes('eval(String(importer.importScript('));
});
test('rule interpolation round-trips exactly, including sentinel-like user text',()=>{
  for(const code of ['result="{{java.get(\"key\")}}";', 'result=`{{page}} / {{java.get("key")}}`;','result="LEGADO_TEMPLATE_0 {{key}}";']){
    const out=m.simplifyProgram(code,{});
    assert.deepEqual([...out.matchAll(/\{\{[\s\S]*?\}\}/g)].map(m=>m[0]),[...code.matchAll(/\{\{[\s\S]*?\}\}/g)].map(m=>m[0]));
    assert.equal(m.simplifyProgram(out,{}),out);
  }
});
test('dead literal data is removed, but getters, requests and object initializer effects remain',()=>{
  const code='var dead=12;var effects={value:java.ajax("https://example.test")};var lookup=missingName;result;';
  const out=m.simplifyProgram(code,{});
  assert(!out.includes('dead'));
  assert(out.includes('java.ajax')&&out.includes('missingName'));
  assert.throws(()=>vm.runInNewContext(out,{result:'body',java:{ajax:()=>''}}),/missingName/);
});
test('custom initialization is not collapsed as a standard HTML pipeline',()=>{
  const code='var doc=customEffect(result);result=TH(result,java,cache);result;';
  assert(m.simplifyProgram(code,{}, {content:true}).includes('customEffect(result)'));
});
test('nested and top-level local formula settings cannot overwrite literal call options',()=>{
  const globals={formula_mode:'codecogs',formula_selector:'math',extract_selector:[]};
  for(const code of ['var formula_mode="none";result=TH(result,java,cache,{formula_mode:"codecogs"});result;',
    'function apply(){var formula_mode="none";return TH(result,java,cache,{formula_mode:"codecogs"});}apply();']){
    const out=m.simplifyProgram(code,globals);
    assert(out.includes('formula_mode: "codecogs"'));
    const calls=[];
    vm.runInNewContext(out,{...globals,result:'body',java:{},cache:{},common:()=>({TH:(v,j,c,o)=>{calls.push(o.formula_mode);return v;}})});
    assert.deepEqual(calls,['codecogs']);
  }
});
test('only final HTML src/href prefix replacements are removed, not request resolution',()=>{
  const code=String.raw`result=String(result).replace(/src="\//g,'src="https://example.test/').replace(/href="\/news\//g,'href="https://example.test/news/');var response=java.connect(new Packages.java.net.URI(baseUrl).resolve(next).toString());result;`;
  const out=m.simplifyProgram(code,{});
  assert(!out.includes('.replace('));
  assert(out.includes('java.connect')&&out.includes('.resolve(next)'));
  assert.equal(vm.runInNewContext(out,{result:'<img src="//cdn.example.test/x.svg">',baseUrl:'base',next:'next',Packages:{java:{net:{URI:function(){this.resolve=()=>({toString:()=>''});}}}},java:{connect:()=>''}}),'<img src="//cdn.example.test/x.svg">');
});
test('optional old TH on a source without a runtime activates only image handling',()=>{
  const s=convert({bookSourceName:'Image only',bookSourceUrl:'https://image.test',jsLib:'',ruleContent:{content:'<js>if(typeof TH==="function")result=TH(result,java,cache,{remove_selector:["header"]});result;</js>'}});
  assert(s.ruleContent.content.includes('common(java).ltPrepareImages('));
  assert(!s.ruleContent.content.includes('.TH('));
});
test('conditional common availability checks do not lose another condition',()=>{
  const code='if(typeof TH==="function" && enabled)result=TH(result,java,cache);result;';
  assert(m.simplifyProgram(code,{}).includes('&& enabled'));
});
test('ternary checks for moved common helpers call the API and expose load errors',()=>{
  const code='result=typeof ltUseHtmlBlocks==="function"?ltUseHtmlBlocks(result,java,baseUrl):result;result;';
  const out=m.simplifyProgram(code,{});
  assert(!out.includes('typeof ltUseHtmlBlocks')&&!out.includes('baseUrl'));
  assert.equal(vm.runInNewContext(out,{result:'body',java:{},common:()=>({ltUseHtmlBlocks:v=>'HTML:'+v})}),'HTML:body');
  const error=new Error('common load failed');
  assert.throws(()=>vm.runInNewContext(out,{result:'body',java:{},common:()=>{throw error;}}),e=>e===error);
  const custom='result=typeof customHelper==="function"?customHelper(result):result;result;';
  assert(m.simplifyProgram(custom,{}).includes('typeof customHelper'));
});
test('optional ternary TH without an old runtime still enables only images',()=>{
  const s=convert({bookSourceName:'Image only',bookSourceUrl:'https://image.test',jsLib:'',ruleContent:{content:'<js>result=typeof TH==="function"?TH(result,java,cache,{remove_selector:["header"]}):result;result;</js>'}});
  assert(s.ruleContent.content.includes('common(java).ltPrepareImages('));
  assert(!s.ruleContent.content.includes('.TH(')&&!s.ruleContent.content.includes('typeof TH'));
});
test('the actual IEEE render tail defaults to HTML after globals move to common and respects TEXT',()=>{
  const source=sources.find(s=>s.bookSourceName==='IEEE');
  const code=source.ruleContent.content.match(/<js>([\s\S]*?)<\/js>/)[1];
  const tail=code.slice(code.indexOf('var ieeeMode ='));
  assert(!tail.includes('typeof ltUseHtmlBlocks'));
  for(const [choice,expected]of [[null,'HTML:body'],['html','HTML:body'],['text','body'],['TEXT','body']]){
    const scope=vm.createContext({result:'body',java:{get:()=>choice,log(){}},common:()=>({ltUseHtmlBlocks:v=>'HTML:'+v})});
    assert.equal(vm.runInContext('typeof ltUseHtmlBlocks',scope),'undefined');
    assert.equal(vm.runInContext(tail,scope),expected);
  }
});
test('unknown functions-only login/check scripts and composed actions remain intact',()=>{
  for(const code of ['function login(){java.put("custom","kept");}','function setTargetLang(){java.ajax("https://example.test");}function login(){setTargetLang();}']){
    const out=m.simplifyLogin(code);assert(out.includes('custom')||out.includes('java.ajax'));
  }
  assert(m.simplifyCheck('function cfBody(x){return x.body();}java.put("custom","kept");result;').includes('"custom"'));
  const action='setTargetLang(); java.put("custom","kept")';
  assert.equal(m.uiAction(action),action);
  assert.equal(m.simplifyUi('@js:buildCustomUi()',runtime),'@js:buildCustomUi();');
});
test('large custom or edited browser programs are retained, not replaced by size or function names',()=>{
  for(const body of ['window.customState = java.ajax("https://example.test");',
    'function translateFullPageInOneGo(){window.customState=42;} translateFullPageInOneGo();']){
    const code=body+'\n/*'+ 'x'.repeat(11000)+'*/\ndocument.body.outerHTML;';
    assert.equal(m.simplifyWeb(code,{remove_selector:['script']},COMMIT),code);
  }
});
function browserScope(body=fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-shared-runtime.js'),'utf8'),status=200){
  const requests=[];
  const scope=vm.createContext({window:{},document:{querySelectorAll:()=>[],body:{outerHTML:'<body>article</body>'}},XMLHttpRequest:function(){
    this.status=status;this.responseText=body;
    this.open=(...args)=>requests.push(args);this.send=value=>assert.equal(value,null);
  }});
  return {scope,requests};
}
test('browser common uses CORS HTTP without a Java bridge, caches success, and exposes load failures',()=>{
  const code=m.browserScript(COMMIT,{remove:['nav']});
  assert.equal(code.split('\n').length,2);
  assert(!code.includes('java.importScript'));
  const {scope,requests}=browserScope();
  assert.equal(vm.runInContext('typeof java',scope),'undefined');
  for(let i=0;i<2;i++)assert.equal(vm.runInContext(code,scope),'<body>article</body>');
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0],['GET','https://raw.githubusercontent.com/wanghaosjtu/booksrc/'+COMMIT+'/booksource/runtime/legado-shared-runtime.js',false]);
  for(const [body,status,error]of [['blocked',403,/Common runtime HTTP 403/],['function {',200,/Unexpected/]]){
    const {scope}=browserScope(body,status);
    assert.throws(()=>vm.runInContext(code,scope),error);
    assert.equal(scope.window.legadoCommon,undefined);
  }
});
test('audited browser loaders migrate whole programs, preserve options, and leave custom additions intact',()=>{
  const options={remove:['nav'],readable:true,title:true};
  const old='window.legadoCommon = window.legadoCommon || eval(String(java.importScript("https://raw.githubusercontent.com/wanghaosjtu/booksrc/'+COMMIT+'/booksource/runtime/legado-shared-runtime.js")));\nwindow.legadoCommon.webClean(document,'+JSON.stringify(options)+');';
  const code=m.browserScript(COMMIT,options);
  assert.equal(m.simplifyWeb(old,{},COMMIT),code);
  assert.equal(m.simplifyWeb(code,{},COMMIT),code);
  assert(m.simplifyWeb(old+'\nwindow.customState=42;',{},COMMIT).includes('window.customState = 42'));
  assert(m.simplifyWeb(code+'\nwindow.customState=42;',{},COMMIT).includes('window.customState = 42'));
});
test('empty and strict error catches expose the original error rather than fabricate empty data',()=>{
  for(const [code,options]of [['try{throw new TypeError("real bug");}catch(e){}',{}],['try{throw new TypeError("real bug");}catch(e){result="[]";}',{errorPolicy:'strict'}]]){
    const out=m.simplifyProgram(code,{},options);assert(!out.includes('catch'));
    assert.throws(()=>vm.runInNewContext(out),/real bug/);
  }
});
function ieeeNetworkFixture(){
  const source=sources.find(s=>s.bookSourceUrl==='https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=');
  const tree=m.parse(source.ruleContent.content.match(/<js>([\s\S]*?)<\/js>/)[1]);
  const helpers=[],requests=[];
  m.walk(tree,n=>{
    if(n.type==='FunctionDeclaration'&&n.id.name==='ieeeSignedValue')helpers.push(m.js(n));
    if(n.type==='TryStatement'&&n.handler&&/java\.ajax\(/.test(m.js(n.block)))requests.push(n);
  });
  assert.equal(requests.length,3,'full text, metadata, and signed-media requests');
  return {tree,helpers:helpers.join('\n'),requests};
}
function ieeeNetworkScope(helpers){
  const scope=vm.createContext({common:()=>api,java:{log(){}},cache:{get:()=>null,put(){}},
    ieeeDocumentId:'9737357',ieeeReferer:'https://ieeexplore.ieee.org/document/9737357',
    ieeeFullTextUrl:'https://example.test/fulltext',ieeeOptions:'',ieeeMetadataKey:'metadata',resource:'figure',key:'signed'});
  vm.runInContext(helpers,scope);
  return scope;
}
test('all IEEE request catches preserve original ajax and cache programming exceptions, including SyntaxError',()=>{
  const {requests,helpers}=ieeeNetworkFixture();
  for(const request of requests)for(const ErrorType of ['SyntaxError','TypeError']){
    const scope=ieeeNetworkScope(helpers),error=vm.runInContext('new '+ErrorType+'("IEEE ajax bug")',scope);
    scope.java.ajax=()=>{throw error;};
    assert.throws(()=>vm.runInContext('(function(){'+m.js(request)+'})()',scope),e=>e===error);
    if(/cache\.put\(/.test(m.js(request.block))){
      scope.java.ajax=()=>/ieeeSignedValue/.test(m.js(request.block))?'https://example.test/a.svg':'{"title":"article"}';
      scope.cache.put=()=>{throw error;};
      assert.throws(()=>vm.runInContext('(function(){'+m.js(request)+'})()',scope),e=>e===error);
    }
  }
});
test('IEEE invalid service JSON falls back, signed URLs stay exact, and corrupt cached JSON still throws',()=>{
  const {tree,requests,helpers}=ieeeNetworkFixture();
  for(const request of requests){
    const scope=ieeeNetworkScope(helpers);scope.java.ajax=()=> '"broken';
    assert.doesNotThrow(()=>vm.runInContext('(function(){'+m.js(request)+'})()',scope));
  }
  const scope=ieeeNetworkScope(helpers),signed='https://example.test/a.svg?sig=a%2Fb+1&expiry=23';
  assert.equal(scope.ieeeSignedValue(JSON.stringify(signed)),signed);
  assert.equal(scope.ieeeSignedValue(signed),signed);
  let metadata;
  m.walk(tree,n=>{if(n.type==='FunctionDeclaration'&&n.id.name==='ieeeArticleMetadata')metadata=n;});
  assert(metadata,'metadata helper exists inside the conditional article block');
  vm.runInContext(m.js(metadata),scope);scope.cache.get=()=>'{broken';
  assert.throws(()=>scope.ieeeArticleMetadata(),/JSON|Unexpected/);
});
test('all 108 identities and non-JS fields survive; local and phone objects are independent',()=>{
  assert.equal(sources.length,108);
  const editable=new Set(['jsLib','loginUrl','loginUi','loginCheckJs','searchUrl','exploreUrl','header']);
  for(let i=0;i<local.length;i++){
    assert.equal(sources[i].bookSourceUrl,local[i].bookSourceUrl);
    for(const[k,v]of Object.entries(local[i])){
      if(k.startsWith('rule')){
        for(const[field,value]of Object.entries(v||{}))if(field!=='webJs'&&(typeof value!=='string'||!/<js>|^@js:/.test(value))){
          if(i===25&&k==='ruleBookInfo'&&field==='coverUrl')continue;
          assert.deepEqual(sources[i][k][field],value,i+' '+k+'.'+field);
        }
      }else if(!editable.has(k)||['searchUrl','exploreUrl','header'].includes(k)&&typeof v==='string'&&!/<js>|^@js:/.test(v))assert.deepEqual(sources[i][k],v,i+' '+k);
    }
    if(/^https?:\/\//.test(local[i].loginUrl||''))assert.equal(sources[i].loginUrl,local[i].loginUrl);
    assert(sources[i].jsLib.endsWith(loader(COMMIT)));
    assert(!sources[i].jsLib.includes('image_base_url'));
    assert(!sources[i].ruleContent?.content?.includes('image_base_url'));
  }
  const phone=local.map(s=>({...s,bookSourceName:s.bookSourceName+' phone',loginInfo:'synthetic-private-login'}));
  const built=m.build(local,phone,COMMIT);
  assert.deepEqual(built.sources,sources);
  assert(built.candidates.every(s=>s.loginInfo==='synthetic-private-login'&&s.bookSourceName.endsWith(' phone')));
  assert(built.sources.every(s=>s.loginInfo!=='synthetic-private-login'));
  assert.equal(hash(oldBuild(local,local,COMMIT).sources),hash(sources));
});
test('the full conversion is idempotent and retains exported site helpers',()=>{
  assert.equal(hash(sources.map(convert)),hash(sources));
  for(const name of ['中国社会科学期刊','Test']){
    const s=sources.find(s=>s.bookSourceName===name);
    assert(s.jsLib.includes('function '+(name==='Test'?'datestr':'burl')+'('));
  }
  const s=convert({bookSourceName:'Custom',bookSourceUrl:'https://custom.test',jsLib:'function customDebug(){return 42;}'});
  assert(stripCommon(s.jsLib).includes('customDebug'));
});
test('all login UIs preserve row data/order/defaults and compile their exact actions',()=>{
  for(let i=0;i<local.length;i++){
    if(!local[i].loginUi)continue;
    const old=local[i].loginUi.startsWith('@js:')?JSON.parse(vm.runInNewContext(local[i].loginUi.slice(4),{common:()=>api,java:{}})):m.data(m.parse(local[i].loginUi).body[0].expression);
    const rows=JSON.parse(vm.runInNewContext(sources[i].loginUi.slice(4),{common:()=>api,java:{}}));
    assert.equal(rows.length,old.length,i+' row count');
    for(let k=0;k<rows.length;k++){
      assert.deepEqual({...rows[k],action:''},{...old[k],action:''},i+' row '+k);
      if(old[k].action)assert.equal(rows[k].action,m.uiAction(old[k].action));
      if(rows[k].action)new vm.Script(rows[k].action);
    }
  }
  assert.equal(sources.find(s=>s.bookSourceName==='Nature').loginUi,'@js:common(java).loginUi()');
});
test('Nature/Qiushi remain TEXT/image-only; protocol-relative images are left to the app',()=>{
  const nature=sources.find(s=>s.bookSourceName==='Nature').ruleContent.content;
  assert(nature.includes('common(java).TH(')&&nature.includes('notranslate_selector'));
  assert(nature.includes('inline-formula tex-math'));
  assert(!nature.includes('attributes().iterator()')&&!nature.includes('<usehtml>'));
  const qiushi=sources.find(s=>s.bookSourceName==='求是网').ruleContent.content;
  assert(qiushi.includes('common(java).ltPrepareImages(result, java)'));
  assert(!/\.TH\(|\.TC\(|<usehtml>|attributes\(\)/.test(qiushi));
});
test('known same-page hero and cover outputs stay relative; cross-page/protocol work and unknown edits stay intact',()=>{
  const carnegie=sources.find(s=>s.bookSourceName==='Carnegie Mosco');
  assert(carnegie.ruleContent.content.includes('var image = background[1].trim();'));
  assert(!carnegie.ruleContent.content.includes('.resolveRequest('));
  assert(carnegie.ruleToc.chapterUrl.includes('.resolveRequest('),'HTTP-only mirror normalization remains');
  const cover=sources.find(s=>s.bookSourceName==='中国社会科学期刊').ruleBookInfo.coverUrl;
  assert.equal((cover.match(/\.resolveRequest\(/g)||[]).length,1,'only the other-page portal cover is resolved');
  assert(cover.includes("covers.get(i).attr('src')"));
  const before=local.find(s=>s.bookSourceName==='Carnegie Mosco');
  const edited=before.ruleContent.content.replace('var image = background[1].trim();','var image = common(java).resolveRequest(background[1].trim(), url);')
    .replace('var hero =','java.log("user edit");\nvar hero =');
  assert(convert({...before,ruleContent:{...before.ruleContent,content:edited}}).ruleContent.content.includes('.resolveRequest('));
});
test('remaining old translators are gone and Oxford keeps metadata extraction before one TH',()=>{
  for(const s of sources)for(const[k,v]of Object.entries(s))if(k.startsWith('rule'))assert(!/translate\/auth|translatetext|api-edge\.cognitive/.test(JSON.stringify(v)),s.bookSourceName+' '+k);
  for(const url of ['https://academic.oup.com/','https://academic.oup.com/jcr']){
    const toc=sources.find(s=>s.bookSourceUrl===url).ruleToc.chapterList;
    assert.equal((toc.match(/\.TH\(/g)||[]).length,1);
    assert(toc.indexOf('accessAttributesJson')<toc.indexOf('.TH('));
    assert(!toc.includes('replace(/}}/'));
  }
  for(const name of ['Sage','ScienceDirect']){
    const content=sources.find(s=>s.bookSourceName===name).ruleContent.content;
    assert(content.includes('common(java).wirisSvg('));
    assert(!content.includes('function wirisSvgData'));
  }
});
