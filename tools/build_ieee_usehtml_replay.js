#!/usr/bin/env node
/* Controlled captured-article replay, not restoration of the site's login. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {ROOT}=require('./build_usehtml_validation');
const {SOURCE_ID}=require('./build_ieee_usehtml_validation');
const client=require('./usehtml_http_ws_client');
const DIR=path.join(ROOT,'booksource/.usehtml-validation-phone');
const CANONICAL='https://ieeexplore.ieee.org/document/9737357/';
const REST='https://ieeexplore.ieee.org/rest/document/9737357/';
const HEALTH='http://127.0.0.1:1122/getJsSourceApiTokenRequired';
const wrapper=fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-usehtml-validation.js'),'utf8');
const guard=fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-usehtml-rule-json.js'),'utf8');
const read=file=>JSON.parse(fs.readFileSync(path.join(DIR,file),'utf8'));
const write=(file,value)=>fs.writeFileSync(path.join(DIR,file),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
function strings(value) {
  const parts=[];
  for(let i=0;i<value.length;i+=3000) parts.push(JSON.stringify(value.slice(i,i+3000)).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
  return '['+parts.join(',')+'].join("")';
}
function build(original,body,lead,mode,token) {
  assert(['legacy','guard'].includes(mode),'invalid replay mode');
  assert.equal(original.bookSourceUrl,SOURCE_ID,'expected original IEEE source');
  assert(body.status===200&&body.host==='ieeexplore.ieee.org'&&body.body.includes('<tex-math'),'actual successful IEEE body required');
  assert(!/(?:x-amz-signature|awsaccesskeyid|[?&](?:token|ticket|sessionid|credential)=)/i.test(body.body),'do not copy signed credential material');
  assert(lead.host==='ieeexplore.ieee.org'&&lead.title&&typeof lead.html==='string','article lead projection required');
  assert(!original.jsLib.includes('function useHtmlRuleJson('),'legacy baseline must not contain the new guard');
  assert(/function\s+_ltOptions\s*\(/.test(original.jsLib),'known request serializer required');
  const page='<html><head><base href="'+CANONICAL+'"></head><body>'+lead.html+'</body></html>';
  const metadata=JSON.stringify({displayDocTitle:lead.title,abstract:lead.abstractText||''});
  const fixtureLib='\nvar _uhvIeeePage='+strings(page)+';\nvar _uhvIeeeBody='+strings(body.body)+';\nvar _uhvIeeeMetadata='+strings(metadata)+';\n'+
    'function _uhvIeeeFixturePage(){return _uhvIeeePage;}\n'+
    'function _uhvIeeeFixtureAjax(value){var url=String(value).split(",")[0];'+
    'if(/^https:\\/\\/ieeexplore\\.ieee\\.org\\/rest\\/auth\\/signed-url(?:\\?|$)/.test(url))return "";'+
    'url=url.replace(/\\?.*$/,"");if(url==='+JSON.stringify(CANONICAL)+')return _uhvIeeePage;'+
    'if(url==='+JSON.stringify(REST)+')return _uhvIeeeBody;'+
    'if(url==='+JSON.stringify(REST+'abstract')+')return _uhvIeeeMetadata;'+
    'if(/^https?:\\/\\/ieeexplore\\.ieee\\.org\\//.test(url))throw "unlisted IEEE replay request";'+
    'return java.ajax(value);}\n';
  const candidate=structuredClone(original);
  candidate.bookSourceUrl=SOURCE_ID+'#usehtml-replay-'+mode+'-'+token.slice(0,8);
  candidate.bookSourceName=original.bookSourceName+' · HTML原文回放 '+(mode==='legacy'?'原编码':'保护编码');
  candidate.header=JSON.stringify({...JSON.parse(original.header||'{}'),proxy:''});
  candidate.jsLib=original.jsLib+fixtureLib+(mode==='guard'?'\n'+guard:'');
  const chapterUrl=HEALTH+','+JSON.stringify({bodyJs:'_uhvIeeeFixturePage()',timeout:10000});
  candidate.ruleToc={chapterList:'@js:[1]',chapterName:'@js:'+JSON.stringify('IEEE 9737357 · '+(mode==='legacy'?'原编码':'保护编码')+'正文回放'),
    chapterUrl:'@js:'+JSON.stringify(chapterUrl),nextTocUrl:''};
  const content=original.ruleContent.content;
  assert.equal((content.match(/java\.ajax\(/g)||[]).length,3,'expected three IEEE requests');
  assert(content.includes('function ieeeSignedMedia(resource) {'),'known signed-media step required');
  candidate.ruleContent.content=content.replace(/java\.ajax\(/g,'_uhvIeeeFixtureAjax(')
    .replace('function ieeeSignedMedia(resource) {','function ieeeSignedMedia(resource) {\n        return ""; // Replay: no signed URL or login credential requests.\n')+
    '\n<js>\n'+wrapper+'\nresult=useHtmlValidation(result,'+JSON.stringify(CANONICAL)+');\nresult;\n</js>\n';
  new vm.Script(candidate.jsLib);
  for(const match of candidate.ruleContent.content.matchAll(/<js>([\s\S]*?)<\/js>/g))new vm.Script(match[1]);
  return {candidate,chapterUrl};
}
async function deploy() {
  const state=read('state.json');
  assert(process.env.LEGADO_PHONE&&state.host===process.env.LEGADO_PHONE,'matching explicit phone required');
  assert.equal(state.sourceStatus,'deployed');
  assert(!state.books.some(b=>/^replay-/.test(b.kind||'')),'replay deployment already attempted');
  const original=read('ieee-formula-before-v1.json')[0],body=read('ieee-rest-browser-first-v1.json'),lead=read('ieee-lead-browser-first-v1.json');
  const entries=['legacy','guard'].map(mode=>({mode,...build(original,body,lead,mode,state.token)}));
  const before=await client.sources(),books=await client.request('/getBookshelf');
  const current=before.find(s=>s.bookSourceUrl===SOURCE_ID);
  assert(current,'original IEEE source missing');
  for(const key of ['jsLib','header','ruleContent','ruleToc','loginUi','loginUrl'])assert.equal(client.changedPaths(current[key],original[key]).length,0,'original edited at '+key+'; preserve it');
  assert(entries.every(e=>!before.some(s=>s.bookSourceUrl===e.candidate.bookSourceUrl)),'replay source collision');
  write('ieee-replay-sources-before-v1.json',before);write('ieee-replay-books-before-v1.json',books);
  const saveState=()=>fs.writeFileSync(path.join(DIR,'state.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});
  for(const entry of entries) {
    const kind='replay-'+entry.mode,file='ieee-'+kind+'-candidate-v1.json';
    write(file,[entry.candidate]);
    const extra={id:entry.candidate.bookSourceUrl,kind,candidate:file,status:'deploying'};
    state.extraSources.push(extra);saveState();
    await client.save(entry.candidate,['bookSourceName','bookSourceUrl','jsLib','header','ruleContent','ruleToc','loginUi','loginUrl']);
    extra.status='deployed';saveState();
    const bookUrl=CANONICAL+'#usehtml-validation-'+state.token+'-'+kind;
    assert(!books.some(b=>b.bookUrl===bookUrl),'replay book collision');
    const book={bookUrl,tocUrl:HEALTH,origin:extra.id,originName:entry.candidate.bookSourceName,
      name:'HTML 验证 UHV-'+state.token.slice(0,8)+' · IEEE'+(entry.mode==='legacy'?'原编码':'保护编码')+'回放',
      author:'usehtml-validation',canUpdate:false,totalChapterNum:0,durChapterIndex:0,durChapterPos:0};
    const record={kind,bookUrl,book,status:'creating'};state.books.push(record);saveState();
    await client.request('/saveBook',book);
    const actual=(await client.request('/getBookshelf')).find(b=>b.bookUrl===bookUrl);
    assert(actual&&actual.origin===extra.id&&actual.name===book.name&&actual.author===book.author,'replay book ownership mismatch');
    record.status='created';saveState();
  }
  const own=new Set(entries.map(e=>e.candidate.bookSourceUrl));
  const after=(await client.sources()).filter(s=>!own.has(s.bookSourceUrl));
  assert.equal(client.changedPaths(before,after).length,0,'unrelated sources changed during replay deployment');
  return {deployed:2,books:2,kind:'captured-article-replay',originLoginRestored:false,
    signedCredentialRequests:false,originalSources:'unchanged during deployment',bodyLength:body.body.length};
}
module.exports={build,CANONICAL,REST,HEALTH};
if(require.main===module)deploy().then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{
  console.error(String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,600));process.exitCode=1;
});
