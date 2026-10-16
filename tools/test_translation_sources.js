#!/usr/bin/env node
/* Sequential phone test for every formal translated source. */
const fs = require('fs');
const { URL } = require('url');

const PHONE = process.env.LEGADO_PHONE || '10.92.27.11';
const HTTP = `http://${PHONE}:1122`;
const WS = `ws://${PHONE}:1123/bookSourceDebug`;
const TIMEOUT = Number(process.env.LEGADO_TEST_TIMEOUT || 90000);
const USE_PHONE_SOURCE = process.env.LEGADO_USE_PHONE_SOURCE === '1';
const DATA = JSON.parse(fs.readFileSync('booksource/legado-book-sources-current.json', 'utf8'));
const LOGIN_FIELDS = ['loginUrl', 'loginUi', 'header', 'enabledCookieJar'];
const LOGIN_BACKUP = JSON.parse(fs.readFileSync('booksource/BookSource_X6_legado-E-2.json', 'utf8'));
const LOGIN_BY_ID = new Map(LOGIN_BACKUP.map((source) => [
  String(source.bookSourceName) + '||' + String(source.bookSourceUrl), source,
]));
const only = new Set(String(process.env.LEGADO_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean));
const sources = DATA.filter((s) => {
  const text = JSON.stringify(s).toLowerCase();
  return s.bookSourceName !== 'Test'
    && (!only.size || only.has(String(s.bookSourceName).trim()))
    && ['microsoft', 'edge.microsoft.com', 'translatetext'].some((x) => text.includes(x));
});

function firstExploreEntry(value) {
  const text = String(value || '').trim();
  const marker = text.indexOf('::');
  if (marker < 0) return '';
  const rest = text.slice(marker + 2);
  const next = rest.search(/\s+(?=[^:\n]{1,100}::)/);
  return text.slice(0, marker + 2 + (next < 0 ? rest.length : next)).trim();
}

function entryPayload(entry) {
  const marker = entry.indexOf('::');
  return marker < 0 ? '' : entry.slice(marker + 2).trim();
}

function literalUrl(payload, base) {
  if (!payload || payload.startsWith('@js:') || payload.startsWith('@js')) return '';
  const raw = payload.split(',{', 1)[0].trim();
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) return '';
  try { return new URL(raw, base).toString(); } catch (_) { return ''; }
}

