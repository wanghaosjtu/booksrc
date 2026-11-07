'use strict';
// Runtime ownership/loader helpers; the v3 migrator delegates to simplification.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const {ROOT} = require('./shared_common_phone');
const LEGACY_MARKER = '/* legado-translation-runtime v1';
const LOADER_MARKER = '/* legado-common-loader v';
const RUNTIME = fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-shared-runtime.js'),'utf8');
const LEGACY = fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-translation-runtime.js'),'utf8');
const TEMPLATE = fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-common-loader.js'),'utf8');
const parse = text => acorn.parse(text,{ecmaVersion:'latest'});
function names(node) {
  if(node.type==='FunctionDeclaration')return [node.id.name];
  if(node.type==='VariableDeclaration') {
    assert(node.declarations.every(d=>d.id.type==='Identifier'),'destructuring cannot own common declarations');
    return node.declarations.map(d=>d.id.name);
  }
  return [];
}
const COMMON_NAMES = new Set([...parse(RUNTIME).body.flatMap(names),...parse(LEGACY).body.flatMap(names)]);
const LOADER_NAMES = new Set(parse(TEMPLATE).body.flatMap(names));
const V2_LOADER_NAMES = new Set(['LEGADO_COMMON_URL','LEGADO_COMMON_VERSION','__ltCommonApi',
  '__ltBuildCommon','__ltLoadCommon','TT','TJ','TC','TH','ltUseHtmlBlocks','ltPrepareImages','ltExtract']);
function stripCommon(text) {
  assert(typeof text==='string','jsLib must be a string');
  const network=text.includes(LOADER_MARKER);
  assert(!(network&&text.includes(LEGACY_MARKER)),'mixed inline/network runtimes');
  const marker=network?LOADER_MARKER:LEGACY_MARKER,start=text.indexOf(marker);
  const ownedNames=network?(/legado-common-loader v[12]/.test(text)?V2_LOADER_NAMES:LOADER_NAMES):COMMON_NAMES;
  if(start<0) {
    assert(!parse(text).body.flatMap(names).some(n=>COMMON_NAMES.has(n)||LOADER_NAMES.has(n)),
      'unmarked common/API declaration requires an explicit migration');
    return text.trimEnd();
  }
  assert(start===text.lastIndexOf(marker),'one marked runtime required');
  const removals=[],comments=[];
  const tree=acorn.parse(text,{ecmaVersion:'latest',onComment:comments});
  for(const node of tree.body) {
    if(node.start<start)continue;
    const declared=names(node),owned=declared.filter(name=>ownedNames.has(name));
    if(owned.length) {
      assert.equal(owned.length,declared.length,'mixed common/site declaration: refusing to truncate site code');
      removals.push([node.start,node.end]);
    } else if(node.type==='ExpressionStatement'&&node.expression.type==='AssignmentExpression'
      &&node.expression.left.type==='Identifier'&&ownedNames.has(node.expression.left.name)) {
      throw new Error('unsupported common monkey patch; merge it explicitly before migration');
    }
  }
  for(const comment of comments)if(comment.start===start)removals.push([comment.start,comment.end]);
  for(const[a,b]of removals.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a)+text.slice(b);
  const site=text.trimEnd();parse(site);
  assert(!site.includes(marker),'runtime marker survived');
  assert(!parse(site).body.flatMap(names).some(n=>COMMON_NAMES.has(n)||LOADER_NAMES.has(n)),
    'common declaration survived outside the marker');
  return site;
}
function loader(commit) {
  assert(/^[0-9a-f]{40}$/.test(commit),'full immutable Git commit SHA required');
  assert.equal(TEMPLATE.split('__COMMON_COMMIT__').length,2,'one commit placeholder required');
  return TEMPLATE.replace('__COMMON_COMMIT__',commit);
}
function configuredLib(text,metadata,commit) {
  const site=stripCommon(text);
  return (site?site+'\n\n':'')+loader(commit);
}
function build(local,phone,commit) {return require('./simplify_source_js').build(local,phone,commit);}
module.exports={stripCommon,configuredLib,loader,build,LOADER_MARKER,COMMON_NAMES};
if(require.main===module)require('./simplify_source_js').main();
