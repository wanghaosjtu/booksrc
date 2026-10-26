#!/usr/bin/env node
/* Sequential, non-mutating baseline/verification test for native RSS sources. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {request, sources, debug} = require('./rss_source_client');

const TIMEOUT = Number(process.env.LEGADO_RSS_TEST_TIMEOUT || 90000);
const only = new Set(String(process.env.LEGADO_RSS_ONLY || '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const range = String(process.env.LEGADO_RSS_RANGE || '').match(/^(\d+):(\d+)$/);

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourceClass(source) {
  if (source.singleUrl) return 'single-url';
  if (/^test$/i.test(String(source.sourceName || ''))) return 'test';
  if (!source.ruleArticles && !source.sortUrl) return 'default-rss';
  return 'content';
}

function ruleError(log) {
  const text = String(log || '');
  // The source-level WAF hand-off deliberately throws when the browser
  // challenge is still present. That is a manual/environmental result, not a
  // selector or JavaScript rule failure; let challenge() grade it as BLOCKED.
  if (/(?:Cloudflare验证未解除拦截|Cloudflare验证地址无效|Cloudflare人工验证)/i.test(text)) {
    return false;
  }
  // Directory/content logs include the fetched HTML.  A legitimate article
  // can contain words such as “exception”, “error”, or “reference”; only
  // treat explicit rule/runtime markers or stack-trace lines as failures.
  if (/(SelectorParseException|ReferenceError|TypeError|SyntaxError|脚本执行异常|规则解析失败|error_get_web_content)/i.test(text)) return true;
  return /(?:^|\n)\s*(?:Caused by:|(?:com|org|java|io\.legado)\.[^\n]*Exception\b|[A-Za-z_$][\w$]*Exception\s*:)/i.test(text);
}

function challenge(log) {
  return /(cloudflare|Cloudflare验证未解除拦截|Cloudflare验证地址无效|Cloudflare人工验证|just a moment|performing security verification|verify you are human|waf|access denied|forbidden|访问被拒|拒绝访问|禁止访问|errors\.edgesuite\.net|reference\s*#|挑战|验证)/i.test(log);
}

function nextUrl(log) {
  const lines = String(log).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('获取下一页链接')) continue;
    const value = compact(lines[index + 1]).replace(/^.*?└/, '').trim();
    if (value) return value;
  }
  return '';
}

function cleanNextUrl(value) {
  const raw = String(value || '').trim();
  const optionAt = raw.indexOf(',{');
  const url = optionAt >= 0 ? raw.slice(0, optionAt) : raw;
  return /^https?:\/\//i.test(url) ? url : '';
}

async function checkNext(source, url) {
  const target = cleanNextUrl(url);
  if (!target) return {status: 'UNRESOLVED'};

  // Fetch the next page through the phone, not the workstation.  The phone
  // may need its configured proxy, cookie jar, WebView, or Cloudflare check.
  const result = await debug(source.sourceUrl, TIMEOUT, `next::${target}`);
  const log = String(result.logs || '');
  const size = /列表大小:\s*(\d+)/.exec(log);
  const end = log.search(/列表页解析完成|列表页解析成功，为空|存在描述规则，不解析内容页/);
  const directoryLog = end >= 0 ? log.slice(0, end + 20) : log;
  const challengeSeen = challenge(directoryLog);
  const errorSeen = ruleError(directoryLog);
  const finished = /列表页解析完成|列表页解析成功，为空|存在描述规则，不解析内容页/.test(log);
  let status = 'FAIL';
  if (errorSeen) status = 'FAIL';
  else if (challengeSeen) status = 'BLOCKED';
  else if (size && Number(size[1]) > 0 && finished) status = 'PASS';
  else if (finished) status = 'EMPTY';
  return {
    status,
    transport: result.transport,
    elapsedMs: result.elapsedMs,
    itemCount: size ? Number(size[1]) : null,
    logTail: compact(log).slice(-1200),
  };
}

function translationMode(source) {
  const text = JSON.stringify(source);
  if (text.includes('legado-rss-translation-runtime')) return 'unified';
  if (/edge\.microsoft\.com|translatetext|Microsoft\.Translator/i.test(text)) {
    return source.injectJs ? 'legacy-webview' : 'legacy-api';
  }
  return 'none';
}

function loginAudit(source) {
  const loginUrl = String(source.loginUrl || '');
  const header = String(source.header || '');
  return {
    loginUrl: loginUrl ? (loginUrl.startsWith('@js:') || loginUrl.startsWith('<js>') || /function\s+login\s*\(/.test(loginUrl) ? 'script' : 'url') : 'missing',
    loginUi: source.loginUi ? 'present' : 'missing',
    loginCheckJs: source.loginCheckJs ? 'present' : 'missing',
    proxy: /proxy/i.test(header + loginUrl + String(source.loginUi || '')) ? 'present' : 'missing',
  };
}

function parseDebug(source, result) {
  const log = String(result.logs || '');
  const cls = sourceClass(source);
  const directoryEnd = log.search(/列表页解析完成|列表页解析成功，为空|存在描述规则，不解析内容页/);
  const contentStart = log.search(/开始解析内容页/);
  // A page body can legitimately contain words such as "Error".  Scope
  // rule-error detection to the phase that is being graded instead of
  // allowing a content-page log line to turn a valid directory into FAIL.
  const directoryLog = directoryEnd >= 0 ? log.slice(0, directoryEnd + 20) : log;
  const contentLog = contentStart >= 0 ? log.slice(contentStart) : log;
  const directoryError = ruleError(directoryLog);
  const contentError = ruleError(contentLog);
  const directoryChallenge = challenge(directoryLog);
  const contentChallenge = challenge(contentLog);
  const empty = /列表页解析成功，为空/.test(directoryLog);
  const directoryFinished = /列表页解析完成|列表页解析成功，为空|存在描述规则，不解析内容页/.test(log);
  const contentFinished = /内容页解析完成/.test(contentLog);
  const defaultContent = /内容规则为空，默认获取整个网页/.test(log);
  const feedDescription = /存在描述规则，不解析内容页/.test(log);
  const url = nextUrl(log);
  return {
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    enabled: source.enabled !== false,
    sourceClass: cls,
    directory: cls === 'single-url' ? 'N/A' :
      directoryError ? 'FAIL' : empty ? 'EMPTY' : directoryFinished ? 'PASS' : directoryChallenge ? 'BLOCKED' : 'FAIL',
    content: cls === 'single-url' ? 'N/A' :
      contentError ? 'FAIL' : contentFinished ? 'PASS' : defaultContent ? 'DEFAULT' :
        feedDescription ? 'FEED_DESCRIPTION' : contentChallenge ? 'BLOCKED' : 'FAIL',
    nextPageRule: source.ruleNextPage ? 'present' : 'absent',
    nextPageUrl: url || null,
    nextPage: source.ruleNextPage ? (url ? 'RESOLVED' : 'FAIL') : 'N/A',
    login: loginAudit(source),
    translation: translationMode(source),
    transport: result.transport,
    elapsedMs: result.elapsedMs,
    logTail: compact(log).slice(-1200),
  };
}

async function testOne(source) {
  const result = await debug(source.sourceUrl, TIMEOUT);
  const audit = parseDebug(source, result);
  if (audit.nextPage === 'RESOLVED') {
    const reachable = await checkNext(source, audit.nextPageUrl);
    audit.nextPageFetch = reachable;
    audit.nextPage = reachable.status;
  }
  return audit;
}

function selected(all) {
  let result = all.filter((source) => !only.size || only.has(source.sourceName) || only.has(source.sourceUrl));
  if (range) result = result.slice(Number(range[1]), Number(range[2]));
  return result;
}

function summarize(results) {
  const summary = {};
  for (const result of results) {
    for (const [key, value] of Object.entries({directory: result.directory, content: result.content, nextPage: result.nextPage, translation: result.translation})) {
      const summaryKey = `${key}:${value}`;
      summary[summaryKey] = (summary[summaryKey] || 0) + 1;
    }
  }
  return summary;
}

async function main() {
  const all = await sources();
  const selectedSources = selected(all);
  const results = [];
  const directory = path.resolve('rsssource/reports');
  fs.mkdirSync(directory, {recursive: true});
  const output = process.env.LEGADO_RSS_TEST_OUTPUT || path.join(directory, `rss-source-test-${Date.now()}.json`);
  const writeReport = () => fs.writeFileSync(output, JSON.stringify({
    generatedAt: new Date().toISOString(),
    phone: process.env.LEGADO_PHONE || '127.0.0.1',
    count: results.length,
    expectedCount: selectedSources.length,
    summary: summarize(results),
    results,
  }, null, 2) + '\n');
  writeReport();
  for (let index = 0; index < selectedSources.length; index += 1) {
    const source = selectedSources[index];
    process.stdout.write(`[${index + 1}/${selectedSources.length}] ${source.sourceName}\n`);
    try {
      const audit = await testOne(source);
      results.push(audit);
      writeReport();
      process.stdout.write(`  directory=${audit.directory} content=${audit.content} next=${audit.nextPage} translation=${audit.translation}\n`);
    } catch (error) {
      const failed = {
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        enabled: source.enabled !== false,
        sourceClass: sourceClass(source),
        directory: 'FAIL', content: 'FAIL', nextPage: source.ruleNextPage ? 'FAIL' : 'N/A',
        login: loginAudit(source), translation: translationMode(source),
        transport: 'runner-error', elapsedMs: 0, logTail: compact(error).slice(0, 1200),
      };
      results.push(failed);
      writeReport();
      process.stdout.write(`  directory=FAIL content=FAIL reason=${failed.logTail}\n`);
    }
  }
  writeReport();
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  console.log(`RESULT_FILE ${output}`);
  console.log(`SUMMARY ${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
