'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createClient, errorDetails} = require('../usehtml_http_ws_client');

function setup(required, token) {
  const calls = [], sockets = [];
  class FakeSocket extends EventTarget {
    constructor(url, protocols) {
      super(); sockets.push({url, protocols});
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(text) {
      sockets[sockets.length - 1].message = JSON.parse(text);
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent('message', {data: '正文页解析完成'}));
        this.close(1000, '调试结束');
      });
    }
    close(code, reason) {
      const event = new Event('close');
      Object.assign(event, {code, reason}); this.dispatchEvent(event);
    }
  }
  const fetcher = async (url, options) => {
    calls.push({url, options});
    const route = new URL(url).pathname;
    const data = route === '/getJsSourceApiTokenRequired' ? required :
      route === '/getBookSources' ? [{bookSourceUrl: 'test-source', bookSourceName: 'Test'}] : '';
    return new Response(JSON.stringify({isSuccess: true, data}), {status: 200});
  };
  return {client: createClient('127.0.0.1', {fetch: fetcher, WebSocket: FakeSocket, token}), calls, sockets};
}

test('token-disabled server still gets the mandatory legado WebSocket protocol', async () => {
  const {client, calls, sockets} = setup(false);
  const result = await client.debug('test-source', '--https://example.test/article', 1000);
  assert(result.opened && !result.timedOut && !result.connectionError);
  assert.equal(result.closeCode, 1000);
  assert.deepEqual(result.messages, ['正文页解析完成']);
  assert.deepEqual(sockets[0].protocols, ['legado']);
  assert.equal(new URL(sockets[0].url).port, '1123');
  assert.deepEqual(sockets[0].message, {tag: 'test-source', key: '--https://example.test/article'});
  assert(calls.every(call => new URL(call.url).port === '1122'));
});

test('required-token policy is respected rather than disabled or guessed', async () => {
  const {client, sockets} = setup(true);
  await assert.rejects(client.debug('test-source', 'key', 1000), /requires a Web token/);
  assert.equal(sockets.length, 0);
  const token = 'synthetic token 😀';
  const configured = setup(true, token);
  await configured.client.debug('test-source', 'key', 1000);
  assert.deepEqual(configured.sockets[0].protocols,
    ['legado', 'legado.token.' + Buffer.from(token).toString('base64url')]);
});

test('unknown token policy does not start a debug connection', async () => {
  const {client, sockets} = setup(null);
  await assert.rejects(client.debug('test-source', 'key', 1000), /could not confirm Web token policy/);
  assert.equal(sockets.length, 0);
});

test('HTTP save/readback and delete use actual source objects, never a protocol tool call', async () => {
  const {client, calls} = setup(false);
  const source = {bookSourceUrl: 'test-source', bookSourceName: 'Test'};
  assert.deepEqual(await client.save(source, ['bookSourceName']), source);
  await client.deleteSources([source]);
  const posts = calls.filter(call => call.options.method === 'POST');
  assert.deepEqual(posts.map(call => new URL(call.url).pathname), ['/saveBookSource', '/deleteBookSources']);
  assert.deepEqual(JSON.parse(posts[1].options.body), [source]);
  assert(calls.every(call => new URL(call.url).port === '1122'));
});

test('save readback errors name the field without exposing its private contents', async () => {
  const source={bookSourceUrl:'test-source',jsLib:'synthetic-private-expected'};
  const client=createClient('127.0.0.1',{fetch:async url => new Response(JSON.stringify({
    isSuccess:true,data:new URL(url).pathname==='/getBookSources'?
      [{bookSourceUrl:'test-source',jsLib:'synthetic-private-actual'}]:''
  }),{status:200})});
  await assert.rejects(client.save(source,['jsLib']),error=>{
    assert(error.message.includes('jsLib'));
    assert(!error.message.includes('synthetic-private'));
    return true;
  });
});

