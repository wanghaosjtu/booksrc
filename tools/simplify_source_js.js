'use strict';
// Simplify source code, not source identity, credentials or site selectors.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const {generate} = require('astring');
const {stripCommon, loader} = require('./migrate_shared_common');
const {ROOT, hash, privateDirectory, privateWrite} = require('./shared_common_phone');
const APIS = new Set(['TT','TJ','TC','TH','ltPrepareImages','ltExtract','ltUseHtmlBlocks']);
const SETTINGS = new Set(['remove_selector','extract_selector','toc_mode','formula_mode','formula_selector']);
// Exact audited legacy bodies: a phone's edited helper is never guessed away.
const SIX_HELPERS = {
  sixAbsolute:'116363c8641bc4e79184c1ecf6c5ec348e8e089f28ead164934e1cb036d433ba',
  sixBody:'859df6791b58722fb7c6681eb74e1189003544347fd69a90bd607b3f53860f26',
  sixChallenge:'4cf4322c08cd4cf4cf3daf5269a6a6f17a8232d4fe1b911e6ad76707908aa1fb',
  sixClean:'0e4682f8f904a993d4741b2c9115b0d10780d7bfa6e4d31590475925f1872c77',
  sixFinish:'828ae11370c3904d6b34cede0ae53acad026f305ffdd506d440e8269d5d56253'
};
const LOGIN_SETTERS = {
  setTargetLang:'5c37375c1539a7803b41be92b2c40ee1c5136dc513b666ab15c4b9fb8861c89f',
  setRenderMode:'e7d1b12858b85779f12f53d2c204194496177f30a209f8a444288367e2813386',
  setTypesenseApiKey:'d92ff2d0bb35d6a6f56b0dba907f66b8fca7e1d70bf9b810d65d687e18092b57'
};
const BODY_HELPERS = {
  cnkiRespBody:'8d2e6b142569666fb4e7209f3a44a8294fc894c492e91a84eff085bd2d6e8370',
  incBody:'8639be60ab659e39e7111964ff5184f2e09a67063ebfcb1be0ce89e5ae207c8a',
  responseBody:'87d1c96a1dea199bcf38095e36c765879259977c4793bf053628207a1856c5c2'
};
// Stock Readability inside PMA's manual browser helper, before and after the
// earlier removal of empty catches. Unknown/edited helpers remain untouched.
const LEGACY_BROWSER_HELPERS = new Set([
  '2b739905459411bccd83b54ead7fdbb8664860e899adb61f1b76ecf771c8464c',
  'd95e9ba295a01a4f1e3f066ff59e936d47547939d9caaab2eed2f4f0a1eba61d'
]);
const CHECK_RULES = {
  '2073846b3b9eaf373568e9fe05c622f286dce1f8e1c355493387effbba67119a':{kind:'strictCloudflare',name:'Science',title:'Science Cloudflare验证'},
  'af4c67e5c4642722cb6e1aa596b49bc8bad10b40dc1505032e1728cc32d66130':{kind:'akamai',title:'站点人工验证'},
  'dbbcde268d40d887bccf9593dbc2305d8d13e69761523acb09bc74928234e695':{kind:'dom',name:'Carnegie',refetch:true},
  'ea0bf280a9b551ddb6a3992b07cb37e0c3a7524ad7d2b4d26f92676891833d0b':{kind:'imageCaptcha',name:'МИД俄罗斯'},
  'c794594078598fa5d6d5be4be68532be3018699dd3df64ad2467c877b5c1a02c':{name:'Cloudflare'},
  'a2d321b64b337f4519ed1bc49af041f645d7343b578fae53acdc766b3dba5c54':{kind:'iris',name:'IRIS',refetchAfterSuccess:true},
  'c87c3464bc7f27c358eb62300d1eefb953dab6e09de0e5e45ef768ddc0bf2f7d':{kind:'dom',name:'Annual Reviews',refetch:true},
  'bedc84bb0c4f26455fba62e4125bb86c76fc0c0cb5f4649b3be41be4be25a430':{kind:'chineseCaptcha',name:'CNKI'},
  '01af9c1d7dd489e0f696a1ff6415192032cb8534997dc1029dabbfdfb4dd7242':{kind:'waf',name:'IEEE',manual:true,codes:[202,403,418]},
  '82bdaf498a871cebe1b307a5d28f6ffdab666665a851bac3ca1d483f1a87b2f5':{kind:'genericVerification',name:'Sage',requestUrl:true,redirectHost:'sage\\.cnpereading\\.com'},
  '690ed848555059461678a66d09e2d9ebba942e3d6f444db203d72b612e592ed2':{kind:'fastly',name:'Springer',manual:true}
};
const TEST_HTML='result=TH(result,java,cache,{remove_selector:["script","div.btn-row.-page-actions","main aside"]});result;';
const OXFORD_HTML='result=TH(result,java,cache,{remove_selector:["script","[role=doc-biblioref]","noscript","style",".get-access",".ref-list","div.fig-orig"],extract_selector:["inline-formula tex-math"],notranslate_selector:["div.MathJax_Display"]});result;';
// Remaining old auth/whole-page translators, audited as complete programs.
// Unknown edits keep their code; no regex guessing about arbitrary functions.
const LEGACY_TRANSLATIONS={
  '063b305f9b166c09d2a7f323c078bf050a6cfca51b30bb5f5374dc0b26d7e0cb':'result=TH(result,java,cache);result;',
  'fd1b54259d012e8cdbb4d4468effa93421b284e7a1c8ab478b7dc46b54ed3fb9':'var title=String((Array.isArray(result)?result[0]:result)||"");result=TT(title.trim()?title:(book?book.name:"未知"),java,cache);result;',
  '885c6060024785fbcdcd61ae14ecb58ee326d8be4eb9579060485d96102d1601':'result=TT(result||"",java,cache);result=Array.isArray(result)?result.map(function(t){return t.trim()?"-"+t:t;}):(result.trim()?"-"+result:result);result;',
  'de5c3dad5dbd1fd05c4e234930feb393bd88d009ab2c7d1cdc1814ae70864478':'result=TT(result,java,cache);result;',
  '837ec992fbb50e6beb42d52e3c1e27582702b3de0e0ffd33483017cdb622e0fe':'result=TC(result,java,cache);result;',
  '18b93ff1c0f5c5b2f1628c28ed4249469e713a032603d8c194bcf5b3a21db6b5':TEST_HTML,
  '61cedf96ade800cf6dd175c3b5302258d0678dfc1482166f4ec024c2048a463e':OXFORD_HTML,
  '5ff5a4f894afbf73e032baef267caccc430f9250621996856192a874db5d466b':'result=TH(result,java,cache,{extract_selector:["inline-formula tex-math"],notranslate_selector:["div.MathJax_Display"]});result;'
};
// Audited complete browser programs from the 33 legacy sources. A large or
// translator-shaped script is not necessarily ours; retain unknown edits.
const LEGACY_WEB_PROGRAMS=new Set([
  'f6c0b9ae5ccf78b30a8953a2d9b6bd296851c94690921f1cdc4a2c4cac038199',
  '14ea1f73272d8836dfcd1b75dcea4c64409fceb080aca556f6e928da47ceb691',
  'a7c3d61041469c3930317d4f90c95bdbd3ae83e566e8dedac2b45caebe7e8f1d',
  '8621ed075a092d76554fa69d6d4fafa7e8a4ca47eaecef4626f8c8cf3740e34c',
  'a0e02fd90c6e38ec315e735d7d979996fc92cf68b17854fc9afd6536dd5c619e',
  '4d609baf976e04a72cdf6e1447cf9cab05c48c9fa5e36950b9d07ff44793bf66',
  '4a4e1c478b54159013df8a5581acb745ddb8888b4c612d6ed02a438de6d8f71b',
  '98d3f29e70d3442c41dd768b859d279d905dde73f5a65342e7846c4b9a203e63',
  'bccefeb92abc941f8449dd2f34278fd0e215dd0d15f84befa330a42082d01e9f',
  'b8185f1a3291807bdcbd5fc170dfb6242eba40bf1fbd23568b7469cc90bb3ae5',
  'd898fd944202bc066e39e9bcdfde922b601e049b6c2f53c0c162ab933e6b474e',
  'a0ea7ae22e54dd0dfa5965c1e68c3b9518147f9d3a8c44f4fb8e433235b35af2',
  'a31e8fc0ec27383860da5565d020640625ced993dde052b8c7f9e7481ba558c3',
  '6d7c07acf9f0eee8eb69ded2f1cd9d5187887be413a9a404a7f157239300129d',
  '3031ae86bfc6ca1119667e0e46da42b80c8d8909fb6180bce4c2edf10217cb0d',
  '0000ffbf7e16e31eec7f958f51bdb8f500021fe7537cd5a09ee3d81bb88dbcd7',
  'ff2fdf2349cd56e24e19812e1b775d04721d94e4415cb15ac8e202f59acb8b51',
  '00480250ff5c6fb7d3e92460825ec1b84f2526ad4ac1cbfb18011455fd8b23cd',
  'e3e1a87d2d309f92432b4335cf9cab145b2171e86109ae42f8ce20602355684a'
]);
function parse(code) {
  const templates=[];
  let prefix='LEGADO_TEMPLATE_';while(String(code).includes(prefix))prefix+='X';
  code=String(code).replace(/\{\{[\s\S]*?\}\}/g,rule=> {
    const name=prefix+templates.length;
    templates.push({name,rule});return name;
  });
  const tree=acorn.parse(code,{ecmaVersion:'latest',allowReturnOutsideFunction:true});
  if(templates.length)tree._templates=templates;
  return tree;
}
const expression = code => acorn.parseExpressionAt(code, 0, {ecmaVersion:'latest'});
function js(node) {
  let code=generate(node,{indent:'  '}).trimEnd();
  for(const {name,rule}of node._templates||[])code=code.replace(new RegExp('\\b'+name+'\\b','g'),()=>rule);
  return code;
}
const literal = value => expression(JSON.stringify(value));
const id = name => ({type:'Identifier',name});
const call = (name,args) => ({type:'CallExpression',callee:expression('common(java).'+name),arguments:args,optional:false});
const clone = value => JSON.parse(JSON.stringify(value));
function data(node) {
  if(node.type==='Literal')return node.value;
  if(node.type==='ArrayExpression')return node.elements.map(data);
  if(node.type==='ObjectExpression')return Object.fromEntries(node.properties.map(p => [p.key.name || p.key.value,data(p.value)]));
  throw new Error('expected literal source data, found '+node.type);
}
function walk(node,visit,parent,key) {
  if(!node || typeof node!=='object')return;
  visit(node,parent,key);
  for(const k of Object.keys(node)) {
    if(['start','end','loc','_templates'].includes(k))continue;
    const value=node[k];
    if(Array.isArray(value))value.forEach(v=>walk(v,visit,node,k));
    else if(value && typeof value==='object')walk(value,visit,node,k);
  }
}
function transform(node,fn,parent,key) {
  if(!node || typeof node!=='object')return node;
  for(const key of Object.keys(node)) {
    if(['start','end','loc','_templates'].includes(key))continue;
    const value=node[key];
    if(Array.isArray(value))node[key]=value.map(v=>transform(v,fn,node,key)).filter(v=>v!==null);
    else if(value && typeof value==='object')node[key]=transform(value,fn,node,key);
  }
  return fn(node,parent,key);
}
function reads(tree) {
  const names=new Set();
  walk(tree,(n,p,k)=>{
    if(n.type!=='Identifier')return;
    if(p && ((p.type==='MemberExpression' && k==='property' && !p.computed)
      || (p.type==='Property' && k==='key' && !p.computed)
      || ((p.type==='FunctionDeclaration'||p.type==='FunctionExpression') && (k==='id'||k==='params'))
      || (p.type==='VariableDeclarator' && k==='id')
      || (p.type==='AssignmentExpression' && k==='left' && p.operator==='=')))return;
    names.add(n.name);
  });
  return names;
}
function declaredSettings(library) {
  const values={remove_selector:[],extract_selector:[],formula_mode:'none',formula_selector:''};
  return constantSettings(parse(library),values);
}
function constantSettings(tree,defaults) {
  const values={...defaults};
  for(const n of tree.body) {
    if(n.type==='VariableDeclaration')for(const d of n.declarations) {
      if(SETTINGS.has(d.id.name)&&d.init) {
        try {values[d.id.name]=data(d.init);} catch { /* non-literal config is retained, never evaluated */ }
      }
    }
    if(n.type==='ExpressionStatement' && n.expression.type==='AssignmentExpression' && SETTINGS.has(n.expression.left.name)) {
      try {values[n.expression.left.name]=data(n.expression.right);} catch { /* dynamic config is retained */ }
    }
  }
  return values;
}
function commonOptions(node,defaults,globals) {
  if(!node)node={type:'ObjectExpression',properties:[]};
  assert.equal(node.type,'ObjectExpression','common options must be visible source data');
  node.properties=node.properties.filter(p=>(p.key.name||p.key.value)!=='image_base_url');
  for(const name of ['formula_mode','formula_selector','extract_selector']) {
    let p=node.properties.find(p=>(p.key.name||p.key.value)===name);
    const inherit=!p || (name!=='extract_selector'&&p.value.type==='Literal'&&!p.value.value);
    if(inherit && defaults[name] && (!(Array.isArray(defaults[name]))||defaults[name].length)) {
      if(p)p.value=literal(defaults[name]);
      else node.properties.push({type:'Property',key:id(name),value:literal(defaults[name]),kind:'init',method:false,shorthand:false,computed:false});
    }
  }
  node.properties=node.properties.filter(p=> {
    const name=p.key.name||p.key.value;
    return !((name==='formula_mode'&&p.value.type==='Literal'&&p.value.value==='none')
      ||(name==='formula_selector'&&p.value.type==='Literal'&&p.value.value==='')
      ||(name==='extract_selector'&&p.value.type==='ArrayExpression'&&!p.value.elements.length));
  });
  // Shared editable selector lists belong in the inline site settings once.
  for(const p of node.properties) {
    const name=p.key.name||p.key.value;
    if(SETTINGS.has(name)&&globals[name]!==undefined&&JSON.stringify(defaults[name])===JSON.stringify(globals[name])) {
      let value;
      try {value=data(p.value);} catch {continue;}
      if(JSON.stringify(value)===JSON.stringify(globals[name]) && ((Array.isArray(value)&&value.length)||typeof value==='string'&&value&&value!=='none'))p.value=id(name);
    }
  }
  return node;
}
function isCall(n,name) {return n?.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name===name;}
function statementCall(n) {return n.type==='ExpressionStatement'?n.expression:null;}
function memberCall(n,name) {return n?.type==='CallExpression'&&n.callee?.type==='MemberExpression'&&!n.callee.computed&&n.callee.property.name===name;}
function plainData(n) {
  if(!n)return true;
  if(n.type==='Literal')return true;
  if(n.type==='ArrayExpression')return n.elements.every(plainData);
  if(n.type==='ObjectExpression')return n.properties.every(p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&plainData(p.value));
  return false;
}
function standardInit(node){
  let safe=true;
  walk(node,n=>{
    if(n.type==='CallExpression'&&!(['String','parseInt'].includes(n.callee?.name)||n.callee?.type==='MemberExpression'&&['parse','parseBodyFragment','getLoginInfoMap','get','getVariable','toString'].includes(n.callee.property?.name)))safe=false;
    if(['NewExpression','AssignmentExpression','UpdateExpression','AwaitExpression','FunctionExpression'].includes(n.type))safe=false;
  });
  return safe;
}
function targetLangInit(n){
  const set=s=>s?.type==='ExpressionStatement'&&s.expression.type==='AssignmentExpression'&&s.expression.left.name==='TARGET_LANG'&&s.expression.right.type==='Literal'&&s.expression.right.value==='zh-Hans';
  if(set(n))return true;
  if(n.type!=='IfStatement'||n.alternate)return false;
  const body=n.consequent.type==='BlockStatement'&&n.consequent.body.length===1?n.consequent.body[0]:n.consequent;
  const test=n.test;
  return set(body)&&(/typeof TARGET_LANG/.test(js(test))||test.type==='BinaryExpression'&&['==','==='].includes(test.operator)&&test.left.name==='TARGET_LANG'&&test.right.value==='');
}
function bodyString(arg) {return {type:'CallExpression',callee:id('String'),arguments:[{type:'CallExpression',callee:{type:'MemberExpression',object:arg,property:id('body'),computed:false,optional:false},arguments:[],optional:false}],optional:false};}
function commonCall(n,name) {return memberCall(n,name)&&isCall(n.callee.object,'common');}
function shareSix(tree) {
  const owned=new Set(tree.body.filter(n=>n.type==='FunctionDeclaration'&&SIX_HELPERS[n.id.name]===hash(js(n))).map(n=>n.id.name));
  // An edited helper may still call another old helper. Preserve the family.
  if(tree.body.some(n=>n.type==='FunctionDeclaration'&&SIX_HELPERS[n.id.name]&&!owned.has(n.id.name)))return tree;
  tree.body=tree.body.filter(n=>!(n.type==='FunctionDeclaration'&&owned.has(n.id.name)));
  return transform(tree,(n,p)=> {
    if(n.type!=='CallExpression'||!owned.has(n.callee?.name))return n;
    const a=n.arguments;
    if(n.callee.name==='sixBody')return bodyString(a[0]);
    if(n.callee.name==='sixChallenge')return call('challenge',[a[0],literal('dom')]);
    if(n.callee.name==='sixClean')return call('clean',[a[0]]);
    if(n.callee.name==='sixFinish')return call('finish',[a[0],id('java'),id('cache'),a[2]]);
    // Same-page final src/href is native output; another asset base or a URL
    // used for filtering/requesting still needs resolution.
    if(memberCall(p,'attr')&&p.arguments[1]===n&&['src','href'].includes(p.arguments[0]?.value)&&a[1]?.name==='url')return a[0];
    return call('resolveRequest',a);
  });
}
function shareBodies(tree){
  const owned=new Set(tree.body.filter(n=>n.type==='FunctionDeclaration'&&BODY_HELPERS[n.id.name]===hash(js(n))).map(n=>n.id.name));
  return transform(tree,n=>{
    if(n.type!=='CallExpression'||!owned.has(n.callee?.name))return n;
    const arg=n.arguments[0];
    if(memberCall(arg,'startBrowserAwait')||memberCall(arg,'connect'))return bodyString(arg);
    if(memberCall(arg,'ajax')||memberCall(arg,'webView')||n.callee.name==='incBody'&&arg?.name==='result')return {type:'CallExpression',callee:id('String'),arguments:[{type:'LogicalExpression',operator:'||',left:arg,right:literal('')}],optional:false};
    return n;
  });
}
function shareWiris(tree){
  const known=['e0499efab7ff7c998a754eb72ac9cd1fe50a847c32755026a3b89b10be4e07af','1590833494bab00d8a25ac1f855d96132e3c42570eefa931db62ac876ca578dc'];
  if(!tree.body.some(n=>n.type==='FunctionDeclaration'&&n.id.name==='wirisSvgData'&&known.includes(hash(js(n)))))return tree;
  return transform(tree,n=>isCall(n,'wirisSvgData')?call('wirisSvg',[n.arguments[0],id('java')]):n);
}
function removeAbsoluteReplace(n) {
  if(!memberCall(n,'replace')||!n.arguments[0]?.regex||typeof n.arguments[1]?.value!=='string')return n;
  const m=n.arguments[0].regex.pattern.match(/^(src|href)=(["'])\\\/(.*)$/);
  if(!m)return n;
  const tail=m[3].replace(/\\\//g,'/');
  if(!/^[\w/-]*$/.test(tail))return n;
  const prefix=m[1]+'='+m[2];
  const replacement=n.arguments[1].value;
  if(replacement.startsWith(prefix)&&/^https?:\/\/[^/]+\//.test(replacement.slice(prefix.length))&&replacement.slice(prefix.length).replace(/^https?:\/\/[^/]+\//,'')===tail)return n.callee.object;
  return n;
}
function removeImageCleanup(tree) {
  const prepared=new Set();
  walk(tree,n=>{if(isCall(n,'ltPrepareImages')&&n.arguments[0]?.type==='Identifier')prepared.add(n.arguments[0].name);});
  return transform(tree,n=> {
    if(n.type!=='ExpressionStatement'||!memberCall(n.expression,'forEach'))return n;
    const select=n.expression.callee.object,fn=n.expression.arguments[0];
    if(!memberCall(select,'select')||!prepared.has(select.callee.object.name)||!/^img(?:\[|$)/.test(select.arguments[0]?.value||'')||fn?.type!=='FunctionExpression')return n;
    let safe=true;
    walk(fn.body,x=>{
      if(x.type==='CallExpression'&&!isCall(x,'String')&&(!memberCall(x,x.callee?.property?.name)||!['attributes','iterator','hasNext','next','getKey','remove'].includes(x.callee.property.name)))safe=false;
      if(x.type==='AssignmentExpression'||x.type==='ReturnStatement'||x.type==='ThrowStatement')safe=false;
    });
    return safe&&/getKey\(\)/.test(js(fn))&&/["']src["']/.test(js(fn))?null:n;
  });
}
const BOILERPLATE_VARS=new Set([...SETTINGS,'notranslate','TARGET_LANG','chunkSizefromSource','chunkSize','payloadlen','html','Jsoup','doc']);
function simpleContent(tree,defaults,globals) {
  const calls=[];walk(tree,n=>{if(isCall(n,'TH'))calls.push(n);});
  if(calls.length!==1)return null;
  const th=calls[0];
  let extract=defaults.extract_selector,extracts=false,anchor=false;
  for(const n of tree.body) {
    if(n.type==='VariableDeclaration' && n.declarations.every(d=>BOILERPLATE_VARS.has(d.id.name)&&standardInit(d.init)))continue;
    if(n.type==='FunctionDeclaration' && n.id.name==='replaceElementsWithText') {
      if(js(n).includes('.replace('))return null;
      continue;
    }
    if(targetLangInit(n))continue;
    const e=statementCall(n);
    if(!e)return null;
    if(e.type==='Identifier'&&e.name==='result')continue;
    if(e.type==='AssignmentExpression') {
      if(SETTINGS.has(e.left.name)&&standardInit(e.right))continue;
      if(e.left.name==='result' && (e.right===th || /^(doc\.(?:html|body)|String\(doc)/.test(js(e.right))))continue;
      return null;
    }
    if(e.type!=='CallExpression')return null;
    const code=js(e);
    if(/^java\.log\(/.test(code))continue;
    if(isCall(e,'ltExtract')||isCall(e,'replaceElementsWithText')) {extracts=true;continue;}
    if(isCall(e,'ltPrepareImages'))continue;
    if(/^remove_selector\.forEach\(/.test(code))continue;
    if(/^doc\.select\(/.test(code)&&/\.forEach\(/.test(code)) {
      if(/a:has\(img/.test(code)) {if(/img\.attr\(["']src["']\s*,/.test(code))anchor=true;continue;}
      if(/img(?:\[|["'])/.test(code)&&/attributes\(\)\.iterator\(\)/.test(code))continue;
      if(/span\[data-altimg\]/.test(code)&&/replaceWith\(/.test(code))continue;
    }
    return null;
  }
  const options=clone(th.arguments[3]||{type:'ObjectExpression',properties:[]});
  for(const p of options.properties)if(SETTINGS.has(p.key.name||p.key.value)&&p.value.type==='Identifier'&&p.value.name in defaults)p.value=literal(defaults[p.value.name]);
  if(extracts&&extract?.length) {
    const existing=options.properties.find(p=>(p.key.name||p.key.value)==='extract_selector');
    if(existing)existing.value=literal(extract);
    else options.properties.push({type:'Property',key:id('extract_selector'),value:literal(extract),kind:'init',method:false,shorthand:false,computed:false});
  }
  if(anchor&&!options.properties.some(p=>(p.key.name||p.key.value)==='image_anchor_mode'))options.properties.push({type:'Property',key:id('image_anchor_mode'),value:literal('href'),kind:'init',method:false,shorthand:false,computed:false});
  const o=commonOptions(options,defaults,globals),args=[id('result'),id('java'),id('cache')];
  if(o.properties.length)args.push(o);
  return parse('result = '+js(call('TH',args))+';\nresult;');
}
function simpleImages(tree) {
  const calls=[];walk(tree,n=>{if(isCall(n,'ltPrepareImages'))calls.push(n);});
  if(calls.length!==1||calls[0].arguments[0]?.name!=='doc')return null;
  for(const n of tree.body){
    if(n.type==='VariableDeclaration'&&n.declarations.every(d=>['html','Jsoup','doc'].includes(d.id.name)&&standardInit(d.init)))continue;
    const e=statementCall(n);if(!e)return null;
    if(e===calls[0]||e.type==='Identifier'&&e.name==='result')continue;
    if(e.type==='AssignmentExpression'&&['html','Jsoup'].includes(e.left.name)&&standardInit(e.right))continue;
    if(e.type==='AssignmentExpression'&&e.left.name==='result'&&/^doc\.(?:html|body)\(/.test(js(e.right)))continue;
    return null;
  }
  return parse('result = '+js(call('ltPrepareImages',[id('result'),id('java')]))+';\nresult;');
}
function removeDead(tree,protectedNames=new Set()) {
  let changed;
  do {
    changed=false;
    const used=reads(tree);
    tree=transform(tree,n=>{
      if(n.type==='FunctionDeclaration'&&!used.has(n.id.name)&&!protectedNames.has(n.id.name)) {changed=true;return null;}
      if(n.type==='VariableDeclaration') {
        const kept=n.declarations.filter(d=>{
          if(d.id.type!=='Identifier'||used.has(d.id.name)||protectedNames.has(d.id.name))return true;
          if(d.init&&!plainData(d.init))return true;
          changed=true;return false;
        });
        n.declarations=kept;if(!kept.length)return null;
      }
      if(n.type==='Program'||n.type==='BlockStatement') {
        n.body=n.body.filter((s,i,a)=>!(s.type==='EmptyStatement'||s.type==='ExpressionStatement'&&s.expression.type==='Identifier'&&s.expression.name==='result'&&i<a.length-1));
      }
      return n;
    });
  } while(changed);
  return tree;
}
function ieeeServiceJson(tree) {
  const signedBodies=new Set([
    '933a93039e2726532bf6f64b4ea62fa8fbc19301c85032f467805d05c99b1bde',
    '1b94e73914676023aa257f184a28c54949be953e5f1c6b2f71543c6ed45db396'
  ]);
  const jsonParse=n=>memberCall(n,'parse')&&n.callee.object.name==='JSON'&&n.arguments.length===1;
  return transform(tree,n=>{
    if(n.type==='FunctionDeclaration'&&n.id.name==='ieeeSignedValue'&&signedBodies.has(hash(js(n)))) {
      return transform(n,x=>jsonParse(x)?call('serviceJson',[...x.arguments,id('java')]):x);
    }
    if(jsonParse(n)) {
      let external=false;
      walk(n.arguments[0],x=>{if(memberCall(x,'ajax')&&x.callee.object.name==='java')external=true;});
      if(external)return call('serviceJson',[...n.arguments,id('java')]);
    }
    return n;
  });
}
function nativeOutputUrls(tree,kind) {
  const known={
    carnegieContent:{kind:'content',variable:'image',hash:'588201726f8c005576db3cf6ab541399c3370a049ad19c137cbcc32d06bec855'},
    journalCover:{kind:'cover',variable:'own',hash:'9e83c41f1f1b3c1bada9e7f70429da9219e43a0ae4cc68ad005c3cb01f38e662'}
  };
  return transform(tree,n=>{
    if(n.type!=='FunctionExpression'||!n.id)return n;
    const owned=known[n.id.name];
    if(!owned||owned.kind!==kind||hash(js(n))!==owned.hash)return n;
    return transform(n,x=>{
      if(x.type==='VariableDeclarator'&&x.id.name===owned.variable&&commonCall(x.init,'resolveRequest')&&x.init.arguments[1]?.name==='url'){
        const raw=x.init.arguments[0];
        x.init=kind==='cover'?expression('('+js(raw)+').trim()'):raw;
      }
      return x;
    });
  });
}
function simplifyProgram(code,globals,{content=false,nativeOutput='',protectedNames=new Set(),inactiveCommon=false,errorPolicy='empty'}={}) {
  let tree=parse(code);
  const replacement=LEGACY_TRANSLATIONS[hash(js(tree))];if(replacement)tree=parse(replacement);
  const defaults=constantSettings(tree,globals);
  const inlineGlobals={...globals};
  walk(tree,n=>{
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)){
      for(const p of n.params)if(SETTINGS.has(p.name))delete inlineGlobals[p.name];
      walk(n.body,x=>{if(x.type==='VariableDeclarator'&&SETTINGS.has(x.id.name))delete inlineGlobals[x.id.name];});
    }
  });
  tree=shareSix(tree);
  tree=shareBodies(tree);
  tree=shareWiris(tree);
  tree=transform(tree,removeAbsoluteReplace);
  tree=removeImageCleanup(tree);
  // These historical assignments do not control the common translator.
  const initializers=tree.body.filter(targetLangInit),without={...tree,body:tree.body.filter(n=>!initializers.includes(n))};
  if(!reads(without).has('TARGET_LANG'))tree=without;
  if(content)tree=simpleContent(tree,defaults,inlineGlobals)||simpleImages(tree)||tree;
  if(errorPolicy==='ieee')tree=ieeeServiceJson(tree);
  tree=transform(tree,n=>{
    if(n.type==='TryStatement'&&n.handler && !n.handler.body.body.length) {
      return n.finalizer?{...n,handler:null}:n.block;
    }
    if(n.type==='TryStatement'&&n.handler&&errorPolicy!=='empty'){
      const code=js(n.block),error=n.handler.param.name;
      if(errorPolicy==='ieee'&&/java\.ajax\(/.test(code)){
        const oldGuard=js(parse('if (!('+error+' instanceof SyntaxError)) common(java).networkError('+error+', java);').body[0]);
        n.handler.body.body=n.handler.body.body.map(s=>js(s)===oldGuard?s.consequent:s);
        if(!js(n.handler.body).includes('.networkError('))n.handler.body.body.unshift(...parse('common(java).networkError('+error+', java);').body);
        return n;
      }
      if(errorPolicy==='inc'&&/java\.webView\(/.test(code)){
        if(!js(n.handler.body).includes('.networkError('))n.handler.body.body.unshift(...parse('common(java).networkError('+error+', java);').body);
        return n;
      }
      return n.finalizer?{...n,handler:null}:n.block;
    }
    if(['IfStatement','ConditionalExpression'].includes(n.type)&&n.test.type==='BinaryExpression'&&['==','==='].includes(n.test.operator)&&n.test.left.type==='UnaryExpression'&&n.test.left.operator==='typeof'&&APIS.has(n.test.left.argument?.name)&&n.test.right.value==='function'){
      const conditional=n.type==='ConditionalExpression';
      if(conditional&&!commonCall(n.consequent,n.test.left.argument.name))return n;
      if(inactiveCommon&&n.test.left.argument.name==='TH'){
        const e=conditional?null:statementCall(n.consequent),th=conditional?n.consequent:e?.right;
        if((conditional||e?.type==='AssignmentExpression')&&commonCall(th,'TH')){
          const options=clone(th.arguments[3]||{type:'ObjectExpression',properties:[]});
          options.properties=options.properties.filter(p=>/^image_/.test(p.key.name||p.key.value));
          const images=call('ltPrepareImages',[th.arguments[0],id('java'),...(options.properties.length?[options]:[])]);
          if(conditional)return images;
          e.right=images;
          return n.consequent;
        }
        return n;
      }
      return n.consequent;
    }
    if(n.type==='CallExpression'&&APIS.has(n.callee?.name)) {
      const name=n.callee.name;
      if(name==='TH') {
        const opts=commonOptions(n.arguments[3],defaults,inlineGlobals);
        n.arguments=n.arguments.slice(0,3);if(opts.properties.length)n.arguments.push(opts);
      }
      if(name==='ltPrepareImages'&&n.arguments[2]?.type==='ObjectExpression')n.arguments[2].properties=n.arguments[2].properties.filter(p=>(p.key.name||p.key.value)!=='image_base_url');
      if(name==='ltUseHtmlBlocks'&&n.arguments.length>=3)n.arguments=[...n.arguments.slice(0,2),...n.arguments.slice(3)];
      n.callee=expression('common(java).'+name);
    }
    return n;
  });
  // The boilerplate's TARGET_LANG/chunk variables never control TT/TC/TH.
  const used=reads(tree);
  tree=transform(tree,n=> {
    if(n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.left.name==='TARGET_LANG'&&!used.has('TARGET_LANG'))return null;
    return n;
  });
  tree=removeDead(tree,protectedNames);
  if(nativeOutput)tree=nativeOutputUrls(tree,nativeOutput);
  return js(tree);
}
function segments(text,fn) {
  return text.replace(/<js>([\s\S]*?)<\/js>/gi,(_,code)=>'<js>\n'+fn(code)+'\n</js>');
}
function uiAction(action) {
  if(!action)return action;
  // Several old JSON arrays double-escaped the JS string delimiters. Decode
  // this exact legacy browser call, not arbitrary backslashes or URL bytes.
  const escaped=action.match(/^java\.startBrowser\(\\"([^"\r\n]*?)\\",\s*\\"([^"\r\n]*?)\\"\)$/);
  if(escaped)action='java.startBrowser('+JSON.stringify(escaped[1])+','+JSON.stringify(escaped[2])+')';
  const tree=parse(action);if(tree.body.length!==1)return action;
  const node=statementCall(tree.body[0]);
  if(isCall(node,'setTargetLang')&&!node.arguments.length)return 'common(java).setTargetLang(java,result)';
  if(isCall(node,'setRenderMode')&&!node.arguments.length)return 'common(java).setRenderMode(java,result)';
  if(!memberCall(node,'startBrowser')||node.callee.object.name!=='java')return action;
  const target=node.arguments[0];
  if(target?.type==='MemberExpression'&&!target.computed){
    if(target.object.name==='source'&&target.property.name==='bookSourceUrl')return "common(java).open(java,source,null,'source')";
    if(target.object.name==='book'&&['tocUrl','TocUrl'].includes(target.property.name))return "common(java).open(java,source,book,'toc')";
    if(target.object.name==='book'&&target.property.name==='bookUrl')return "common(java).open(java,source,book,'book')";
  }
  if(typeof target?.value==='string'&&node.arguments.length===2&&node.arguments[1].value==='')return 'common(java).open(java,source,null,'+JSON.stringify(target.value)+')';
  return action;
}
function simplifyUi(text,runtime) {
  if(!text)return text;
  if(/^@js:common\(java\)\.loginUi\(/.test(text))return text;
  if(text.startsWith('@js:'))return '@js:'+simplifyProgram(text.slice(4),{});
  const tree=parse(text.trim());assert(tree.body.length===1&&tree.body[0].type==='ExpressionStatement','login UI must be a single array expression');
  const value=data(tree.body[0].expression);
  assert(Array.isArray(value),'login UI must be an array');
  const presets=runtime.loginRows;
  const rows=value.map(row=>{
    row={...row};if(row.action)row.action=uiAction(row.action);
    const name=Object.keys(presets).find(k=>hash(presets[k])===hash(row));
    return name||row;
  });
  const standard=['language','source','toc','library','proxy'];
  return '@js:common(java).loginUi('+ (hash(rows)===hash(standard)?'':JSON.stringify(rows,null,2))+')';
}
function simplifyLogin(text) {
  if(!text || /^https?:\/\//i.test(text.trim()))return text;
  if(text.includes('common(java).login('))return text;
  const code=text.replace(/^\s*(?:<js>|@js:)/i,'').replace(/<\/js>\s*$/i,'');
  const tree=parse(code),names=new Set(tree.body.filter(n=>n.type==='FunctionDeclaration').map(n=>n.id.name));
  const options={};
  if(names.has('setTargetLang'))options.language=true;
  if(names.has('setRenderMode'))options.render=true;
  if(names.has('setTypesenseApiKey'))options.fields={TYPESENSE_API_KEY:'typesenseApiKey'};
  function standard(n){
    if(n.type!=='FunctionDeclaration')return false;
    if(LOGIN_SETTERS[n.id.name])return hash(js(n))===LOGIN_SETTERS[n.id.name];
    if(n.id.name!=='login')return false;
    return n.body.body.every(s=>s.type==='EmptyStatement'||s.type==='ExpressionStatement'&&(
      s.expression.type==='CallExpression'&&s.expression.callee.type==='Identifier'&&Object.hasOwn(LOGIN_SETTERS,s.expression.callee.name)&&names.has(s.expression.callee.name)&&!s.expression.arguments.length
      ||memberCall(s.expression,'log')&&s.expression.callee.object.name==='java'));
  }
  if(tree.body.every(standard)) {
    if(!Object.keys(options).length)return '';
    return 'function login() { common(java).login(java,result,'+JSON.stringify(options)+'); }';
  }
  // Do not infer that a functions-only login script is boilerplate. Unknown
  // setters/actions or edited login behavior must remain available to the UI.
  return simplifyProgram(code,{}, {protectedNames:names});
}
function simplifyCheck(text) {
  if(!text)return text;
  if(/^common\(java\)\.check\(/.test(text))return text;
  const tree=parse(text),options=CHECK_RULES[hash(js(tree))];
  if(!options)return simplifyProgram(text,{}, {protectedNames:new Set(tree.body.filter(n=>n.type==='FunctionDeclaration').map(n=>n.id.name))});
  return 'common(java).check(result,java,'+JSON.stringify(options)+');';
}
function browserLoader(commit) {
  assert(/^[0-9a-f]{40}$/.test(commit),'full immutable common SHA required');
  const url='https://raw.githubusercontent.com/wanghaosjtu/booksrc/'+commit+'/booksource/runtime/legado-shared-runtime.js';
  // URL webJs has no Java bridge. A plain CORS GET also works in rule WebViews.
  return 'if (!window.legadoCommon) { var commonRequest = new XMLHttpRequest(); commonRequest.open("GET",'+JSON.stringify(url)+',false); commonRequest.send(null); if (commonRequest.status !== 200) throw new Error("Common runtime HTTP " + commonRequest.status); window.legadoCommon = eval(commonRequest.responseText); }';
}
function browserScript(commit,options) {
  return browserLoader(commit)+'\n'
    +'window.legadoCommon.webClean(document,'+JSON.stringify(options)+');';
}
function browserReadableHelper(commit) {
  return parse('function auto_clean_up(){'+browserLoader(commit)+'\n'
    +'var article=window.legadoCommon.browserReadable(document,true);document.body.innerHTML=article.content;}').body[0];
}
function sharedBrowserHelper(node) {
  const code=js(node),commit=code.match(/https:\/\/raw\.githubusercontent\.com\/wanghaosjtu\/booksrc\/([0-9a-f]{40})\/booksource\/runtime\/legado-shared-runtime\.js/)?.[1];
  return !!commit&&code===js(browserReadableHelper(commit));
}
function sharedWebOptions(text) {
  const commit=text.match(/https:\/\/raw\.githubusercontent\.com\/wanghaosjtu\/booksrc\/([0-9a-f]{40})\/booksource\/runtime\/legado-shared-runtime\.js/)?.[1];
  if(!commit)return null;
  const tree=parse(text),last=tree.body[tree.body.length-1]?.expression;
  if(!memberCall(last,'webClean')||js(last.callee.object)!=='window.legadoCommon'||last.arguments.length!==2||last.arguments[0].name!=='document')return null;
  let options;
  try {options=data(last.arguments[1]);} catch {return null;}
  const old='window.legadoCommon = window.legadoCommon || eval(String(java.importScript('+JSON.stringify('https://raw.githubusercontent.com/wanghaosjtu/booksrc/'+commit+'/booksource/runtime/legado-shared-runtime.js')+')));\nwindow.legadoCommon.webClean(document,'+JSON.stringify(options)+');';
  return [old,browserScript(commit,options)].some(code=>js(parse(code))===js(tree))?options:null;
}
function simplifyWeb(text,globals,commit) {
  const shared=sharedWebOptions(text);
  if(shared!==null)return browserScript(commit,shared);
  if(text.length<10000)return simplifyProgram(text,globals);
  const tree=parse(text);let remove=globals.remove_selector;
  if(!LEGACY_WEB_PROGRAMS.has(hash(js(tree))))return text;
  walk(tree,n=>{
    if(n.type==='AssignmentExpression'&&n.left.name==='remove_selector')remove=data(n.right);
  });
  const options={};
  if(remove?.length)options.remove=remove;
  if(/new Readability\(document/.test(text))options.readable=true;
  if(/'<title>'\s*\+document\.title/.test(text))options.title=true;
  // Legacy Edge whole-page translation is duplicated by every affected source's TH/TC.
  return browserScript(commit,options);
}
function simplifySource(source,commit,runtime) {
  const out=clone(source),site=stripCommon(out.jsLib||''),globals=declaredSettings(site);
  const inactiveCommon=!/\/\* legado-(?:translation-runtime|common-loader) v/.test(out.jsLib||'');
  if(out.bookSourceUrl==='https://russtrat.ru/analytics'&&out.ruleBookInfo?.coverUrl?.includes('imgurl=result.split("\\n"）')) {
    out.ruleBookInfo.coverUrl='div.background-image-formatter@style<js>\nvar image = String(result).match(/url\\([\\\'"]?(.*?)[\\\'"]?\\)/);\nresult = image ? image[1] : "";\nresult;\n</js>';
  }
  if(out.bookSourceUrl==='http://m.ndlib.cn'&&out.ruleSearch?.bookList)out.ruleSearch.bookList=out.ruleSearch.bookList.replace(/source\.getSource\u200b\(\)\.bookSourceComment/g,'source.bookSourceComment');
  if(out.bookSourceUrl==='https://carnegieendowment.org'&&out.ruleContent?.content?.includes('function extractReadableContent(inputDoc)')){
    const tree=parse(out.ruleContent.content.match(/<js>([\s\S]*?)<\/js>/)[1]);
    // Only the audited full generic pipeline is replaced, not user edits.
    if(hash(js(tree))===runtime.carnegieReadableHash)out.ruleContent.content='//body<js>\nresult = TH(result, java, cache, {remove_selector:remove_selector, extract_selector:[".inline-formula","disp-formula"], readable:true, image_anchor_mode:"href"});\nresult;\n</js>';
  }
  const cross=new Set();
  for(const [field,value]of Object.entries(out))if(field!=='jsLib'&&value) {
    const text=typeof value==='object'?JSON.stringify(value):String(value);
    for(const n of parse(site).body.filter(n=>n.type==='FunctionDeclaration'))if(new RegExp('\\b'+n.id.name+'\\b').test(text))cross.add(n.id.name);
  }
  function ruleObject(obj) {
    for(const [name,value]of Object.entries(obj))if(typeof value==='string') {
      let input=value;
      if(name==='chapterList'&&['https://academic.oup.com/','https://academic.oup.com/jcr'].includes(source.bookSourceUrl)){
        const parts=[...value.matchAll(/<js>([\s\S]*?)<\/js>/g)];
        if(parts.length===3&&hash(js(parse(parts[0][1])))==='c722bad38a6fca50e06733b5e3d458739b96d0cfd28c6f2ff44f64d229e74b62'&&LEGACY_TRANSLATIONS[hash(js(parse(parts[2][1])))])input=value.replace(parts[0][0],'').trimStart();
      }
      const errorPolicy=source.bookSourceUrl==='https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber='&&name==='content'?'ieee':source.bookSourceUrl==='https://www.inc.com/'&&name==='content'?'inc':'strict';
      const fn=code=>simplifyProgram(code,globals,{content:name==='content',nativeOutput:name==='content'?'content':name==='coverUrl'?'cover':'',protectedNames:cross,inactiveCommon,errorPolicy});
      try {
        if(name==='webJs')obj[name]=simplifyWeb(input,globals,commit);
        else if(input.startsWith('@js:'))obj[name]='@js:'+fn(input.slice(4));
        else if(/<js>/i.test(input))obj[name]=segments(input,fn);
      } catch(error) {throw new Error(source.bookSourceName+' rule field '+name+': '+error.message,{cause:error});}
    }
  }
  for(const [field,value]of Object.entries(out)) {
    if(field.startsWith('rule')&&value&&typeof value==='object')ruleObject(value);
    if(['searchUrl','exploreUrl','header'].includes(field)&&typeof value==='string') {
      if(value.startsWith('@js:'))out[field]='@js:'+simplifyProgram(value.slice(4),globals,{protectedNames:cross});
      else if(/<js>/i.test(value))out[field]=segments(value,code=>simplifyProgram(code,globals,{protectedNames:cross}));
    }
  }
  out.loginUrl=simplifyLogin(out.loginUrl);
  if(out.loginUi)out.loginUi=simplifyUi(out.loginUi,runtime);
  if(out.loginCheckJs)out.loginCheckJs=simplifyCheck(out.loginCheckJs);
  const externalReads=new Set(cross);
  if(out.bookSourceName==='中国社会科学期刊')externalReads.add('burl');
  function collect(obj) {
    for(const [key,v]of Object.entries(obj)) {
      if(key==='jsLib')continue;
      if(v && typeof v==='object'){collect(v);continue;}
      if(typeof v!=='string')continue;
      let codes=[];
      if(v.startsWith('@js:'))codes=[v.slice(4)];
      else if(key==='loginUrl'&&v&&!/^https?:\/\//i.test(v))codes=[v];
      else if(key==='loginCheckJs'||key==='webJs')codes=[v];
      else codes=[...v.matchAll(/<js>([\s\S]*?)<\/js>/gi)].map(m=>m[1]);
      for(const code of codes)for(const name of reads(parse(code)))externalReads.add(name);
    }
  }
  collect(out);
  let siteTree=parse(site);
  siteTree.body=siteTree.body.map(n=>n.type==='FunctionDeclaration'&&n.id.name==='auto_clean_up'
    &&(LEGACY_BROWSER_HELPERS.has(hash(js(n)))||sharedBrowserHelper(n))?browserReadableHelper(commit):n);
  if(!externalReads.has('Readability'))siteTree.body=siteTree.body.filter(n=>!(
    n.type==='FunctionDeclaration'&&n.id.name==='Readability'
    ||n.type==='ExpressionStatement'&&n.expression.type==='AssignmentExpression'&&n.expression.left.object?.name==='Readability'
    ||n.type==='IfStatement'&&/module\.exports = Readability/.test(js(n))));
  // jsLib is an exported site namespace: an unreferenced helper can also be
  // used by a manual debug expression or an evaluated site script.
  for(const n of siteTree.body)if(n.type==='FunctionDeclaration')externalReads.add(n.id.name);
  let lib=simplifyProgram(js(siteTree),globals,{protectedNames:externalReads});
  let tree=parse(lib);
  out.jsLib=(js(tree)?js(tree)+'\n\n':'')+loader(commit);
  return out;
}
function runtimeData() {
  const code=fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-shared-runtime.js'),'utf8');
  const node=parse(code).body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='_LT_LOGIN_ROWS'));
  return {loginRows:data(node.declarations.find(d=>d.id.name==='_LT_LOGIN_ROWS').init),carnegieReadableHash:'128a73c1b1c7d6854a584972db72d60c405da21fd5d7a949bc2400b2c8cabc5b'};
}
function build(local,phone,commit) {
  assert(/^[0-9a-f]{40}$/.test(commit),'full immutable common SHA required');
  const runtime=runtimeData();
  const sources=local.map(s=>simplifySource(s,commit,runtime));
  const candidates=local.map(s=>{
    const p=phone.find(p=>p.bookSourceUrl===s.bookSourceUrl);assert(p,'phone target missing');
    return simplifySource(p,commit,runtime);
  });
  return {sources,candidates};
}
function main() {
  const [commit,directory,mode]=process.argv.slice(2),dir=privateDirectory(directory);
  const filename=path.join(ROOT,'booksource/legado-book-sources-current.json'),local=JSON.parse(fs.readFileSync(filename,'utf8'));
  const before=JSON.parse(fs.readFileSync(path.join(dir,'local-sources-before.json'),'utf8'));
  assert.equal(hash(local),hash(before),'canonical changed after snapshot');
  const phone=JSON.parse(fs.readFileSync(path.join(dir,'phone-sources-before.json'),'utf8'));
  const result=build(local,phone,commit);
  const size=values=>values.reduce((n,s)=>n+Buffer.byteLength(JSON.stringify(s)),0);
  const report={commit,total:local.length,beforeSourceBytes:size(local),afterSourceBytes:size(result.sources),mode:mode||'--dry-run'};
  if(mode==='--write') {
    privateWrite(dir,'phone-targets-candidate.json',result.candidates);
    privateWrite(dir,'simplification-summary.json',report);
    fs.writeFileSync(filename,JSON.stringify(result.sources,null,2)+'\n');
  } else assert(!mode||mode==='--dry-run','use --dry-run or --write');
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main();
module.exports={data,parse,js,walk,transform,reads,simplifyProgram,simplifySource,simplifyUi,simplifyLogin,simplifyCheck,simplifyWeb,browserLoader,browserScript,browserReadableHelper,uiAction,runtimeData,build,main};
