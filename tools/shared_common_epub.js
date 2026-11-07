#!/usr/bin/env node
'use strict';
// Read the single task-owned native SVG cache through supported HTTP/WS APIs.
// EPUB export itself is a human App-UI action: scripts cannot access Context.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {client,safeJson,HEALTH}=require('./shared_common_smoke');
const {privateDirectory,privateWrite}=require('./shared_common_phone');
const {summarizeDebug,errorDetails}=require('./usehtml_http_ws_client');
const md5=value=>crypto.createHash('md5').update(value).digest('hex').slice(8,24);

async function owned(dir) {
  dir=privateDirectory(dir);
  const state=JSON.parse(fs.readFileSync(path.join(dir,'smoke-state.json'),'utf8'));
  const expected=JSON.parse(fs.readFileSync(path.join(dir,'smoke-book.json'),'utf8'));
  const actual=(await client().request('/getBookshelf')).find(b=>b.bookUrl===expected.bookUrl);
  assert(actual&&actual.origin===state.id&&actual.name===expected.name&&actual.author===expected.author,'owned book identity mismatch');
  const chapters=await client().request('/getChapterList?url='+encodeURIComponent(actual.bookUrl));
  assert(chapters.length===1&&(chapters[0].title||chapters[0].name)==='COMMON-SMOKE-CHAPTER','only the owned single-chapter fixture may be exported');
  return {dir,state,book:actual};
}
async function run(dir,label,code,marker) {
  const {state}=await owned(dir);
  new (require('node:vm').Script)(code);
  const key='--'+HEALTH+','+safeJson({bodyJs:code,timeout:10000});
  const result=await client().debug(state.id,key,25000);
  privateWrite(dir,label+'-debug-'+Date.now()+'.json',result);
  const summary=summarizeDebug(result,key);
  const match=result.messages.join('\n').match(new RegExp(marker+' (\\{[^\\n]+\\})'));
  const metrics=match?JSON.parse(match[1]):null;
  assert(!summary.isError&&metrics,'native operation did not complete');
  return {summary,metrics,result};
}
async function cacheSvg(dir) {
  const {book}=await owned(dir);
  const content=JSON.parse(fs.readFileSync(path.join(dir,'smoke-content.json'),'utf8')).content;
  const match=content.match(/<img[^>]*src="([^"]*(?:"[^>]+\})?)"[^>]*>/);
  assert(match&&match[1].includes(',{"js":'),'complete native formula src required');
  const src=match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  const folder=book.name.replace(/[\\/:*?"<>|.]/g,'').slice(0,9)+md5(book.bookUrl);
  const relative='../files/book_cache/'+folder+'/images/'+md5(src)+'.svg';
  const code=`(function(){
    var file=java.getFile(${safeJson(relative)});
    var bytes=java.readFile(${safeJson(relative)});
    if(!bytes||!bytes.length)throw Error('Owned native SVG image cache unavailable');
    var svg=String(new Packages.java.lang.String(bytes,'UTF-8'));
    if(svg.indexOf('<svg')<0)throw Error('Cached .svg does not contain SVG');
    java.log('COMMON-SVG-CACHE '+JSON.stringify({kind:'native-owned-image-cache',svgExtension:true,svgContent:true,bytes:Number(bytes.length)}));
    java.log('COMMON-SVG-BASE64 '+Packages.android.util.Base64.encodeToString(bytes,2));
    return 'COMMON-CONTROL-SVG-CACHE';
  })()`;
  const {metrics,result}=await run(dir,'svg-cache',code,'COMMON-SVG-CACHE');
  const encoded=result.messages.join('\n').match(/COMMON-SVG-BASE64 ([A-Za-z0-9+/=]+)/);
  assert(encoded,'cached SVG bytes missing');
  const bytes=Buffer.from(encoded[1],'base64');
  assert.equal(bytes.length,metrics.bytes,'cached SVG byte count mismatch');
  fs.writeFileSync(path.join(dir,'native-formula-cache.svg'),bytes,{mode:0o600,flag:'wx'});
  privateWrite(dir,'svg-cache-summary.json',metrics);
  return metrics;
}
async function main() {
  const [operation,directory]=process.argv.slice(2);
  assert(directory,'private evidence directory required');
  const dir=privateDirectory(directory);
  const operations={cache:cacheSvg};
  assert(operations[operation],'only cache is supported; export EPUB in the App UI');
  console.log(JSON.stringify(await operations[operation](dir),null,2));
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify(errorDetails(error)));process.exitCode=1;});