test('debug records timings and preserves sanitized protocol error details', async () => {
  class BrokenSocket extends EventTarget {
    constructor() {super(); queueMicrotask(() => this.dispatchEvent(new Event('open')));}
    send() {
      this.dispatchEvent(new MessageEvent('message', {data: '开始解析'}));
      const event = new Event('error');
      event.error = Object.assign(new Error('Invalid frame opcode'), {code: 'WS_PROTOCOL_ERROR'});
      this.dispatchEvent(event);
    }
  }
  const client = createClient('127.0.0.1', {WebSocket: BrokenSocket,
    fetch: async () => new Response(JSON.stringify({isSuccess: true, data: false}))});
  const result = await client.debug('test-source', '--article', 1000);
  assert(result.connectionError && result.closeCode === 1006);
  assert.equal(result.connectionFailure.code, 'WS_PROTOCOL_ERROR');
  assert.equal(result.connectionFailure.message, 'Invalid frame opcode');
  assert(result.elapsedMs >= 0 && result.messageTimingsMs.length === 1);
  assert(result.messageTimingsMs[0] <= result.elapsedMs);
});

test('HTTP error diagnostics retain timeout cause without URLs or secrets', () => {
  const cause = Object.assign(new Error('https://example.test/private token=synthetic-secret'),
    {code: 'UND_ERR_HEADERS_TIMEOUT'});
  const details = errorDetails(new TypeError('fetch failed', {cause}));
  assert.equal(details.cause.code, 'UND_ERR_HEADERS_TIMEOUT');
  assert(!JSON.stringify(details).includes('synthetic') && !JSON.stringify(details).includes('example.test'));
});
test('task-scoped HTTP connection-close option does not alter auth or request body', async () => {
  const calls=[];
  const c=createClient('localhost',{token:'synthetic',closeConnection:true,fetch:async(url,options)=>{
    calls.push(options);return new Response(JSON.stringify({isSuccess:true,data:''}));
  }});
  await c.request('/saveBookSource',{bookSourceUrl:'fixture'});
  assert.equal(calls[0].headers.Connection,'close');
  assert.equal(calls[0].headers['x-legado-token'],'synthetic');
  assert.deepEqual(JSON.parse(calls[0].body),{bookSourceUrl:'fixture'});
});

test('non-200 server bodies go only to an explicit private evidence hook', async () => {
  const records=[];
  const c=createClient('localhost',{fetch:async()=>new Response('synthetic-private-body',{status:500}),
    onHttpError:record=>records.push(record)});
  await assert.rejects(c.request('/saveBookSource',{bookSourceUrl:'fixture'}),error=>{
    assert.equal(error.message,'HTTP 500');
    assert(!error.message.includes('private'));
    return true;
  });
  assert.deepEqual(records,[{route:'/saveBookSource',status:500,body:'synthetic-private-body'}]);
});

test('independent WS provider uses verified policy and the same task-scoped request', async () => {
  const calls = [];
  const provider = async (...args) => {calls.push(args); return {opened:true};};
  const make = (required, token) => createClient('127.0.0.1', {token, debugTransport:provider,
    fetch:async () => new Response(JSON.stringify({isSuccess:true,data:required}))});
  await assert.rejects(make(true).debug('source','--article',1000), /requires a Web token/);
  assert.equal(calls.length,0);
  await make(false).debug('source','--article',1000);
  assert.deepEqual(calls[0],['ws://127.0.0.1:1123/bookSourceDebug',['legado'],{tag:'source',key:'--article'},1000]);
});

test('node WS keepalive adds no second debug request and stops at completion', async () => {
  const sent=[];
  class SlowSocket extends EventTarget {
    constructor() {super(); queueMicrotask(() => this.dispatchEvent(new Event('open')));}
    send(data) {
      sent.push(data);
      if(sent.length===1) setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message',{data:'正文页解析完成'}));
        const event=new Event('close'); Object.assign(event,{code:1000,reason:'done'}); this.dispatchEvent(event);
      },35);
    }
  }
  const client=createClient('127.0.0.1',{WebSocket:SlowSocket,heartbeatMs:10,
    fetch:async () => new Response(JSON.stringify({isSuccess:true,data:false}))});
  const result=await client.debug('source','--article',500);
  assert(result.clientHeartbeats>=1);
  assert.deepEqual(JSON.parse(sent[0]),{tag:'source',key:'--article'});
  assert(sent.slice(1).every(value=>value==='ping'));
  const count=sent.length;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(sent.length,count);
});
