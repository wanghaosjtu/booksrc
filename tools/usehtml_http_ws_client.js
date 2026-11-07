'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

function errorDetails(error, depth = 0) {
  if (!error) return null;
  const redact = value => String(value || '').replace(/https?:\/\/\S+/g, '[URL]')
    .replace(/(?:cookie|authorization|password|token|api[-_]?key)\s*[:=][^\n]*/gi, '[redacted]').slice(0, 350);
  const details = {name: redact(error.name || 'Error'), message: redact(error.message)};
  if (error.code) details.code = redact(error.code);
  if (error.cause && depth < 2) details.cause = errorDetails(error.cause, depth + 1);
  return details;
}

function changedPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object'
      || Array.isArray(before) || Array.isArray(after)) return [prefix];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .flatMap(key => changedPaths(before[key], after[key], prefix ? prefix + '.' + key : key));
}

function summarizeDebug(result, key = '') {
  const text = result.messages.join('\n');
  const contentFinished = /正文页解析完成/.test(text);
  const tocFinished = /目录页解析完成/.test(text);
  const error = /(?:ScriptException|JavaScriptException|ReferenceError|EvaluatorException|EcmaError|SyntaxError|UnknownHostException|SocketTimeoutException|ContentEmptyException|调试通道占用中|目录列表为空|需要手动认证|不允许的字符)/;
  const missingCompletion = key.startsWith('--') ? !contentFinished : key.startsWith('++') ? !tocFinished : false;
  return {
    transport: result.transport, opened: result.opened, timedOut: result.timedOut,
    elapsedMs: result.elapsedMs, connectionFailure: result.connectionFailure,
    implementation: result.implementation, clientHeartbeats: result.clientHeartbeats, pingCount: result.pingCount,
    isError: !!(result.connectionError || result.timedOut || !result.opened || result.closeCode !== 1000
      || error.test(text) || missingCompletion),
    busy: /调试通道占用中/.test(text), characters: text.length,
    contentFinished, tocFinished,
    usehtmlBlocks: (text.match(/<usehtml>/g) || []).length,
    headingTags: (text.match(/<h[1-6]\b/g) || []).length,
    errors: text.split('\n').filter(line => error.test(line)).slice(0, 3)
      .map(line => line.replace(/https?:\/\/\S+/g, '[URL]')
        .replace(/(?:cookie|authorization|password|token|api[-_]?key)\s*[:=][^\n]*/gi, '[redacted]').slice(0, 250))
  };
}

function privateToken(file) {
  if (!file) return '';
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o777) === 0o600, 'Web token file must be an owned, private regular file');
  const token = fs.readFileSync(file, 'utf8').trim();
  assert(token, 'Web token file is empty');
  return token;
}

