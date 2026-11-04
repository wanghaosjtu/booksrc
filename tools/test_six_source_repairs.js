#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {IDS, repaired, COMMON, directVerification} = require('./repair_six_sources');
const sources = JSON.parse(fs.readFileSync('booksource/legado-book-sources-current.json','utf8'));

test('repairs are idempotent and leave every unrelated source unchanged', () => {
  const after = repaired(sources);
  assert.deepEqual(repaired(after), after);
  sources.forEach((s,i) => {
    if (!Object.values(IDS).includes(s.bookSourceUrl)) assert.deepEqual(after[i],s);
    for (const k of ['bookSourceUrl','bookSourceName','enabled','customOrder','header','loginUi','loginUrl','enabledCookieJar','jsLib']) {
      assert.deepEqual(after[i][k],s[k],s.bookSourceName + ': protected ' + k);
    }
  });
});
test('every emitted JavaScript fragment parses, including the phone expressions', () => {
  for (const s of repaired(sources).filter(s=>Object.values(IDS).includes(s.bookSourceUrl))) {
    const strings = [s.loginCheckJs];
    for (const branch of ['ruleExplore','ruleBookInfo','ruleToc','ruleContent']) {
      strings.push(...Object.values(s[branch]||{}).filter(x=>typeof x==='string'));
    }
    for (const str of strings.filter(Boolean)) {
      for (const m of str.matchAll(/<js>([\s\S]*?)<\/js>/g)) new vm.Script(m[1]);
      if (str.startsWith('@js:')) new vm.Script(str.slice(4));
    }
  }
});
test('URL resolution handles blank links, query pages and relative ancestors', () => {
  class URI {
    constructor(base) { this.base=base; }
    resolve(u) { return {toString:()=>new URL(u,this.base).href}; }
  }
  const context=vm.createContext({Packages:{java:{net:{URI}}}});
  vm.runInContext(COMMON,context);
  assert.equal(context.sixAbsolute('', 'https://example.org/list/'),'');
  assert.equal(context.sixAbsolute('?8e6ad2f9_page=2','https://www.productplan.com/blog'),'https://www.productplan.com/blog?8e6ad2f9_page=2');
  assert.equal(context.sixAbsolute('../images/a.png','https://example.org/issue/current/'),'https://example.org/issue/images/a.png');
  assert.equal(context.sixAbsolute('javascript:void(0)','https://example.org/'),'');
  assert.equal(context.sixAbsolute('https://example.org/a,{"webView":true}','https://example.org/'),'https://example.org/a');
});

function contextFor(response, after) {
  const calls=[];
  class URI { constructor(base){this.base=base;} resolve(u){return {toString:()=>new URL(u,this.base).href};} }
  const parse=html=>({
    title:()=>((String(html).match(/<title>(.*?)<\/title>/i)||[])[1]||''),
    body:()=>({text:()=>String(html).replace(/<[^>]*>/g,'')}),
    select:()=>({size:()=>0})
  });
  const context=vm.createContext({result:response,baseUrl:'https://www.annualreviews.org/article',
    org:{jsoup:{Jsoup:{parse}}},Packages:{java:{net:{URI}}},
    java:{url:'https://www.annualreviews.org/article',
      startBrowserAwait:(...args)=>{calls.push(['browser',...args]);return {body:'BROWSER DOM MUST NOT BE CONTENT'};},
      connect:(...args)=>{calls.push(['http',...args]);return after;}
    }});
  return {context,calls};
}
test('normal Cloudflare mentions are not challenges', () => {
  const {context,calls}=contextFor({body:'<title>Article</title><p>Protected by Cloudflare</p>'});
  const result=vm.runInContext(directVerification('test'),context);
  assert.equal(result.body,'<title>Article</title><p>Protected by Cloudflare</p>');
  assert.deepEqual(calls,[]);
});
test('verification discards browser DOM and explicitly refetches once over HTTP', () => {
  const challenge={body:'<title>Just a moment...</title>Enable JavaScript and cookies to continue'};
  const good={body:'<title>Article</title><p>Real HTTP full text</p>'};
  const {context,calls}=contextFor(challenge,good);
  assert.equal(vm.runInContext(directVerification('test'),context),good);
  assert.deepEqual(calls.map(c=>c[0]),['browser','http']);
  const blocked=contextFor(challenge,challenge);
  assert.throws(()=>vm.runInContext(directVerification('test'),blocked.context),/BLOCKED/);
  assert.deepEqual(blocked.calls.map(c=>c[0]),['browser','http']);
});
test('direct sources cannot render chapters/images through WebView or silently serve abstracts', () => {
  const byId=new Map(repaired(sources).map(s=>[s.bookSourceUrl,s]));
  for(const id of [IDS.cas,IDS.annual]) {
    const s=byId.get(id);
    assert(!/webView|java\.webView/.test(s.ruleToc.chapterUrl+s.ruleContent.content));
    assert.equal(s.ruleContent.webJs,'');
    assert.match(s.ruleContent.content,/不以摘要代替/);
  }
  assert.match(byId.get(IDS.cas).ruleContent.content,/\/doi\/getFulltext/);
  assert.match(byId.get(IDS.cas).ruleContent.content,/article\.baseId/);
  assert(!/sk_logo_sscp/.test(byId.get(IDS.journal).ruleBookInfo.coverUrl));
  assert.match(byId.get(IDS.journal).ruleBookInfo.coverUrl,/sk02-zgxp-book0\.png/);
  assert.equal(byId.get(IDS.mid).exploreUrl.split('\n').length,1);
  assert.match(byId.get(IDS.productplan).ruleToc.nextTocUrl,/w-pagination-next/);
  assert(!/#pp-/.test(JSON.stringify(byId.get(IDS.productplan).ruleToc)));
});

test('revision deployment preserves protected snapshot fields and rejects concurrent rule edits', () => {
  const r=require('./repair_six_sources'),client=require('./phone_source_client');
  const original={bookSourceUrl:IDS.cas,header:'original',enabled:false,ruleContent:{content:'old'}};
  const snapshot={...structuredClone(original),header:'user-changed',ruleContent:{content:'prior-deployed'}};
  const revision={...structuredClone(original),ruleContent:{content:'new'}},planned=structuredClone(snapshot);
  for(const path of client.changedPaths(original,revision))r.applyLeaf(planned,revision,path);
  const merged=client.merge(snapshot,planned,snapshot);
  assert.equal(merged.header,'user-changed');
  assert.equal(merged.enabled,false);
  assert.equal(merged.ruleContent.content,'new');
  const concurrent={...structuredClone(snapshot),ruleContent:{content:'user-rule-edit'}};
  assert.throws(()=>client.merge(snapshot,planned,concurrent),/Concurrent edit/);
});
