'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {summarizeDebug} = require('../usehtml_http_ws_client');

test('successful transport alone is not completed content or TOC validation', () => {
  const result = {transport: 'websocket', opened: true, closeCode: 1000, messages: ['开始解析正文页']};
  assert(summarizeDebug(result, '--https://example.test/article').isError);
  assert(summarizeDebug(result, '++https://example.test/toc').isError);
  result.messages.push('<usehtml><h1>Heading</h1></usehtml>', '︽正文页解析完成');
  const summary = summarizeDebug(result, '--https://example.test/article');
  assert(!summary.isError && summary.contentFinished);
  assert.equal(summary.usehtmlBlocks, 1);
  assert.equal(summary.headingTags, 1);
});

test('normal WS closure with a ScriptException is an error, including auth and formula cases', () => {
  for (const message of ['com.script.ScriptException: IEEE 需要手动认证',
    'org.htmlunit.corejs.javascript.JavaScriptException: IEEE 需要手动认证',
    '不允许的字符 d\\mathrm{snr}', 'ReferenceError: missingName', '调试通道占用中，请稍后重试']) {
    const summary = summarizeDebug({opened: true, closeCode: 1000, messages: [message]}, '--https://example.test/article');
    assert(summary.isError, message);
    assert(summary.errors.length, message);
  }
});

test('debug error summaries redact URLs and credential-shaped fields', () => {
  const summary = summarizeDebug({opened: true, closeCode: 1000,
    messages: ['ScriptException: https://example.test/?secret=synthetic token=synthetic-secret']}, '--article');
  assert(summary.isError);
  assert(!summary.errors.join('').includes('synthetic'));
});

test('transport errors remain errors even when a completion message exists', () => {
  const result = {opened: true, closeCode: 1000, messages: ['正文页解析完成']};
  assert(!summarizeDebug(result, '--article').isError);
  for (const overrides of [{opened: false}, {closeCode: 1006}, {timedOut: true}, {connectionError: true}]) {
    assert(summarizeDebug({...result, ...overrides}, '--article').isError);
  }
});
test('echoed request source is not a runtime exception, but real failures beside it remain visible',()=>{
  const url='https://example.test/health,'+JSON.stringify({bodyJs:'var expected=new SyntaxError("caught");var note="正文页解析完成 目录页解析完成 <usehtml><h1>input</h1></usehtml> 调试通道占用中";'});
  const result={opened:true,closeCode:1000,messages:['开始访正文页:'+url,'获取成功:'+url,'正文页解析完成']};
  assert(!summarizeDebug(result,'--'+url).isError);
  assert.deepEqual(summarizeDebug(result,'--'+url).errors,[]);
  const incomplete=summarizeDebug({...result,messages:result.messages.slice(0,-1)},'--'+url);
  assert(incomplete.isError&&!incomplete.contentFinished&&!incomplete.tocFinished&&!incomplete.busy);
  assert.equal(incomplete.usehtmlBlocks,0);assert.equal(incomplete.headingTags,0);
  for(const message of ['SyntaxError: actual bug','TypeError: actual bug','ScriptException: '+url+' actual bug']){
    assert(summarizeDebug({...result,messages:[...result.messages,message]},'--'+url).isError);
  }
});
test('empty or keyword debug keys cannot erase actual exception names',()=>{
  for(const key of ['', 'SyntaxError'])assert(summarizeDebug({opened:true,closeCode:1000,messages:['SyntaxError: actual bug']},key).isError);
});
