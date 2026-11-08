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
const urlFixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/final-url-rules.json'),'utf8'));
const bookListUrlFixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/book-list-url-rules.json'),'utf8'));
function urlProgram(id,field){
  const f=urlFixtures.find(f=>f.id===id&&f.field===field);
  assert(f,'audited URL fixture '+id+' '+field);
  return m.simplifyFinalUrl(m.rulePrograms(f.value)[0],id,field);
}
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
test('native JS_PATTERN extraction covers CSS/XPath followed by @js without parsing remarks',()=>{
  const pattern=fs.readFileSync(path.join(ROOT,'legado/app/src/main/java/io/legado/app/constant/AppPattern.kt'),'utf8');
  assert(pattern.includes('Pattern.compile("<js>([\\\\w\\\\W]*?)</js>|@js:([\\\\w\\\\W]*)", Pattern.CASE_INSENSITIVE)'));
  const value='@css:a@href\n@js:\nif(result&&typeof TT==="function")result=TT(result,java,cache);result;';
  assert.equal(m.rulePrograms(value).length,1);
  const source=convert({bookSourceName:'Hybrid rule',bookSourceUrl:'https://hybrid.test',jsLib:loader(COMMIT),bookSourceComment:'notes\n@js:not valid JS',ruleToc:{chapterUrl:value}});
  assert(source.ruleToc.chapterUrl.startsWith('@css:a@href\n@js:'));
  assert(!source.ruleToc.chapterUrl.includes('typeof TT'));
  assert.equal(source.bookSourceComment,'notes\n@js:not valid JS');
  assert.equal(vm.runInNewContext(m.rulePrograms(source.ruleToc.chapterUrl)[0],{result:'title',java:{},cache:{},common:()=>({TT:v=>'translated:'+v})}),'translated:title');
  assert.deepEqual(convert(source),source);
  assert.deepEqual(m.fieldPrograms('One::@js:java.put("one",1);\nTwo::@js:java.put("two",2);','exploreUrl'),['java.put("one",1);','java.put("two",2);']);
  const mobile=local.find(s=>s.bookSourceUrl==='http://m.ndlib.cn'),fixed=convert(mobile);
  assert(!fixed.ruleSearch.bookUrl.includes('getSource\u200b')&&!fixed.ruleToc.chapterUrl.includes('getSource\u200b'));
  assert.equal(fixed.bookSourceComment,mobile.bookSourceComment);
});
test('all 22 audited final URL programs migrate by full fingerprints and leave user edits intact',()=>{
  assert.equal(urlFixtures.length,22);
  assert.equal(Object.keys(m.FINAL_URL_RULES).length,9);
  for(const f of urlFixtures){
    const original=m.rulePrograms(f.value)[0];
    assert.equal(hash(m.js(m.parse(original))),m.FINAL_URL_RULES[f.id][f.field][0],f.id+' '+f.field+' baseline');
    const output=m.simplifyFinalUrl(original,f.id,f.field);
    assert.notEqual(hash(m.js(m.parse(output))),hash(m.js(m.parse(original))),f.id+' '+f.field+' was simplified');
    assert.equal(m.simplifyFinalUrl(output,f.id,f.field),output);
    const edited=original+'\njava.log("user edit");';
    assert.equal(m.simplifyFinalUrl(edited,f.id,f.field),edited,'unknown additions survive');
    assert.equal(m.simplifyFinalUrl(original,'https://unrelated.test',f.field),original);
    assert.equal(m.simplifyFinalUrl(original,f.id,'ruleContent.content'),original,'request/body context is not final URL output');
  }
});
test('final book and chapter URLs keep relative paths, protocol-relative hosts, signed queries and URL options',()=>{
  const fields=[
    ['https://www.state.gov','ruleToc.chapterUrl'],['http://www.ccg.org.cn','ruleSearch.bookUrl'],
    ['http://www.ccg.org.cn','ruleToc.chapterUrl'],['https://cssn.cn/','ruleExplore.bookUrl'],
    ['https://cssn.cn/','ruleToc.chapterUrl'],['https://mid.ru','ruleToc.chapterUrl'],
    ['https://russiancouncil.ru/','ruleExplore.bookUrl'],['https://russiancouncil.ru/','ruleToc.chapterUrl'],
    ['https://russiancouncil.ru/','ruleToc.nextTocUrl'],['https://russtrat.ru','ruleToc.chapterUrl'],
    ['https://riss.ru','ruleToc.chapterUrl'],['https://navi.cnki.net/knavi/journals/KJGC/detail?uniplatform=NZKPT','ruleToc.chapterUrl']
  ];
  for(const[id,field]of fields)for(const raw of ['//cdn.example.test/a.svg?sig=a%2Fb+1','/root/path','../chapter/next.html','./next.html','next.html','https://other.test/x,{"webView":true,"headers":{"X-Sig":"a%2Fb+1"}}']){
    assert.equal(vm.runInNewContext(urlProgram(id,field),{result:raw,baseUrl:id}),raw,id+' '+field);
  }
  assert.equal(vm.runInNewContext(urlProgram('https://russiancouncil.ru/','ruleToc.chapterUrl'),{result:'',baseUrl:'https://russiancouncil.ru/current/'}),'https://russiancouncil.ru/current/','RIAC empty chapter fallback survives');
  assert.equal(vm.runInNewContext(urlProgram('https://www.state.gov','ruleToc.chapterUrl'),{result:' ../first.html\n/second.html ',baseUrl:''}),'../first.html','State first-line selection survives');
  for(const id of ['http://www.ccg.org.cn','https://cssn.cn/','https://russiancouncil.ru/']){
    const field=id==='https://cssn.cn/'?'ruleExplore.bookUrl':'ruleToc.chapterUrl';
    assert.equal(vm.runInNewContext(urlProgram(id,field),{result:[' [../next.html] '],baseUrl:id}),'../next.html','known list wrapper is retained');
  }
});
test('pagination caps, real query construction and filtering remain after removing repeated domains',()=>{
  const state=urlProgram('https://www.state.gov','ruleToc.nextTocUrl');
  assert.equal(vm.runInNewContext(state,{result:'[//cdn.example.test/page/9/]',baseUrl:'https://www.state.gov/bureaus/page/8/'}),'//cdn.example.test/page/9/');
  assert.equal(vm.runInNewContext(state,{result:'/bureaus/page/11/',baseUrl:'https://www.state.gov/bureaus/page/10/'}),'');
  const run=(id,input)=>JSON.parse(JSON.stringify(vm.runInNewContext(urlProgram(id,'ruleToc.nextTocUrl'),{result:input,baseUrl:id+'/analytics'})));
  assert.deepEqual(run('https://russtrat.ru',['page=2','/analytics?page=3','//cdn.example.test/a?page=4','page=2','no-pagination']),['/analytics?page=2','/analytics?page=3','//cdn.example.test/a?page=4']);
  assert.deepEqual(run('https://riss.ru',['/news/?PAGEN_1=2','//other.test/?PAGEN_1=3','/news/?PAGEN_1=2','no-pagination']),['/news/?PAGEN_1=2','//other.test/?PAGEN_1=3']);
});
test('cross-page covers, HTTP mirrors, API/CDN requests and edited pagination stay scoped',()=>{
  const cover=urlProgram('https://www.state.gov','ruleBookInfo.coverUrl');
  assert(cover.includes('imageBase = SPOKES;')&&cover.includes('common(java).resolveRequest(u, imageBase)'));
  assert(cover.includes('java.ajax(SPOKES)')&&cover.includes('book.coverUrl'),'request and cover fallbacks survive');
  const previous=m.js(m.transform(m.parse(cover),n=>{
    if(n.type==='IfStatement'&&m.js(n.test).startsWith('u && imageBase &&'))n.test=m.parse('if(u&&imageBase){}').body[0].test;
    return n;
  }));
  assert.equal(hash(previous),'6475d798a2f546a0a39a61380e00ce2a8bf8ab0f7afa4af9dd3daaab6e544dbe');
  assert.equal(m.simplifyFinalUrl(previous,'https://www.state.gov','ruleBookInfo.coverUrl'),cover,'our earlier cross-page program upgrades without losing self-contained data URIs');
  assert.equal(m.simplifyFinalUrl(previous+'\njava.log("user edit");','https://www.state.gov','ruleBookInfo.coverUrl'),previous+'\njava.log("user edit");');
  const ieee=urlProgram('https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=','ruleBookInfo.coverUrl');
  assert(ieee.includes('java.ajax(refer)')&&ieee.includes("src = elements[0].attr('src')"));
  assert(!ieee.includes("'https://ieeexplore.ieee.org' + elements.attr('src')"),'overwritten pure attr lookup is gone');
  for(const[id,fields]of [
    ['https://carnegie.ru/',['ruleToc.chapterUrl','ruleToc.nextTocUrl']],
    ['https://www.annualreviews.org',['ruleExplore.bookUrl','ruleToc.chapterUrl','ruleToc.nextTocUrl']],
    ['https://carnegieendowment.org',['ruleToc.chapterUrl']],
    ['https://carnegieendowment.org.back',['ruleToc.chapterUrl']],
    ['https://navi.cnki.net/knavi/journals/KJGC/detail?uniplatform=NZKPT',['ruleExplore.bookUrl','ruleExplore.coverUrl']],
    ['https://www.productplan.com',['ruleToc.nextTocUrl']]
  ]){
    const source=local.find(s=>s.bookSourceUrl===id);assert(source,'preserved source '+id);
    for(const field of fields){
      const[section,name]=field.split('.'),before=source[section][name],after=convert(source)[section][name];
      assert.deepEqual(m.rulePrograms(after).map(c=>m.js(m.parse(c))),m.rulePrograms(before).map(c=>m.js(m.parse(c))),id+' '+field+' JS semantics');
      const selectors=value=>value.replace(/<js>[\s\S]*?<\/js>|@js:[\s\S]*/gi,'<PROGRAM>');
      assert.equal(selectors(after),selectors(before),id+' '+field+' selector');
    }
  }
});
test('only IEEE explicitly enables usehtml; Science and the other formal sources keep their current mode',()=>{
  assert.deepEqual(sources.filter(s=>/ltUseHtmlBlocks|<usehtml\b/i.test(s.ruleContent?.content||'')).map(s=>s.bookSourceName),['IEEE']);
  const science=sources.find(s=>s.bookSourceName==='Science');
  assert(science.ruleContent.content.includes('common(java).TH(')&&!science.ruleContent.content.includes('ltUseHtmlBlocks'));
  assert(!science.loginUi.includes('"render"'),'no implicit HTML mode is added');
});
test('four audited book-list URL programs preserve deduplication and real page requests',()=>{
  assert.equal(bookListUrlFixtures.length,4);
  for(const f of bookListUrlFixtures){
    const original=m.rulePrograms(f.value)[0],output=m.simplifyBookListUrls(original,f.id,f.field);
    assert.equal(hash(m.js(m.parse(original))),m.BOOK_LIST_URL_RULES[f.id][0]);
    assert.notEqual(hash(m.js(m.parse(output))),hash(m.js(m.parse(original))));
    assert.equal(m.simplifyBookListUrls(output,f.id,f.field),output);
    const edited=original+'\njava.log("user edit");';
    assert.equal(m.simplifyBookListUrls(edited,f.id,f.field),edited);
    assert.equal(m.simplifyBookListUrls(original,f.id,'ruleContent.content'),original);
    if(f.id==='https://www.state.gov'){
      assert(output.includes('common(java).resolveRequest(href, baseUrl).toLowerCase()'),'country deduplication still compares resolved URLs');
      assert(output.includes('books.push([href, name])')&&!output.includes("href = 'https://www.state.gov' + href"),'final href stays raw');
      assert(output.includes('String(btn.text()).trim()')&&output.includes('String(a.text()).trim()'),'Jsoup labels support actual JS regex and string length');
    }else{
      assert(output.includes('yearurl = common(java).resolveRequest(yearurl, baseUrl'),'actual ajax gets an absolute request URL');
      assert(output.includes('java.ajax(yearurl)')&&!output.includes('basehost')&&!output.includes('startsWith("http")'));
      if(f.id==='http://www.qstheory.cn/')assert(output.includes('baseUrl || "http://www.qstheory.cn/"'),'only the existing missing-base fallback is retained');
    }
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
  const out=m.simplifyProgram(code,{});assert(out.includes('if (enabled)')&&!out.includes('typeof TH'));
  for(const enabled of [false,true]){
    let calls=0;
    const value=vm.runInNewContext(out,{enabled,result:'body',java:{},cache:{},common:()=>{calls++;return {TH:v=>'HTML:'+v};}});
    assert.equal(calls,enabled?1:0);assert.equal(value,enabled?'HTML:body':'body');
  }
  const error=new TypeError('original common load failure');
  assert.throws(()=>vm.runInNewContext(out,{enabled:true,result:'body',java:{},cache:{},common:()=>{throw error;}}),e=>e===error);
});
test('compound availability preserves evaluation order and values used by another comparison',()=>{
  for(const code of ['if((probe()&&typeof TT==="function")===true)result=TT(result,java,cache);result;',
    'if(probe()||typeof TT==="function")result=TT(result,java,cache);result;',
    'result=enabled&&"function"===typeof TT?TT(result,java,cache):result;result;']){
    const out=m.simplifyProgram(code,{}),events=[];
    assert(!out.includes('typeof TT'));
    const value=vm.runInNewContext(out,{enabled:true,result:'body',java:{},cache:{},probe:()=>{events.push('probe');return 'enabled';},common:()=>{events.push('common');return {TT:v=>'translated:'+v};}});
    assert.equal(value,'translated:body');assert.deepEqual(events,code.includes('probe()')?['probe','common']:['common']);
  }
  for(const code of ['if(typeof customHelper==="function"&&enabled)result=customHelper(result);result;',
    'if(typeof TT==="function"&&enabled)java.put("custom",result);result;'])assert(m.simplifyProgram(code,{}).includes('typeof'));
});
test('optional compound TH without a runtime keeps the condition and enables only images',()=>{
  const s=convert({bookSourceName:'Optional images',bookSourceUrl:'https://images.test',jsLib:'',ruleContent:{content:'<js>if(enabled&&typeof TH==="function")result=TH(result,java,cache,{remove_selector:["header"]});result;</js>'}});
  assert(s.ruleContent.content.includes('.ltPrepareImages(')&&!s.ruleContent.content.includes('.TH('));
  const code=s.ruleContent.content.match(/<js>([\s\S]*?)<\/js>/)[1];
  for(const enabled of [false,true]){
    let calls=0;
    const value=vm.runInNewContext(code,{enabled,result:'body',java:{},common:()=>{calls++;return {ltPrepareImages:v=>'images:'+v};}});
    assert.equal(calls,enabled?1:0);assert.equal(value,enabled?'images:body':'body');
  }
});
test('legacy TH checks around an already image-only helper do not disable phone image preparation',()=>{
  for(const lib of ['',loader(COMMIT)]){
    const source=convert({bookSourceName:'Existing phone images',bookSourceUrl:'https://images.test',jsLib:lib,
      ruleContent:{content:'<js>if(enabled&&typeof TH==="function")result=ltPrepareImages(result,java,{image_base_url:baseUrl});result;</js>'}});
    const code=source.ruleContent.content.match(/<js>([\s\S]*?)<\/js>/)[1];
    assert(!code.includes('typeof TH')&&!code.includes('.TH(')&&!code.includes('image_base_url'));
    for(const enabled of [false,true]){
      let calls=0;
      const value=vm.runInNewContext(code,{enabled,result:'<img src="//cdn.test/x.svg">',java:{},common:()=>({ltPrepareImages:v=>{calls++;return v;}})});
      assert.equal(calls,enabled?1:0);assert.equal(value,'<img src="//cdn.test/x.svg">');
    }
  }
});
test('the six actual guarded title rules execute without global TT and preserve Chinese/fallback gates',()=>{
  const fields=[['https://carnegie.ru/','ruleToc','chapterName'],['https://mid.ru','ruleExplore','name'],
    ['https://mid.ru','ruleToc','chapterName'],['http://sage.cnpereading.com/','ruleExplore','name'],
    ['http://sage.cnpereading.com/','ruleToc','chapterName'],['https://www.productplan.com','ruleExplore','name']];
  for(const [id,rule,field]of fields){
    const source=sources.find(s=>s.bookSourceUrl===id),value=source[rule][field];
    const code=value.startsWith('@js:')?value.slice(4):value.match(/<js>([\s\S]*?)<\/js>/)[1];
    assert(!code.includes('typeof TT'),id+' '+rule+'.'+field);
    for(const input of ['Guard title','中文标题','']){
      let calls=0;
      const context=vm.createContext({result:input,java:{},cache:{},book:{name:'中文测试书'},common:()=>({TT:v=>{calls++;return 'translated:'+v;}})});
      assert.equal(vm.runInContext('typeof TT',context),'undefined');
      const result=vm.runInContext(code,context),expected=input&&!(id==='https://mid.ru'&&input==='中文标题')?1:0;
      assert.equal(calls,expected,id+' '+rule+'.'+field+' '+input);
      assert.equal(result,expected?'translated:'+input:input||(id==='https://mid.ru'&&rule==='ruleExplore'?'中文测试书':''));
    }
    if(id==='https://mid.ru'&&rule==='ruleExplore')assert.equal(vm.runInNewContext(code,{result:'',book:null,java:{},cache:{},common:()=>({TT:v=>'translated:'+v})}),'translated:МИД России');
  }
});
test('all 108 converted sources have no remaining global availability checks for moved APIs',()=>{
  const names=new Set(['TT','TJ','TC','TH','ltPrepareImages','ltExtract','ltUseHtmlBlocks']),found=[];
  function scan(obj,source,path=''){
    for(const [key,value]of Object.entries(obj)){
      const field=path?path+'.'+key:key;
      if(value&&typeof value==='object'){scan(value,source,field);continue;}
      if(typeof value!=='string'||key==='bookSourceComment')continue;
      let programs=[];
      if(key==='jsLib')programs=[stripCommon(value)];
      else if(key==='loginUrl'&&value&&!/^https?:\/\//i.test(value))programs=[value];
      else if(key==='webJs'||key==='loginCheckJs')programs=[value];
      else programs=m.fieldPrograms(value,key);
      for(const code of programs)m.walk(m.parse(code),node=>{if(node.type==='UnaryExpression'&&node.operator==='typeof'&&node.argument.type==='Identifier'&&names.has(node.argument.name))found.push({source,field,helper:node.argument.name});});
    }
  }
  for(const source of sources)scan(source,source.bookSourceName);
  assert.deepEqual(found,[]);
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
test('audited nested Readability moves to common while its manual helper and strict errors survive',()=>{
  const archived=JSON.parse(fs.readFileSync(path.join(ROOT,'booksource/BookSource_X6_legado-E-2.json'),'utf8'));
  const pma=archived.find(s=>s.bookSourceUrl==='https://www.productmarketingalliance.com/search');
  const original=m.parse(stripCommon(pma.jsLib)).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='auto_clean_up');
  const old=m.js(original),strict=m.simplifyProgram(old,{}, {protectedNames:new Set(['auto_clean_up'])});
  for(const code of [old,strict]){
    const source=convert({bookSourceName:'Manual browser helper',bookSourceUrl:'https://pma.test',jsLib:code});
    assert(source.jsLib.includes('function auto_clean_up()'));
    assert(source.jsLib.includes('window.legadoCommon.browserReadable(document, true)'));
    assert(!source.jsLib.includes('Readability.prototype'));
    assert(Buffer.byteLength(source.jsLib)<1500);
    assert.deepEqual(convert(source),source);
    const next='fedcba9876543210fedcba9876543210fedcba98';
    const upgraded=m.simplifySource(source,next,runtime);
    assert(upgraded.jsLib.includes(next)&&!upgraded.jsLib.includes(COMMIT));
    const {scope,requests}=browserScope('({browserReadable:function(doc,strict){if(strict!==true)throw new Error("not strict");return {content:"clean article"};}})');
    vm.runInContext(source.jsLib,scope);
    assert.equal(vm.runInContext('auto_clean_up()',scope),undefined);
    assert.equal(vm.runInContext('auto_clean_up()',scope),undefined);
    assert.equal(requests.length,1);
    assert.equal(scope.document.body.innerHTML,'clean article');
    const error=new TypeError('original browser error');
    scope.window.legadoCommon.browserReadable=()=>{throw error;};
    assert.throws(()=>vm.runInContext('auto_clean_up()',scope),e=>e===error);
  }
  const edited=m.parse(old).body[0];edited.body.body.push(m.parse('window.customManualHook();').body[0]);
  const kept=convert({bookSourceName:'Edited helper',bookSourceUrl:'https://pma.test',jsLib:m.js(edited)});
  assert(kept.jsLib.includes('Readability.prototype')&&kept.jsLib.includes('window.customManualHook()'));
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
        for(const[field,value]of Object.entries(v||{}))if(field!=='webJs'&&(typeof value!=='string'||!m.rulePrograms(value).length)){
          if(i===25&&k==='ruleBookInfo'&&field==='coverUrl')continue;
          assert.deepEqual(sources[i][k][field],value,i+' '+k+'.'+field);
        }
      }else if(!editable.has(k)||['searchUrl','exploreUrl','header'].includes(k)&&typeof v==='string'&&!m.fieldPrograms(v,k).length)assert.deepEqual(sources[i][k],v,i+' '+k);
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
