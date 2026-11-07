#!/usr/bin/env node
/* Read-only Android HTML/paint checks using the owned local book and HTTP/WS. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const client=require('./usehtml_http_ws_client');
const {ROOT}=require('./build_usehtml_validation');
const DIR=path.join(ROOT,'booksource/.usehtml-validation-phone');
const state=JSON.parse(fs.readFileSync(path.join(DIR,'state.json'),'utf8'));
assert(process.env.LEGADO_PHONE&&state.host===process.env.LEGADO_PHONE,'matching explicit phone required');
const kind=process.argv[3]||'local';
assert(['local','parser'].includes(kind),'probe must use an owned text fixture');
const record=state.books.find(b=>b.kind===kind&&b.status==='created');
assert(record,'owned local book required');
const label=process.argv[2]||'android-html-probe';
const heading=kind==='parser'?'UHV-FORMULA-HEADING':'HTML 验证：一级标题';
assert(/^[a-zA-Z0-9_-]+$/.test(label),'invalid evidence label');
const file=path.join(DIR,label+'.json');
assert(!fs.existsSync(file),'evidence already exists');
const api='http://127.0.0.1:1122/getBookContent?url='+encodeURIComponent(record.bookUrl)+'&index=0';
const code=`(function(){
  var response=JSON.parse(String(java.ajax(${JSON.stringify(api)})));
  if(response.isSuccess===false||typeof response.data!=='string')throw Error('owned cache unavailable');
  var html=String(response.data).replace(/<\\/?usehtml>/g,'');
  var spanned=Packages.android.text.Html.fromHtml(html,63);
  var text=String(spanned.toString());
  var heading=${JSON.stringify(heading)},start=text.indexOf(heading);
  var paint=new Packages.android.text.TextPaint();paint.setTextSize(48);
  var layout=Packages.android.text.StaticLayout.Builder.obtain(spanned,0,spanned.length(),paint,1800).setIncludePad(true).build();
  var normal=Packages.android.text.StaticLayout.Builder.obtain(heading,0,heading.length,paint,1800).setIncludePad(true).build();
  var line=start<0?-1:layout.getLineForOffset(start);
  var styledHeight=line<0?0:layout.getLineBottom(line)-layout.getLineTop(line);
  var plainHeight=normal.getLineBottom(0)-normal.getLineTop(0);
  var boldText='粗体标记 BOLD',boldStart=text.indexOf(boldText);
  var boldWidth=boldStart<0?0:Packages.android.text.Layout.getDesiredWidth(spanned.subSequence(boldStart,boldStart+boldText.length),paint);
  var plainBoldWidth=Packages.android.text.Layout.getDesiredWidth(boldText,paint);
  var metrics={kind:'Android-StaticLayout-from-cached-owned-book',cacheCountOne:html.indexOf('UHV-FETCH-1')>=0,
    h1Found:start>=0,h1LineHeight:Number(styledHeight),plainHeadingLineHeight:Number(plainHeight),
    h1Larger:styledHeight>plainHeight,baselinePaintSize:48,lineCount:Number(layout.getLineCount()),
    boldWidth:Number(boldWidth),plainBoldWidth:Number(plainBoldWidth),
    wrapperVisible:text.indexOf('<usehtml>')>=0,entityLiteralPreserved:text.indexOf('<h1> 是文字')>=0};
  java.log('UHV-ANDROID-METRICS '+JSON.stringify(metrics));
  // Metrics use the unmodified cached HTML above; avoid retranslating it afterward.
  var noTranslation=html.replace(/<([a-z][\\w-]*)(?=[\\s>])/gi,'<$1 class="notranslate"');
  return '<html><body class="notranslate">'+noTranslation+'</body></html>';
})()`;
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT,'booksource/runtime/legado-usehtml-rule-json.js'),'utf8'),context);
const url='http://127.0.0.1:1122/getJsSourceApiTokenRequired,'+context.useHtmlRuleJson({bodyJs:code,timeout:10000});
(async()=>{
  const result=await client.debug(record.book.origin,'--'+url,45000);
  const summary=client.summarizeDebug(result,'--'+url);
  fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  const line=result.messages.join('\n').match(/UHV-ANDROID-METRICS (\{[^\n]+\})/);
  const metrics=line?JSON.parse(line[1]):null;
  console.log(JSON.stringify({label,...summary,metrics},null,2));
  if(summary.isError||!metrics)process.exitCode=1;
})().catch(error=>{console.error(String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,500));process.exitCode=1;});
