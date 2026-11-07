#!/usr/bin/env node
/* Task-scoped browser diagnostics; reuse the selected skill's CDP implementation. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ROOT} = require('./build_usehtml_validation');
const DIR = path.join(ROOT,'booksource/.usehtml-validation-phone');
const TARGET = path.join(DIR,'ieee-browser-owned-target-v1.json');
const URL = 'https://ieeexplore.ieee.org/document/9737357/';
const REST = 'https://ieeexplore.ieee.org/rest/document/9737357/?logAccess=true';
const script = process.env.USEHTML_XPRA_SCRIPT;
const port = Number(process.env.USEHTML_CDP_PORT);
const pid = Number(process.env.USEHTML_CDP_PID);
assert(script && path.isAbsolute(script), 'explicit discovered skill helper required');
assert(Number.isInteger(port) && port > 0 && port < 65536 && Number.isInteger(pid) && pid > 0,
  'explicit confirmed Chrome pid and CDP port required');
const write = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const python = String.raw`
import argparse, importlib.util, json, sys
helper, pid, port, command, target = sys.argv[1:]
spec = importlib.util.spec_from_file_location('usehtml_xpra_helper', helper)
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)
args = argparse.Namespace(pid=int(pid), port=int(port))
candidate = driver.session(args, auto_start=False)
assert candidate.pid == int(pid) and candidate.port == int(port), 'browser changed'
assert candidate.display and not candidate.headless, 'visible browser required'
browser = (candidate.cdp or driver.cdp_version(candidate.port))['webSocketDebuggerUrl']
if command == 'create':
    result = driver.cdp_call(browser, 'Target.createTarget', {'url':'https://ieeexplore.ieee.org/document/9737357/'})
elif command == 'close':
    result = driver.cdp_call(browser, 'Target.closeTarget', {'targetId':target})
else:
    with driver.local_open().open('http://127.0.0.1:%d/json/list' % candidate.port, timeout=3) as response:
        pages = json.loads(response.read().decode())
    page = next((item for item in pages if item.get('id') == target and item.get('type') == 'page'), None)
    assert page, 'owned browser target missing'
    expression = sys.stdin.read()
    result = driver.cdp_call(page['webSocketDebuggerUrl'], 'Runtime.evaluate',
        {'expression':expression, 'returnByValue':True, 'awaitPromise':True})
    assert not result.get('exceptionDetails'), 'owned page script rejected'
    result = result.get('result',{}).get('value')
print(json.dumps(result, ensure_ascii=False))
`;
async function cdp(command,target='',expression='') {
  if (command === 'evaluate') new (require('node:vm').Script)(expression);
  const child = require('node:child_process').spawn('python3',['-c',python,script,String(pid),String(port),command,target],
    {stdio:['pipe','pipe','pipe']});
  child.stdin.end(expression);
  const stdout=[],stderr=[];
  child.stdout.on('data',b=>stdout.push(b)); child.stderr.on('data',b=>stderr.push(b));
  const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  clearTimeout(timer);
  assert.equal(code,0,'CDP helper failed; browser state preserved');
  return JSON.parse(Buffer.concat(stdout).toString('utf8'));
}
function owned() {
  const state=JSON.parse(fs.readFileSync(TARGET,'utf8'));
  assert.equal(state.pid,pid); assert.equal(state.port,port); assert.equal(state.url,URL);
  assert(typeof state.targetId==='string' && /^[a-zA-Z0-9]+$/.test(state.targetId),'invalid owned target');
  return state;
}
async function main(command,label) {
  if(command==='create') {
    assert(!fs.existsSync(TARGET),'browser task already exists; inspect it');
    const result=await cdp('create'); assert(result.targetId,'no owned target created');
    write(TARGET,{pid,port,url:URL,targetId:result.targetId,createdAt:new Date().toISOString()});
    return {created:true,task:'IEEE 9737357',existingTabs:'preserved'};
  }
  const state=owned();
  if(command==='inspect') return cdp('evaluate',state.targetId,`(() => {
    const text=document.body ? document.body.innerText : '';
    return {host:location.hostname,ready:document.readyState,htmlLength:document.documentElement.outerHTML.length,
      title:document.title,headings:document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      mathScripts:document.querySelectorAll('script[type^="math/tex"]').length,
      blocked:/max challenge attempts exceeded|aws waf|access denied|unusual traffic|verify you are human|captcha/i.test(text),
      articleText:/Integrated Sensing and Communication/i.test(text)};
  })()`);
  if(command==='capture-lead') {
    assert(label && /^[a-zA-Z0-9_-]+$/.test(label),'fresh lead capture label required');
    const file=path.join(DIR,label+'.json'); assert(!fs.existsSync(file),'capture exists');
    const response=await cdp('evaluate',state.targetId,`(() => {
      if (location.hostname !== 'ieeexplore.ieee.org') throw Error('task needs human login');
      const parts=[...document.querySelectorAll('h1.document-title,div.toc-container,div.abstract-text')].map(node=>{
        const copy=node.cloneNode(true);
        copy.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(el=>el.remove());
        [copy,...copy.querySelectorAll('*')].forEach(el=>{
          [...el.attributes].forEach(attr=>{if(/^on|^data-/i.test(attr.name))el.removeAttribute(attr.name);});
          for(const name of ['href','src']) {
            const value=el.getAttribute(name)||'';
            if(/(?:token|signature|ticket|credential|sessionid|x-amz-)[=]/i.test(value))el.removeAttribute(name);
          }
        });
        return copy.outerHTML;
      });
      const title=document.querySelector('h1.document-title');
      const abstract=document.querySelector('div.abstract-text');
      return {kind:'article-lead-DOM-projection-no-account-page',host:location.hostname,
        title:title?title.innerText.trim():document.title.split(' | ')[0],
        abstractText:abstract?abstract.innerText.trim():'',
        parts:parts.length,html:parts.join('\\n')};
    })()`);
    assert(response && response.host==='ieeexplore.ieee.org' && response.title,'invalid article lead');
    write(file,response);
    return {label,kind:response.kind,parts:response.parts,length:response.html.length,abstractLength:response.abstractText.length};
  }
  if(command==='capture') {
    assert(label && /^[a-zA-Z0-9_-]+$/.test(label),'fresh capture label required');
    const file=path.join(DIR,label+'.json'); assert(!fs.existsSync(file),'capture exists');
    const response=await cdp('evaluate',state.targetId,`(async () => {
      if (location.hostname !== 'ieeexplore.ieee.org') throw Error('task needs human login');
      const response=await fetch(${JSON.stringify(REST)},{credentials:'include'});
      return {status:response.status,host:new URL(response.url).hostname,body:await response.text()};
    })()`);
    assert(response && typeof response.body==='string','invalid task response');
    write(file,response);
    return {label,status:response.status,host:response.host,length:response.body.length,
      snrFormula:response.body.replace(/\s+/g,'').includes('d\\mathrm{snr}'),htmlTags:(response.body.match(/<h[1-6]\b/g)||[]).length,
      isHtml:/<[^>]+>/.test(response.body)};
  }
  if(command==='close') return cdp('close',state.targetId);
  throw Error('command must be create, inspect, capture or close');
}
main(...process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{
  console.error(String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,500)); process.exitCode=1;
});
