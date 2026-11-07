'use strict';
const path = require('node:path');
const {spawn} = require('node:child_process');

function debug(url, protocols, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const env = {...process.env};
    for (const key of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[key];
    env.NO_PROXY = '*'; env.no_proxy = '*';
    const child = spawn(process.env.USEHTML_PYTHON || 'python3',
      [path.join(__dirname, 'usehtml_ws_transport.py')], {env, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', stderr = '', settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('independent WS transport exceeded its deadline'));
    }, timeoutMs + 5000);
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    }
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', value => {
      output += value;
      if (Buffer.byteLength(output) > 16 * 1024 * 1024) {
        child.kill('SIGTERM'); finish(new Error('independent WS evidence exceeded size limit'));
      }
    });
    child.stderr.on('data', bytes => {if (stderr.length < 2000) stderr += bytes.toString('utf8');});
    child.on('close', code => {
      if (code !== 0) return finish(new Error('independent WS transport exit ' + code + ': ' + stderr));
      try {finish(null, JSON.parse(output));} catch {finish(new Error('invalid independent WS transport result'));}
    });
    child.stdin.end(JSON.stringify({url, protocols, message, timeoutMs}));
  });
}
module.exports = {debug};
