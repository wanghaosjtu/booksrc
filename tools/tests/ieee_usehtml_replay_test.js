'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const replay=require('../build_ieee_usehtml_replay');
const {SOURCE_ID}=require('../build_ieee_usehtml_validation');
const runtime=fs.readFileSync(path.join(__dirname,'../../booksource/runtime/legado-translation-runtime.js'),'utf8');
const original={bookSourceUrl:SOURCE_ID,bookSourceName:'IEEE',jsLib:runtime,header:'{"User-Agent":"synthetic-public-UA"}',
  ruleContent:{content:'<js>function ieeeSignedMedia(resource) {return java.ajax(resource);}\njava.ajax("full");java.ajax("meta");result;</js>'},
  ruleToc:{chapterList:'original'},loginUi:'[]'};
const body={status:200,host:'ieeexplore.ieee.org',body:'<div class="document-text"><tex-math>{{d\\mathrm{snr}}}</tex-math><h2>Section</h2></div>'};
const lead={host:body.host,title:'Article title',abstractText:'Article abstract',html:'<h1 class="document-title">Article title</h1>'};

test('replay snapshots restore exact article bytes, retain source input, and expose no general IEEE proxy',()=>{
  const saved=structuredClone(original);
  for(const mode of ['legacy','guard']) {
    const {candidate}=replay.build(original,body,lead,mode,'test-token');
    const c=vm.createContext({java:{ajax:()=>{throw Error('unlisted request must not reach Java');}}});
    vm.runInContext(candidate.jsLib,c);
    assert.equal(c._uhvIeeeFixtureAjax(replay.REST+'?logAccess=true,{}'),body.body);
    assert.equal(JSON.parse(c._uhvIeeeFixtureAjax(replay.REST+'abstract,{}')).displayDocTitle,lead.title);
    assert(c._uhvIeeeFixturePage().includes(lead.html));
    assert.throws(()=>c._uhvIeeeFixtureAjax('https://ieeexplore.ieee.org/rest/document/9999/'),e=>String(e).includes('unlisted IEEE'));
    assert.equal(c._uhvIeeeFixtureAjax('https://ieeexplore.ieee.org/rest/auth/signed-url?resource-url=synthetic'),'');
    const json=c._ltOptions(['{{d\\mathrm{snr}}}']);
    assert.equal(json.includes('{{'),mode==='legacy');
    assert.deepEqual(JSON.parse(JSON.parse(json).body),['{{d\\mathrm{snr}}}']);
    assert.equal(JSON.parse(candidate.header)['User-Agent'],'synthetic-public-UA');
    assert.equal(candidate.loginUi,original.loginUi);
  }
  assert.deepEqual(original,saved);
});

test('replay refuses non-IEEE sources, blocked inputs and credential-shaped captured URLs',()=>{
  assert.throws(()=>replay.build({...original,bookSourceUrl:'other'},body,lead,'guard','t'),/expected original/);
  assert.throws(()=>replay.build(original,{...body,status:403},lead,'guard','t'),/actual successful/);
  assert.throws(()=>replay.build(original,{...body,body:body.body+'?token=synthetic'},lead,'guard','t'),/credential/);
});