async function postSource(source) {
  const response = await fetch(`${HTTP}/saveBookSource`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(source),
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch (_) {}
  if (!response.ok || !parsed || parsed.isSuccess !== true) {
    throw new Error(`saveBookSource HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
}

function sourceId(source) {
  return String(source.bookSourceName) + '||' + String(source.bookSourceUrl);
}

function protectedEqual(field, actual, expected) {
  if (field === 'header' && !actual && !expected) return true;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sourceWithE2Login(source) {
  const baseline = LOGIN_BY_ID.get(sourceId(source));
  if (!baseline) throw new Error(`E-2 source missing: ${source.bookSourceName}`);
  const copy = {...source};
  for (const field of LOGIN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(baseline, field)) copy[field] = baseline[field];
    else delete copy[field];
  }
  return copy;
}

async function getPhoneSources() {
  const response = await fetch(`${HTTP}/getBookSources`);
  if (!response.ok) throw new Error(`getBookSources HTTP ${response.status}`);
  const body = await response.json();
  return body.data || [];
}

async function assertPhoneLogin(source) {
  const phone = (await getPhoneSources()).find((item) => sourceId(item) === sourceId(source));
  if (!phone) throw new Error(`phone source missing after write: ${source.bookSourceName}`);
  const baseline = LOGIN_BY_ID.get(sourceId(source));
  const errors = LOGIN_FIELDS.filter((field) => !protectedEqual(field, phone[field], baseline[field]));
  if (errors.length) throw new Error(`phone E-2 login field mismatch for ${source.bookSourceName}: ${errors.join(',')}`);
}

function debug(tag, key) {
  return new Promise((resolve) => {
    const logs = [];
    const started = Date.now();
    let finished = false;
    let socket;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      try { if (socket && socket.readyState < 2) socket.close(); } catch (_) {}
      resolve({logs: logs.join('\n'), elapsed: Date.now() - started, error: error || ''});
    };
    try {
      socket = new WebSocket(WS);
      socket.onopen = () => socket.send(JSON.stringify({tag, key}));
      socket.onmessage = (event) => logs.push(String(event.data));
      socket.onerror = () => finish('websocket error');
      socket.onclose = () => finish('');
      setTimeout(() => finish('timeout'), TIMEOUT);
    } catch (error) {
      finish(String(error));
    }
  });
}

function normalizeUrl(value, base) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Legado appends request options as ,{"webView":true}; preserve that
  // suffix instead of URL-encoding it into the path.
  const optionAt = raw.indexOf(',{');
  const rawUrl = optionAt >= 0 ? raw.slice(0, optionAt) : raw;
  const options = optionAt >= 0 ? raw.slice(optionAt) : '';
  try { return new URL(rawUrl, base).toString() + options; } catch (_) { return ''; }
}

function chapterLinks(log, base) {
  return [...String(log).matchAll(/章节链接:\s*([^\s\r\n]+)/g)]
    .map((m) => normalizeUrl(m[1], base)).filter(Boolean);
}

function tocLinks(log, base) {
  const values = [];
  const text = String(log);
  for (const re of [/获取目录链接:\s*([^\s\r\n]+)/g, /开始解析目录页:([^\s\r\n]+)/g]) {
    for (const match of text.matchAll(re)) {
      const url = normalizeUrl(match[1], base);
      if (url && !values.includes(url)) values.push(url);
    }
  }
  return values;
}

function chapterNames(log) {
  return [...String(log).matchAll(/章节名称:\s*(.+)/g)].map((m) => m[1].trim()).filter(Boolean);
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function hasRuleError(log) {
  return /(SelectorParseException|ReferenceError|TypeError|SyntaxError|脚本执行异常|规则解析失败|Could not parse query)/i.test(String(log));
}

function hasWaf(log) {
  return /(WAF|AWS challenge|Access Denied|要求浏览器验证|CloudFront)/i.test(String(log));
}

function directoryComplete(log, base) {
  if (hasRuleError(log)) return false;
  // JSON discovery sources (notably IEEE) finish with “发现页解析完成”
  // and report the parsed record count, without emitting the normal
  // “首章信息/章节链接” lines. Treat a positive parsed list as a valid
  // directory result so the harness does not fall through to an empty
  // bookSourceUrl fallback and overwrite the successful result.
  if (/发现页解析完成/.test(log) && /列表大小:\s*[1-9]\d*/.test(log)) return true;
  return /目录页解析完成/.test(log) && chapterLinks(log, base).length > 0;
}

function contentComplete(log) {
  return /正文页解析完成/.test(log) && /获取正文内容/.test(log) && !hasRuleError(log);
}

function candidates(source) {
  const result = [];
  const entry = firstExploreEntry(source.exploreUrl);
  if (entry) {
    // Preserve the original explore expression so Legado evaluates templates
    // and @js variables instead of receiving an encoded literal URL.
    // Relative chapter links resolve against the page actually fetched, not bookSourceUrl.
    const url = literalUrl(entryPayload(entry), source.bookSourceUrl);
    result.push({kind: 'explore', key: entry, source: url});
    if (url) result.push({kind: 'toc', key: `++${url}`, source: url});
  }
  if (/^https?:\/\//i.test(String(source.bookSourceUrl || ''))) {
    result.push({kind: 'toc', key: `++${source.bookSourceUrl}`, source: source.bookSourceUrl});
  }
  return result.filter((item, index, all) => all.findIndex((x) => x.key === item.key) === index);
}

async function testSource(source) {
  const item = {
    name: source.bookSourceName,
    url: source.bookSourceUrl,
    enabled: source.enabled !== false,
    directory: 'FAIL',
    content: 'BLOCKED',
    reason: '',
    directoryElapsed: 0,
    contentElapsed: 0,
  };
  let directoryLog = '';
  let chapterUrl = '';
  const queue = candidates(source);
  const tried = new Set();
  while (queue.length && item.directory !== 'PASS') {
    const candidate = queue.shift();
    if (tried.has(candidate.key)) continue;
    tried.add(candidate.key);
    const base = candidate.source || source.bookSourceUrl;
    const result = await debug(source.bookSourceUrl, candidate.key);
    directoryLog += `\n${result.logs}`;
    if (directoryComplete(result.logs, base)) {
      item.directory = 'PASS';
      chapterUrl = chapterLinks(result.logs, base)[0];
      item.directoryElapsed = result.elapsed;
      break;
    }
    for (const url of tocLinks(result.logs, base)) {
      queue.push({kind: 'toc', key: `++${url}`, source: url});
    }
    if (!item.reason) item.reason = result.error || (hasWaf(result.logs) ? 'WAF/站点验证' : '目录无有效章节');
  }
  if (item.directory !== 'PASS') {
    item.content = hasWaf(directoryLog) ? 'BLOCKED' : 'FAIL';
    return {...item, detail: directoryLog.slice(-3000)};
  }
  const content = await debug(source.bookSourceUrl, `--${chapterUrl}`);
  item.contentElapsed = content.elapsed;
  if (contentComplete(content.logs)) {
    item.content = 'PASS';
    const names = chapterNames(directoryLog);
    if (!hasChinese(names.join(' ')) && source.bookSourceName !== '中国工程科学') {
      item.reason = '规则完成但目录标题未检测到中文';
    }
    if (!hasChinese(content.logs) && source.bookSourceName !== '中国工程科学') {
      item.reason = item.reason || '正文完成但未检测到中文';
    }
  } else {
    item.content = hasWaf(content.logs) ? 'BLOCKED' : 'FAIL';
    item.reason = content.error || (hasWaf(content.logs) ? 'WAF/站点验证' : '正文解析或翻译失败');
  }
  return {...item, chapterUrl, detail: `${directoryLog.slice(-1600)}\n${content.logs.slice(-3000)}`};
}

async function main() {
  const results = [];
  const phoneById = USE_PHONE_SOURCE
    ? new Map((await getPhoneSources()).map((source) => [sourceId(source), source]))
    : null;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const currentSource = USE_PHONE_SOURCE ? phoneById.get(sourceId(source)) : sourceWithE2Login(source);
    process.stdout.write(`[${i + 1}/${sources.length}] ${USE_PHONE_SOURCE ? 'read/test' : 'write/test'} ${source.bookSourceName}\n`);
    try {
      if (!currentSource) throw new Error(`phone source missing: ${source.bookSourceName}`);
      if (!USE_PHONE_SOURCE) {
        await postSource(currentSource);
        await assertPhoneLogin(currentSource);
      }
      const tested = await testSource(currentSource);
      results.push({...tested, loginAudit: USE_PHONE_SOURCE ? 'PHONE_CURRENT_PRESERVED' : 'E2'});
    } catch (error) {
      results.push({name: source.bookSourceName, url: source.bookSourceUrl, enabled: source.enabled !== false, directory: 'FAIL', content: 'BLOCKED', loginAudit: USE_PHONE_SOURCE ? 'PHONE_CURRENT_PRESERVED' : 'E2', reason: String(error)});
    }
    const last = results[results.length - 1];
    process.stdout.write(`  directory=${last.directory} content=${last.content}${last.reason ? ` reason=${last.reason}` : ''}\n`);
  }
  const output = process.env.LEGADO_TEST_OUTPUT || `/tmp/translation-source-test-${Date.now()}.json`;
  fs.writeFileSync(output, JSON.stringify({phone: PHONE, count: results.length, results}, null, 2));
  const summary = results.reduce((acc, r) => {
    acc[`${r.directory}/${r.content}`] = (acc[`${r.directory}/${r.content}`] || 0) + 1;
    return acc;
  }, {});
  console.log(`RESULT_FILE ${output}`);
  console.log(`SUMMARY ${JSON.stringify(summary)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
