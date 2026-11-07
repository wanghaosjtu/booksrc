'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('saved chapter evidence accepts owned JSON labels and rejects traversal',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../usehtml_phone_validation.js'),'utf8');
  const guard=source.split('\n').find(line=>line.includes('invalid owned chapter evidence path'));
  assert(guard,'expected evidence filename guard');
  for(const chapterFile of ['local-chapters-v2.json','ieee-chapters.json']) {
    vm.runInNewContext(guard,{assert,chapterFile});
  }
  for(const chapterFile of ['../state.json','/tmp/state.json','name.txt','name\\json','name.json/extra']) {
    assert.throws(()=>vm.runInNewContext(guard,{assert,chapterFile}),/invalid owned chapter evidence path/);
  }
});
