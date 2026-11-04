#!/usr/bin/env node
/* Explicit, scoped phone tests/deployment. No import-time mutations. */
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const client = require('./phone_source_client');
const r = require('./repair_six_sources');
const DIR = '/tmp/booksrc-six-20261102';
async function evaluate(js, source, timeoutSec=75) {
  const reply=await client.mcp('eval_js',{js,url:source.bookSourceUrl,timeoutSec},timeoutSec*1000+15000);
  const raw=client.resultText(reply);
  const line=raw.split('\n').find(l=>l.trim().startsWith('{'));
  if(reply.isError||!line)throw Error(raw.slice(-2000));
  return JSON.parse(line);
}
function report(name,value) { fs.writeFileSync(`${DIR}/${name}.json`,JSON.stringify(value,null,2)+'\n',{mode:0o600}); }
async function probe(source,url,mode) {
  const rules=mode==='explore'?source.ruleExplore:mode==='toc'?source.ruleToc:mode==='cover'?source.ruleBookInfo:source.ruleContent;
  const code=r.COMMON+'\nvar u='+JSON.stringify(url)+',mode='+JSON.stringify(mode)+',rules='+JSON.stringify(rules)+';\n'+String.raw`
var raw=String(java.ajax(u,20000)||''),summary={url:u,phase:mode,status:'PASS',fetchLength:raw.length};
if(sixChallenge(raw)||/^(?:java\.|javax\.|error code: 520)/.test(raw)||/Qualcomm Web Gateway/.test(raw)) {
 summary.status='BLOCKED';summary.reason=String(org.jsoup.Jsoup.parse(raw).title())||raw.substring(0,150);
}else{
 var analyzer=new Packages.io.legado.app.model.analyzeRule.AnalyzeRule(null,source,false,false);
 analyzer.setContent(raw,u);
 if(mode==='content'){
  var html=String(analyzer.getString(rules.content)),doc=org.jsoup.Jsoup.parse(html),text=String(doc.body().text());
  summary.textLength=text.length;summary.paragraphs=doc.select('p').size();summary.images=doc.select('img[src]').size();summary.tables=doc.select('table').size();
  summary.start=text.substring(0,240);summary.end=text.substring(Math.max(0,text.length-160));
  summary.status=text.length>=80?'PASS':/仅提供 PDF/.test(text)?'PDF_ONLY':'FAIL';
  var actual=doc.select('p:not(.six-original-resource)');
  if(/\/videos\/|\/webinars\//.test(u)&&String(actual.text()).length>=20)summary.status='MEDIA_DESCRIPTION';
  summary.unsafeNodes=doc.select('script,iframe,[onclick],[onerror]').size();if(summary.unsafeNodes)summary.status='FAIL';
 }else if(mode==='cover'){
  summary.cover=String(analyzer.getString(rules.coverUrl));summary.status=/^https?:\/\//.test(summary.cover)&&!/sk_logo_sscp/.test(summary.cover)?'PASS':'FAIL';
 }else{
  var listRule=mode==='explore'?rules.bookList:rules.chapterList,reverse=listRule.charAt(0)==='-';
  if(reverse||listRule.charAt(0)==='+')listRule=listRule.substring(1);
  var list=analyzer.getElements(listRule),samples=[],seen={},duplicates=0;
  var count=typeof list.size==='function'?list.size():list.length;
  for(var i=0;i<count;i++){
   var index=reverse?count-1-i:i,item=typeof list.get==='function'?list.get(index):list[index];
   analyzer.setContent(item,u);
   var link=sixAbsolute(String(analyzer.getString(mode==='explore'?rules.bookUrl:rules.chapterUrl,null,true)),u);
   if(seen[link])duplicates++;seen[link]=true;
   if(i<3)samples.push({name:String(analyzer.getString(mode==='explore'?rules.name:rules.chapterName,null,false)),url:link});
  }
  summary.count=count;summary.duplicates=duplicates;summary.samples=samples;
  if(mode==='toc'&&rules.nextTocUrl){analyzer.setContent(raw,u);summary.next=String(analyzer.getString(rules.nextTocUrl,null,true));}
  if(summary.next===u)summary.next='';
  summary.status=count>0&&duplicates===0?'PASS':'FAIL';
 }
}
JSON.stringify(summary);`;
  try { return {source:source.bookSourceName,...await evaluate(code,source)}; }
  catch(e) { return {source:source.bookSourceName,url,phase:mode,status:/BLOCKED|验证|Cloudflare/.test(e.message)?'BLOCKED':'FAIL',reason:e.message.slice(-1000)}; }
}
async function fixtures(source) {
  const fns=[r.carnegieNext,r.carnegieContent,r.journalCover,r.productExplore,r.productToc,r.productNext,r.productContent,r.casContent,r.annualContent].map(String).join('\n');
  const code='var checks=[];function check(n,c){checks.push({name:n,status:c?\"PASS\":\"FAIL\"});}\n'+
   '(function(java,cache,TH){\n'+r.COMMON+'\n'+fns+'\nvar PRODUCT_CATEGORIES='+JSON.stringify(r.PRODUCT_CATEGORIES)+';\n'+String.raw`
var nav='<nav class="navbar_dropdown-list"><ul>';
for(var path in PRODUCT_CATEGORIES)nav+='<li class="navbar_dropdown-inner-list-item"><a href="'+path+'">'+PRODUCT_CATEGORIES[path]+'</a></li>';
nav+='<li class="navbar_dropdown-inner-list-item"><a href="/security">Security</a></li><li class="navbar_dropdown-inner-list-item"><a href="/blog">Duplicate</a></li></ul></nav>';
check('Resources has exactly six unique content books',org.jsoup.Jsoup.parse(productExplore(nav,'https://www.productplan.com/')).select('li').size()===6);
var raw='<main><a class="grid-item cc-featured" href="/blog/featured"><h2>Featured</h2></a><a class="grid-item" href="/blog/article"><h4>Article</h4></a><a class="grid-item" href="/blog/article"><h4>Duplicate</h4></a></main>';
check('cards deduplicate',org.jsoup.Jsoup.parse(productToc(raw,'https://www.productplan.com/blog')).select('li').size()===2);
check('later pages omit fixed featured cards',org.jsoup.Jsoup.parse(productToc(raw,'https://www.productplan.com/blog?collection_page=2')).select('li').size()===1);
check('missing ProductPlan next link stops pagination',productNext('<main></main>','https://www.productplan.com/blog')==='');
check('Finsweet disabled class keeps valid HTTP pagination',productNext('<main><a class="w-pagination-next is-list-pagination-disabled" href="?abc_page=2">Next</a></main>','https://www.productplan.com/blog')==='https://www.productplan.com/blog?abc_page=2');
check('missing Carnegie next link stays blank',carnegieNext('<html></html>','http://carnegie.ru/commentary/')==='');
check('Carnegie resolves query pages',carnegieNext('<a class="page-links__next" href="?pageOn=2">Next</a>','http://carnegie.ru/commentary/')==='http://carnegie.ru/commentary/?pageOn=2');
var carnegie=carnegieContent('<div class="commentary-detail"><div class="zone-title background-cover" style="background-image: url(/hero.jpg );"><h1>Title</h1></div><p>Genuine article.</p><div class="related-content">Related noise</div></div>','http://carnegie.ru/commentary/123');
check('Carnegie preserves the background hero but removes related cards',carnegie.indexOf('http://carnegie.ru/hero.jpg')>=0&&carnegie.indexOf('Related noise')<0);
check('periodical own cover precedes portal',journalCover('<div class="list_text_left"><div class="list_img"><img src="../cover.png"></div></div>','https://www.cssn.cn/dkzgxp/zgxp_zgshkx/sk202606/')==='https://www.cssn.cn/dkzgxp/zgxp_zgshkx/cover.png');
check('missing periodical cover does not fall back to logo',journalCover('<img src="/images/sk_logo_sscp.png">','https://www.cssn.cn/no-journal/')==='https://www.cssn.cn/images/sk02-zgxp-book0.png');
var content=productContent('<main><h1>Title</h1><div class="rich-text"><p>Real content.</p><img src="/image.png" onerror="bad()"><script>bad()</script></div><nav>Noise</nav></main>','https://www.productplan.com/blog/article');
check('content removes scripts/events and resolves images',!/<script|onerror=|Noise/.test(content)&&content.indexOf('https://www.productplan.com/image.png')>=0);
var failed=false;try{annualContent('<div class="title-box">Only title</div>','https://www.annualreviews.org/article');}catch(e){failed=String(e).indexOf('不以摘要代替')>=0;}
check('Annual title or abstract cannot pass as full text',failed);
var paragraph='Actual full body text with enough detail to count as genuine content. Actual full body text with enough detail to count as genuine content.';
var annual=annualContent('<div class="title-box">Article title</div><ul class="nav"><li>Navigation noise</li></ul><div id="html_fulltext"><p>'+paragraph+'</p><img src="/figure.jpg"></div>','https://www.annualreviews.org/article');
check('Annual full text excludes navigation and WebView options',annual.indexOf(paragraph)>=0&&annual.indexOf('Navigation noise')<0&&annual.indexOf('webView')<0);
var loaded=annualContent('<div id="html_fulltext"><p>Full text loading...</p><div id="itemFullTextId" data-fulltexturl="/deliver/fulltext/example.html?mimeType=html"></div></div>','https://www.annualreviews.org/article');
check('Annual fetches data-fulltexturl instead of translating a loading placeholder',loaded.indexOf(paragraph)>=0&&loaded.indexOf('Full text loading')<0);
var signed=annualContent('<div id="html_fulltext"><div id="itemFullTextId" data-fulltexturl="/deliver/fulltext/signed.html?mimeType=html"></div></div>','https://www.annualreviews.org/article');
check('Annual follows a delivery docserver URL over HTTP',signed.indexOf(paragraph)>=0&&signed.indexOf('docserver/ahah')<0);
var cas=casContent('var articleBaseId="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";','http://www.bulletin.cas.cn/BCAS_CH/doi/10.1234/test');
check('CAS uses baseId and preserves inline figures',cas.indexOf('https://example.org/figure.png')>=0&&cas.indexOf('<script')<0&&cas.indexOf(paragraph)>=0);
})(
 {log:function(){},connect:function(url){
  if(url.indexOf('/deliver/fulltext/signed.html')>=0)return {body:'https://www.annualreviews.org/docserver/ahah/fulltext/signed.html?expires=1&checksum=fixture'};
  return {body:/\/deliver\/fulltext\/|\/docserver\/ahah\/fulltext\//.test(url)?'<p>Actual full body text with enough detail to count as genuine content. Actual full body text with enough detail to count as genuine content.</p>':''};
 },ajax:function(url){
  if(url.indexOf('/article/basic')>=0)return JSON.stringify({article:{baseId:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',title:'CAS title'}});
  if(url.indexOf('/doi/getFulltext,')>=0){if(url.indexOf('baseId=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')<0)throw 'wrong baseId';return '<p>Actual full body text with enough detail to count as genuine content. Actual full body text with enough detail to count as genuine content.</p><xref ref-type="fig" rid="F001">Fig</xref><script>bad()</script>';}
  if(url.indexOf('/figAndTable')>=0)return JSON.stringify({figureList:[{labelId:'F001',figCover:'https://example.org/figure.png',caption:'Figure caption'}]});
  return '';
 }}, {get:function(){return '';},put:function(){}}, function(html){return html;}
);
JSON.stringify({phase:'fixtures',status:checks.every(function(c){return c.status==='PASS';})?'PASS':'FAIL',checks:checks});`;
  return evaluate(code,source,35);
}
module.exports={probe,fixtures,evaluate};
async function annualTests(candidate) {
 const source=candidate.find(s=>s.bookSourceUrl===r.IDS.annual),results=[];
 async function run(url,mode){const x=await probe(source,url,mode);results.push(x);report('annual-live',{results});console.log(JSON.stringify(x));return x;}
 for(const entry of source.exploreUrl.split('\n')){
  const explore=await run(entry.split('::')[1],'explore');
  if(explore.samples&&explore.samples.length){
   const toc=await run(explore.samples[0].url,'toc');
   for(const sample of toc.samples||[])await run(sample.url,'content');
  }
 }
 assert(results.every(x=>x.status==='PASS'),'Annual live test did not obtain every sampled full text');
}
async function matrix(candidate) {
 const results=[];
 async function run(slug,url,mode) {
  const source=candidate.find(s=>s.bookSourceUrl===r.IDS[slug]),result=await probe(source,url,mode);
  results.push(result);report('live-matrix',{results});console.log(JSON.stringify(result));return result;
 }
 for(const path of Object.keys(r.PRODUCT_CATEGORIES)) {
  const toc=await run('productplan','https://www.productplan.com'+path,'toc');
  if(path==='/blog') {
   if(toc.next)await run('productplan',toc.next,'toc');
   for(const sample of toc.samples||[])await run('productplan',sample.url,'content');
  }else if(toc.samples&&toc.samples.length)await run('productplan',toc.samples[0].url,'content');
 }
 for(const url of ['http://carnegie.ru/commentary/','http://carnegie.ru/publications/?lang=en']) {
  const toc=await run('carnegie',url,'toc');
  if(toc.next)await run('carnegie',toc.next,'toc');
  for(const sample of toc.samples||[])await run('carnegie',sample.url,'content');
 }
 for(const folder of ['zgxp_zgshkx/sk202606/','zgxp_zgshkxwz/','zgxp_zgwxpp/','zgxp_zgshkxpj/','zgxp_gjshkxzzzwb/','mxyj/'])await run('journal','https://www.cssn.cn/dkzgxp/'+folder,'cover');
 const mid=candidate.find(s=>s.bookSourceUrl===r.IDS.mid);
 await run('mid',mid.exploreUrl.split('::')[1],'explore');
 const midUrls=Array.from(mid.ruleExplore.bookUrl.matchAll(/https:\/\/mid\.ru[^'\"]+/g),m=>m[0]);
 for(const url of [...new Set(midUrls)])await run('mid',url,'toc');
 for(const volume of ['41','40']) {
  const url='http://www.bulletin.cas.cn/rest/v4/heading/articleByIssue?journalId=e96cfaed134042e7ba52c1fe2953d394&volume='+volume+'&issue=10';
  const toc=await run('cas',url,'toc');
  for(const sample of toc.samples||[])await run('cas',sample.url,'content');
 }
 const annual=candidate.find(s=>s.bookSourceUrl===r.IDS.annual);
 for(const entry of annual.exploreUrl.split('\n'))await run('annual',entry.split('::')[1],'explore');
 console.log(JSON.stringify({summary:results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),count:results.length}));
}
if(require.main===module)(async()=>{
 const [command,slug,url,mode='toc']=process.argv.slice(2);
 const before=JSON.parse(fs.readFileSync(`${DIR}/phone-before.json`,'utf8')),candidate=r.repaired(before);
 const id=r.IDS[slug],source=candidate.find(s=>s.bookSourceUrl===id);
 if(command==='annual'){
  await annualTests(candidate);
 }else if(command==='matrix'){
  await matrix(candidate);
 }else if(command==='fixtures'){
  const result=await fixtures(candidate.find(s=>s.bookSourceUrl===r.IDS.productplan));report('fixtures',result);console.log(JSON.stringify(result,null,2));assert.equal(result.status,'PASS');
 }else if(command==='probe'){
  assert(source&&url,'probe requires a six-source slug and exact URL');const result=await probe(source,url,mode);report(`probe-${slug}-${mode}-${Date.now()}`,result);console.log(JSON.stringify(result,null,2));if(result.status==='FAIL')process.exitCode=1;
 }else if(command==='acknowledge-cas'){
  const original=before.find(s=>s.bookSourceUrl===r.IDS.cas),previous=structuredClone(candidate.find(s=>s.bookSourceUrl===r.IDS.cas));
  previous.ruleContent.content=previous.ruleContent.content.replace(/^.*var out = org.jsoup.Jsoup.parseBodyFragment.*$/m,'  var out = org.jsoup.Jsoup.parseBodyFragment(full, url);');
  const live=(await client.sources()).find(s=>s.bookSourceUrl===r.IDS.cas),paths=client.changedPaths(original,previous);
  assert(!client.changedPaths(previous,live).some(p=>paths.includes(p)),'CAS live rules are not the exact acknowledged prior deployment');
  report('deployed-cas',live);console.log('acknowledged exact prior CAS deployment; no phone write');
 }else if(command==='deploy'){
  assert(source,'deploy requires one six-source slug');
  const original=before.find(s=>s.bookSourceUrl===id),snapshot=DIR+'/deployed-'+slug+'.json';
  const baseline=fs.existsSync(snapshot)?JSON.parse(fs.readFileSync(snapshot)):original;
  assert.equal(baseline.bookSourceUrl,id);
  const live=(await client.sources()).find(s=>s.bookSourceUrl===id),paths=client.changedPaths(original,source),planned=structuredClone(baseline);
  // Apply only the planned fields, preserving unrelated snapshot changes.
  for(const path of paths)r.applyLeaf(planned,source,path);
  const desired=client.merge(baseline,planned,live),actual=await client.save(desired,paths);
  report('deployed-'+slug,actual);
  const result={source:source.bookSourceName,url:id,changed:client.changedPaths(live,desired),readback:'verified'};report('deploy-'+slug,result);console.log(JSON.stringify(result));
 }else if(command==='verify'){
  const live=await client.sources(),results=[],allowed=new Set(Object.values(r.IDS));
  assert.equal(live.length,before.length,'phone source count changed');
  for(const old of before){
   const now=live.find(s=>s.bookSourceUrl===old.bookSourceUrl);assert(now,'source disappeared');
   if(!allowed.has(old.bookSourceUrl)){assert.deepEqual(now,old,'unrelated phone source changed: '+old.bookSourceName);continue;}
   const desired=candidate.find(s=>s.bookSourceUrl===old.bookSourceUrl),paths=client.changedPaths(old,desired);
   assert(!client.changedPaths(old,now).some(p=>!paths.includes(p)),'unplanned phone fields changed: '+old.bookSourceName);
   assert(!client.changedPaths(desired,now).some(p=>paths.includes(p)),'planned rules not synchronized: '+old.bookSourceName);
   results.push({source:old.bookSourceName,changed:paths,readback:'verified'});
  }
  const result={status:'PASS',sources:results,unrelatedSourcesUnchanged:before.length-6};report('readback-final',result);console.log(JSON.stringify(result,null,2));
 }else throw Error('Usage: test_six_sources_phone.js fixtures|matrix|annual|probe <slug> <url> [toc|explore|cover|content]|deploy <slug>|acknowledge-cas|verify');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