function createClient(host, options = {}) {
  assert(host && /^[a-zA-Z0-9.:-]+$/.test(host), 'explicit phone host required');
  const http = 'http://' + host + ':1122';
  const wsUrl = 'ws://' + host + ':1123/bookSourceDebug';
  const fetcher = options.fetch || globalThis.fetch;
  const Socket = options.WebSocket || globalThis.WebSocket;
  const token = options.token || privateToken(options.tokenFile);
  async function request(route, body, timeout = 45000) {
    assert(route.startsWith('/'), 'relative API route required');
    const headers = token ? {'x-legado-token': token} : {};
    if (options.closeConnection) headers.Connection = 'close';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetcher(http + route, {
      headers,
      ...(body === undefined ? {} : {method: 'POST', body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) {
      // Optional task-private evidence hook; do not expose server bodies in
      // generic diagnostics (they can contain source scripts or credentials).
      if (options.onHttpError) await options.onHttpError({route, status:response.status, body:await response.text()});
      throw new Error('HTTP ' + response.status);
    }
    const value = await response.json();
    if (value.isSuccess === false) {
      throw new Error(String(value.errorMsg || 'phone request failed').replace(/https?:\/\/\S+/g, '[URL]'));
    }
    return Array.isArray(value) ? value : value.data;
  }
  async function sources() {
    const list = await request('/getBookSources');
    assert(Array.isArray(list) && list.length, 'empty source list');
    return list;
  }
  async function save(source, expectedPaths = []) {
    await request('/saveBookSource', source);
    const actual = (await sources()).find(s => s.bookSourceUrl === source.bookSourceUrl);
    assert(actual, 'saved source missing from readback');
    const at = (value, name) => name.split('.').reduce((v, key) => v == null ? undefined : v[key], value);
    for (const name of expectedPaths) {
      assert.equal(changedPaths(at(actual, name), at(source, name)).length, 0, 'source readback mismatch at ' + name);
    }
    return actual;
  }
  async function deleteSources(records) {
    assert(Array.isArray(records) && records.length && records.every(s => s.bookSourceUrl),
      'actual source objects required for HTTP deletion');
    return request('/deleteBookSources', records);
  }
  async function debug(sourceId, key, timeout = 120000) {
    assert(sourceId && key, 'source ID and debug key required');
    const required = await request('/getJsSourceApiTokenRequired', undefined, 10000);
    assert.equal(typeof required, 'boolean', 'could not confirm Web token policy');
    const protocols = ['legado'];
    if (required) {
      assert(token, 'phone requires a Web token; provide a private LEGADO_WEB_TOKEN_FILE');
      protocols.push('legado.token.' + Buffer.from(token, 'utf8').toString('base64url'));
    }
    if (options.debugTransport) return options.debugTransport(wsUrl, protocols, {tag: sourceId, key}, timeout);
    assert(typeof Socket === 'function', 'Node WebSocket support required');
    return new Promise((resolve) => {
      const messages = [];
      const started = Date.now(), messageTimingsMs = [];
      let opened = false, timedOut = false, connectionError = false, finished = false;
      let connectionFailure;
      let closeTimer, heartbeat;
      let clientHeartbeats = 0;
      const socket = new Socket(wsUrl, protocols);
      const finish = (code, reason) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer); clearTimeout(closeTimer); clearInterval(heartbeat);
        resolve({transport: 'websocket', opened, timedOut, connectionError,
          elapsedMs: Date.now() - started, messageTimingsMs, connectionFailure, clientHeartbeats,
          implementation: 'node-websocket',
          closeCode: code, closeReason: reason, messages});
      };
      const timer = setTimeout(() => {
        timedOut = true;
        closeTimer = setTimeout(() => finish(1006, 'client timeout'), 1000);
        try { socket.close(1000, 'isolated validation timeout'); }
        catch { finish(1006, 'client timeout'); }
      }, timeout);
      socket.addEventListener('open', () => {
        opened = true;
        socket.send(JSON.stringify({tag: sourceId, key}));
        const heartbeatMs = options.heartbeatMs === undefined ? 10000 : options.heartbeatMs;
        if (heartbeatMs > 0 && !finished) heartbeat = setInterval(() => {
          if (finished) return;
          try {
            // The inspected server ignores subsequent data after requestReceived.
            // Incoming traffic keeps the socket alive before its 30-second heartbeat.
            socket.send('ping'); clientHeartbeats++;
          } catch (error) {
            connectionError = true; connectionFailure = errorDetails(error);
            finish(1006, 'client heartbeat failed');
          }
        }, heartbeatMs);
      });
      socket.addEventListener('message', event => {
        if (typeof event.data === 'string' && event.data !== 'ping') {
          messages.push(event.data); messageTimingsMs.push(Date.now() - started);
          if (options.onMessage) options.onMessage(event.data);
        }
      });
      socket.addEventListener('error', event => {
        connectionError = true;
        connectionFailure = errorDetails(event.error || event);
        finish(1006, 'WebSocket connection error');
      });
      socket.addEventListener('close', event => finish(event.code, event.reason));
    });
  }
  return {request, sources, save, deleteSources, debug, changedPaths};
}

let active;
function phone() {
  const host = process.env.LEGADO_PHONE;
  assert(host, 'set LEGADO_PHONE explicitly');
  if (!active || active.host !== host) active = {host,
    client: createClient(host, {tokenFile: process.env.LEGADO_WEB_TOKEN_FILE,
      debugTransport: process.env.LEGADO_WS_TRANSPORT === 'python' ? require('./usehtml_python_ws').debug : undefined})};
  return active.client;
}
module.exports = {createClient, changedPaths, summarizeDebug, errorDetails,
  request: (...args) => phone().request(...args),
  sources: (...args) => phone().sources(...args),
  save: (...args) => phone().save(...args),
  deleteSources: (...args) => phone().deleteSources(...args),
  debug: (...args) => phone().debug(...args)};
