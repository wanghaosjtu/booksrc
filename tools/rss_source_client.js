/* Safe client primitives for the phone's native RSS-source API. */
'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');

const HOST = process.env.LEGADO_PHONE || '127.0.0.1';
const HTTP = `http://${HOST}:1122`;
const WS = `ws://${HOST}:1123/rssSourceDebug`;

async function request(url, options = {}, timeout = 30000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return {response, text};
}

function parseReply(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`invalid JSON response: ${text.slice(0, 300)}`);
  }
}

async function sources() {
  const {text} = await request(`${HTTP}/getRssSources`);
  const data = parseReply(text);
  if (data.isSuccess === false) throw new Error(data.errorMsg || 'RSS export failed');
  const result = Array.isArray(data) ? data : data.data;
  assert(Array.isArray(result), 'invalid RSS source export');
  return result;
}

function at(value, path) {
  return path.split('.').reduce((item, key) => item == null ? undefined : item[key], value);
}

function set(value, path, next) {
  const keys = path.split('.');
  let parent = value;
  for (const key of keys.slice(0, -1)) {
    if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
    parent = parent[key];
  }
  if (next === undefined) delete parent[keys.at(-1)];
  else parent[keys.at(-1)] = next;
}

function changedPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object'
      || Array.isArray(before) || Array.isArray(after)) return [prefix];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => changedPaths(
    before[key], after[key], prefix ? `${prefix}.${key}` : key,
  ));
}

/**
 * Apply only leaves deliberately changed from baseline to candidate.  A live
 * source modified after the backup is never overwritten silently.
 */
function merge(before, candidate, live) {
  assert.equal(before.sourceUrl, candidate.sourceUrl, 'source identity changed in candidate');
  assert.equal(before.sourceUrl, live.sourceUrl, 'wrong live RSS source');
  const merged = structuredClone(live);
  for (const path of changedPaths(before, candidate)) {
    const oldValue = at(before, path);
    const liveValue = at(live, path);
    const desiredValue = at(candidate, path);
    if (JSON.stringify(liveValue) !== JSON.stringify(oldValue)
        && JSON.stringify(liveValue) !== JSON.stringify(desiredValue)) {
      throw new Error(`concurrent edit in ${live.sourceName}: ${path}`);
    }
    set(merged, path, desiredValue);
  }
  return merged;
}

async function save(source, expectedPaths = []) {
  const {text} = await request(`${HTTP}/saveRssSource`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(source),
  }, 45000);
  const reply = parseReply(text);
  if (reply.isSuccess === false) throw new Error(reply.errorMsg || 'saveRssSource failed');
  const actual = (await sources()).find((item) => item.sourceUrl === source.sourceUrl);
  assert(actual, `saved RSS source missing: ${source.sourceUrl}`);
  const mismatches = expectedPaths.filter((path) =>
    JSON.stringify(at(actual, path)) !== JSON.stringify(at(source, path)));
  assert.deepEqual(mismatches, [], `RSS source readback mismatch: ${mismatches.join(', ')}`);
  return actual;
}

function wsClientFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i += 1) masked[i] = body[i] ^ mask[i % 4];
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

function debug(sourceUrl, timeout = 90000, key = '') {
  // Use a tiny raw WebSocket client rather than the browser-compatible global
  // WebSocket.  Node's global implementation has no terminate() method; a
  // timed-out native debug could therefore leave the phone's coroutine alive
  // after the test process has moved on.  Destroying the TCP socket guarantees
  // NanoWSD.onClose() runs Debug.cancelDebug(true).
  return new Promise((resolve) => {
    const logs = [];
    const started = Date.now();
    const socket = net.createConnection({host: HOST, port: 1123});
    const secKey = crypto.randomBytes(16).toString('base64');
    let input = Buffer.alloc(0);
    let upgraded = false;
    let finished = false;
    let timeoutId;

    const result = (transport) => ({
      logs: logs.join('\n'), elapsedMs: Date.now() - started, transport,
    });
    const finish = (transport = '') => {
      if (finished) return;
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (!socket.destroyed) {
        if (upgraded && socket.writable) {
          try { socket.write(wsClientFrame(0x8, Buffer.from([0x03, 0xe8]))); } catch (_) {}
        }
        // Force the close even if the peer is stuck in a site request.
        socket.destroy();
      }
      resolve(result(transport));
    };
    const consumeFrames = () => {
      while (upgraded && input.length >= 2) {
        const first = input[0];
        const second = input[1];
        let length = second & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (input.length < 4) return;
          length = input.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
          if (input.length < 10) return;
          const big = input.readBigUInt64BE(2);
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) { finish('websocket-error'); return; }
          length = Number(big); offset = 10;
        }
        const masked = (second & 0x80) !== 0;
        if (masked) offset += 4;
        if (input.length < offset + length) return;
        const frame = input;
        let payload = frame.subarray(offset, offset + length);
        input = frame.subarray(offset + length);
        if (masked) {
          const mask = frame.subarray(offset - 4, offset);
          const unmasked = Buffer.alloc(length);
          for (let i = 0; i < length; i += 1) unmasked[i] = payload[i] ^ mask[i % 4];
          payload = unmasked;
        }
        const opcode = first & 0x0f;
        if (opcode === 0x1) logs.push(payload.toString('utf8'));
        else if (opcode === 0x8) { finish('closed'); return; }
        else if (opcode === 0x9 && socket.writable) {
          try { socket.write(wsClientFrame(0xA, payload)); } catch (_) {}
        }
      }
    };
    socket.on('connect', () => {
      socket.write(
        `GET /rssSourceDebug HTTP/1.1\r\n` +
        `Host: ${HOST}:1123\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${secKey}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        '\r\n',
      );
    });
    socket.on('data', (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (!upgraded) {
        const boundary = input.indexOf(Buffer.from('\r\n\r\n'));
        if (boundary < 0) return;
        const header = input.subarray(0, boundary).toString('latin1');
        input = input.subarray(boundary + 4);
        if (!/^HTTP\/1\.1 101\b/m.test(header)) {
          logs.push(`WebSocket handshake failed: ${header.slice(0, 300)}`);
          finish('websocket-error');
          return;
        }
        upgraded = true;
        socket.write(wsClientFrame(0x1, JSON.stringify({tag: sourceUrl, key})));
      }
      consumeFrames();
    });
    socket.on('error', (error) => {
      logs.push(String(error));
      finish('websocket-error');
    });
    socket.on('close', () => finish(finished ? 'closed' : 'websocket-error'));
    timeoutId = setTimeout(() => finish('timeout'), timeout);
  });
}

module.exports = {HOST, HTTP, WS, request, sources, at, set, changedPaths, merge, save, debug};
