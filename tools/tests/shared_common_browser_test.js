'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {browserScript,browserReadableHelper,parse,js}=require('../simplify_source_js');
const {stripCommon}=require('../migrate_shared_common');
const {ROOT}=require('../shared_common_phone');
const chrome=process.env.USEHTML_CHROME_BIN;
const COMMIT='0123456789abcdef0123456789abcdef01234567';
const raw='https://raw.githubusercontent.com/wanghaosjtu/booksrc/'+COMMIT+'/booksource/runtime/legado-shared-runtime.js';
const runtime=fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-shared-runtime.js'),'utf8');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
const bodyAttributes=html=>html.match(/<body\b[^>]*>/i)?.[0]||'';
async function dump(url,profile){
  const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--disable-background-networking','--disable-extensions','--disable-sync','--no-first-run',
    '--proxy-server=direct://','--user-data-dir='+profile,'--virtual-time-budget=1000','--dump-dom',url],
    {stdio:['ignore','pipe','pipe'],timeout:25000});
  let output='',errors='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>errors+=value);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(code,0,'isolated Chrome failed: '+errors.slice(-500));
  return output;
}
test('real Chrome loads byte-identical common through CORS without Java; DOM and HTTP errors stay visible',
  {skip:!chrome?'set USEHTML_CHROME_BIN for actual browser validation':false,timeout:60000},async()=>{
    const requests=[];
    const library=http.createServer((req,res)=>{
      requests.push({url:req.url,origin:req.headers.origin});
      if(req.url!=='/no-cors')res.setHeader('Access-Control-Allow-Origin','*');
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.statusCode=req.url==='/blocked'?403:200;
      res.end(req.url==='/blocked'?'blocked':runtime);
    });
    const libraryUrl=await listen(library);
    const paragraph='COMMON-BROWSER-ARTICLE: the native browser keeps the original English article, its heading, and the formula position. '.repeat(8);
    const fixture=http.createServer((req,res)=>{
      const mode=req.url.slice(1)||'ok',target=mode==='blocked'?'/blocked':mode==='no-cors'?'/no-cors':'/runtime.js';
      let script=browserScript(COMMIT,{readable:true,title:true,remove:['script','nav','footer']}).replace(raw,libraryUrl+target);
      if(mode==='selector')script+='\nwindow.legadoCommon.webClean(document,{remove:["["]});';
      if(mode==='ok')script+='\n'+browserScript(COMMIT,{remove:[]}).replace(raw,libraryUrl+target);
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<html><head><title>COMMON-BROWSER-TITLE</title></head><body><nav>COMMON-BROWSER-NOISE</nav>'
        +'<article><h1>COMMON-BROWSER-TITLE</h1><h2>COMMON-BROWSER-SECTION</h2><p>'+paragraph+'</p><p>'+paragraph+'</p></article>'
        +'<footer>COMMON-BROWSER-NOISE</footer><script>try{'+script+'\n'
        +'document.body.setAttribute("data-common-version",window.legadoCommon.version);'
        +'document.body.setAttribute("data-java-bridge",typeof java);'
        +'}catch(error){document.body.setAttribute("data-common-error",String(error));}</script></body></html>');
    });
    const fixtureUrl=await listen(fixture),profile=fs.mkdtempSync(path.join(os.tmpdir(),'booksrc-common-browser-'));
    try{
      const ok=await dump(fixtureUrl+'/ok',profile);
      assert.match(ok,/data-common-version="3"/);
      assert.match(ok,/data-java-bridge="undefined"/);
      assert.match(ok,/<h2>COMMON-BROWSER-SECTION<\/h2>/);
      assert.match(ok,/COMMON-BROWSER-TITLE/);
      assert.match(ok,/keeps the original English article/);
      assert(!ok.includes('COMMON-BROWSER-NOISE'));
      assert((ok.match(/<p>/g)||[]).length>=2);
      assert.equal(requests.filter(r=>r.url==='/runtime.js').length,1,'API is reused without another CORS request');
      assert.equal(requests[0].origin,fixtureUrl,'actual cross-origin request');
      const blocked=await dump(fixtureUrl+'/blocked',profile);
      assert.match(blocked,/data-common-error="Error: Common runtime HTTP 403"/);
      assert(!bodyAttributes(blocked).includes('data-common-version'));
      const noCors=await dump(fixtureUrl+'/no-cors',profile);
      assert.match(noCors,/data-common-error="NetworkError:/);
      assert(!bodyAttributes(noCors).includes('data-common-version'));
      const selector=await dump(fixtureUrl+'/selector',profile);
      assert.match(selector,/data-common-error="SyntaxError:/);
      assert(!bodyAttributes(selector).includes('data-common-version'));
    }finally{
      await Promise.all([close(fixture),close(library)]);
      fs.rmSync(profile,{recursive:true,force:true});
    }
  });
test('the shared manual Readability helper matches the legacy DOM, keeps module exports, and rethrows original errors',
  {skip:!chrome?'set USEHTML_CHROME_BIN for actual browser validation':false,timeout:60000},async()=>{
    const archive=JSON.parse(fs.readFileSync(path.join(ROOT,'booksource/BookSource_X6_legado-E-2.json'),'utf8'));
    const source=archive.find(s=>s.bookSourceUrl==='https://www.productmarketingalliance.com/search');
    const original=parse(stripCommon(source.jsLib)).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='auto_clean_up');
    let loads=0;
    const library=http.createServer((req,res)=>{
      loads++;res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(runtime);
    });
    const libraryUrl=await listen(library),paragraph='COMMON-MANUAL-ARTICLE: a shared library preserves the original heading, paragraph, formula image, and local anchor. '.repeat(8);
    const fixture=http.createServer((req,res)=>{
      const mode=req.url.slice(1);
      let code=mode==='original'?js(original):js(browserReadableHelper(COMMIT)).replace(raw,libraryUrl+'/runtime.js');
      code+='\nvar module={exports:null},expected=new TypeError("COMMON-ORIGINAL-DOM-ERROR");';
      if(mode.startsWith('strict-')||mode==='compat'){
        // Load before changing DOM/URL behavior, so this is a Readability error
        // test rather than an HTTP/CORS failure.
        code+='\n'+browserScript(COMMIT,{remove:[]}).replace(raw,libraryUrl+'/runtime.js');
        if(mode==='strict-title')code+='\nObject.defineProperty(document,"title",{get:function(){throw expected;}});';
        else if(mode==='strict-attribute')code+='\nvar setAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(name==="data-strict-attribute")throw expected;return setAttribute.call(this,name,value);};';
        else code+='\nwindow.URL=function(){throw expected;};';
      }
      code+='\ntry{'+(mode==='compat'?'window.legadoCommon.webClean(document,{readable:true,remove:[]});':'auto_clean_up();auto_clean_up();')
        +'document.body.setAttribute("data-dom",btoa(document.body.innerHTML));document.body.setAttribute("data-module",typeof module.exports);'
        +'}catch(error){document.body.setAttribute("data-error-identity",String(error===expected));document.body.setAttribute("data-error",String(error));}';
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<html><head><title>COMMON-MANUAL-TITLE</title></head><body><nav>COMMON-MANUAL-NOISE</nav><article>'
        +'<h1>COMMON-MANUAL-TITLE</h1><h2>COMMON-MANUAL-SECTION</h2><p>'+paragraph+'</p><p>'+paragraph+'</p>'
        +'<font data-strict-attribute="case">'+paragraph+'</font><img src="images/formula.svg" alt="x^2"><a href="#local">local</a>'
        +'</article><script>'+code+'</script></body></html>');
    });
    const fixtureUrl=await listen(fixture),profile=fs.mkdtempSync(path.join(os.tmpdir(),'booksrc-manual-browser-'));
    try{
      const baseline=await dump(fixtureUrl+'/original',profile),beforeLoads=loads;
      const shared=await dump(fixtureUrl+'/shared',profile);
      assert.equal(loads-beforeLoads,1,'repeated manual calls reuse the common API');
      assert.match(baseline,/data-module="function"/);assert.match(shared,/data-module="function"/);
      const dom=value=>value.match(/data-dom="([^"]+)"/)?.[1];
      assert(dom(baseline),'legacy article was extracted');assert.equal(dom(shared),dom(baseline),'same actual DOM after two calls');
      for(const mode of ['strict-url','strict-title','strict-attribute']){
        const failure=await dump(fixtureUrl+'/'+mode,profile);
        const attrs=bodyAttributes(failure).replace(/data-dom="[^"]*"/g,'data-dom="[present]"');
        assert.match(attrs,/data-error-identity="true"/,mode);
        assert.match(attrs,/data-error="TypeError: COMMON-ORIGINAL-DOM-ERROR"/,mode);
      }
      const compat=await dump(fixtureUrl+'/compat',profile);
      assert(dom(compat),'normal webClean retains vendor malformed-page compatibility');
      assert(!bodyAttributes(compat).includes('data-error='));
    }finally{
      await Promise.all([close(fixture),close(library)]);fs.rmSync(profile,{recursive:true,force:true});
    }
  });
