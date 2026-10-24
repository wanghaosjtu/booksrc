/* legado-translation-runtime v1 */
var LEGADO_TRANSLATION_RUNTIME="2";
function _ltString(v){return v==null?"":String(v);}
function _ltCacheGet(c,k){try{return c&&c.get(k);}catch(e){return null;}}
function _ltCachePut(c,k,v,s){try{if(c)c.put(k,v,s);}catch(e){}}
function _ltLang(j){var v="";try{v=j.get("TARGET_LANG");}catch(e){}return v&&String(v).trim()?String(v):"zh-Hans";}
function _ltJavaString(v){try{return v!=null&&v.getClass&&String(v.getClass().getName()).indexOf("String")>=0;}catch(e){return false;}}
function _ltText(v){return typeof v==="string"||v instanceof String||_ltJavaString(v);}
function _ltArray(v){return Object.prototype.toString.call(v)==="[object Array]";}
function _ltBody(r){try{if(!r)return"";var b=r.body;if(b!=null&&typeof b!=="function")return _ltString(b);if(typeof b==="function")return _ltString(b.call(r));}catch(e){}return _ltString(r);}
function _ltMarker(i){return"<|L"+i+"|>";}
function _ltNormalize(v){return _ltString(v).replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/<\s*\|\s*L\s*(\d+)\s*\|\s*>/gi,function(_,i){return _ltMarker(i);});}
function _ltSplitLabeled(v,originals){
    var s=_ltNormalize(v),m=[],re=/<\|L(\d+)\|>/g,x;
    while((x=re.exec(s))!==null)m.push({id:parseInt(x[1],10),start:x.index,end:re.lastIndex});
    if(!m.length)return null;
    var pieces={},reliable={},i,cur,next;
    for(i=0;i<m.length;i++){
        cur=m[i];next=m[i+1];
        if(cur.id<1||cur.id>originals.length||pieces[cur.id]!==undefined)continue;
        reliable[cur.id]=!!(next?next.id===cur.id+1:cur.id===originals.length);
        pieces[cur.id]=s.substring(cur.end,next?next.start:s.length).replace(/^\s+|\s+$/g,"");
    }
    return{pieces:pieces,reliable:reliable};
}
function _ltOptions(body){return JSON.stringify({headers:{Authorization:"Bearer ","Content-Type":"application/json"},method:"post",body:JSON.stringify(body)});}
function _ltUrl(lang,body){return"https://edge.microsoft.com/translate/translatetext?to="+encodeURIComponent(lang)+","+_ltOptions(body);}
function _ltRequest(j,lang,values){try{return j.ajax(_ltUrl(lang,values));}catch(e){return"";}}
function _ltTexts(response){var data=null;try{data=JSON.parse(_ltBody(response));}catch(e){}if(!_ltArray(data))return null;var out=[],i;for(i=0;i<data.length;i++){try{out[i]=_ltString(data[i].translations[0].text);}catch(e){return null;}}return out;}
function _ltJoin(values){var out=[],i;for(i=0;i<values.length;i++)out.push(_ltMarker(i+1)+"\n"+values[i]);return out.join("\n");}
function _ltFallbackValues(j,lang,values){
    var out=values.slice(0),urls=[],i,start,end,res,texts;
    for(i=0;i<values.length;i++)urls.push(_ltUrl(lang,[values[i]]));
    for(start=0;start<urls.length;start+=4){
        end=Math.min(start+4,urls.length);res=[];
        try{res=j.ajaxAll(urls.slice(start,end),false)||[];}catch(e){for(i=start;i<end;i++)res.push(_ltRequest(j,lang,[values[i]]));}
        for(i=0;i<res.length;i++){texts=_ltTexts(res[i]);if(texts&&texts.length===1)out[start+i]=texts[0];}
    }
    return out;
}
function TT(value,j,cache){
    var scalar=!_ltArray(value),input=scalar?[_ltString(value)]:value||[],out=[],chunks=[],chunkIndexes=[],pending=[],indexes=[],chars=0,lang=_ltLang(j),i,text,key,cached;
    for(i=0;i<input.length;i++){
        text=_ltString(input[i]);out[i]=text;if(!text.trim())continue;
        key="legado_ms:"+lang+":"+text;cached=_ltCacheGet(cache,key);
        if(cached!=null){out[i]=_ltString(cached);continue;}
        if(pending.length&&(chars+text.length+16>3600||pending.length>=200)){chunks.push(pending);chunkIndexes.push(indexes);pending=[];indexes=[];chars=0;}
        pending.push(text);indexes.push(i);chars+=text.length+16;
    }
    if(pending.length){chunks.push(pending);chunkIndexes.push(indexes);}
    if(!chunks.length)return scalar?out[0]:out;
    var urls=[],wave,end,responses,handled,r,ci,translated,split,unresolved,resolved,n,oi,fallback,fi,missing;
    for(i=0;i<chunks.length;i++)urls.push(_ltUrl(lang,[_ltJoin(chunks[i])]));
    for(wave=0;wave<urls.length;wave+=4){
        end=Math.min(wave+4,urls.length);responses=[];handled={};
        try{responses=j.ajaxAll(urls.slice(wave,end),false)||[];}catch(e){for(i=wave;i<end;i++)responses.push(_ltRequest(j,lang,[_ltJoin(chunks[i])]));}
        for(r=0;r<responses.length&&wave+r<end;r++){
            ci=wave+r;handled[ci]=true;translated=_ltTexts(responses[r]);unresolved=[];resolved={};
            if(translated&&translated.length===1){
                split=_ltSplitLabeled(translated[0],chunks[ci]);
                if(split)for(n=0;n<chunks[ci].length;n++)if(split.reliable[n+1]&&split.pieces[n+1]!==undefined){
                    oi=chunkIndexes[ci][n];out[oi]=split.pieces[n+1];resolved[n]=true;_ltCachePut(cache,"legado_ms:"+lang+":"+chunks[ci][n],out[oi],2592000);
                }
            }
            for(n=0;n<chunks[ci].length;n++)if(!resolved[n])unresolved.push(chunks[ci][n]);
            if(unresolved.length){fallback=_ltFallbackValues(j,lang,unresolved);fi=0;for(n=0;n<chunks[ci].length;n++)if(!resolved[n]){out[chunkIndexes[ci][n]]=fallback[fi];if(fallback[fi]!==chunks[ci][n])_ltCachePut(cache,"legado_ms:"+lang+":"+chunks[ci][n],fallback[fi],2592000);fi++;}}
        }
        for(ci=wave;ci<end;ci++)if(!handled[ci]){missing=_ltFallbackValues(j,lang,chunks[ci]);for(n=0;n<chunks[ci].length;n++){out[chunkIndexes[ci][n]]=missing[n];if(missing[n]!==chunks[ci][n])_ltCachePut(cache,"legado_ms:"+lang+":"+chunks[ci][n],missing[n],2592000);}}
    }
    return scalar?out[0]:out;
}
var _LT_SKIP_KEYS={href:1,src:1,url:1,path:1,id:1,uuid:1,isbn:1,doi:1,cover:1,coverUrl:1,bookUrl:1,chapterUrl:1,htmlLink:1,link:1};
function _ltSkipKey(key){var name=_ltString(key).toLowerCase();return name==="type"||name==="status"||!!_LT_SKIP_KEYS[key]||/(?:url|href|path|link|id|uuid|isbn|doi)$/.test(name);}
function TJ(json,j,cache,keys){
    var stringInput=_ltText(json),data=json,allow=null,refs=[],values=[];
    if(stringInput)try{data=JSON.parse(_ltString(json));}catch(e){return json;}
    if(keys!=null){if(!_ltArray(keys))return json;allow={};for(var a=0;a<keys.length;a++)allow["$"+_ltString(keys[a])]=true;if(!keys.length)return json;}
    function walk(v,parent,key){
        if(_ltText(v)){if(!_ltSkipKey(key)&&(allow==null||allow["$"+key])){refs.push({parent:parent,key:key});values.push(_ltString(v));}return;}
        if(_ltArray(v)){for(var i=0;i<v.length;i++)walk(v[i],v,i);return;}
        if(v&&typeof v==="object")for(var name in v)if(Object.prototype.hasOwnProperty.call(v,name))walk(v[name],v,name);
    }
    walk(data,null,"");
    if(values.length){var translated=TT(values,j,cache);for(var i=0;i<refs.length;i++)if(refs[i].parent==null)data=translated[i];else refs[i].parent[refs[i].key]=translated[i];}
    return stringInput?JSON.stringify(data):data;
}
function _ltExcluded(node,selectors){var p=node&&node.parent?node.parent():null,i;while(p){try{if(p.hasClass("notranslate"))return true;}catch(e){}for(i=0;selectors&&i<selectors.length;i++)try{if(p.is(String(selectors[i])))return true;}catch(e){}p=p.parent?p.parent():null;}return false;}
function TC(html,j,cache,options){
    options=options||{};if(html==null||!_ltString(html).trim())return html;
    var doc=org.jsoup.Jsoup.parseBodyFragment(_ltString(html)),els=doc.select("*"),nodes=[],values=[],i,k,tn,v;
    for(i=0;i<els.size();i++){tn=els.get(i).textNodes();for(k=0;k<tn.size();k++){v=_ltString(tn.get(k).getWholeText());if(v.trim()&&!_ltExcluded(tn.get(k),options.notranslate_selector||[])){nodes.push(tn.get(k));values.push(v);}}}
    var translated=TT(values,j,cache);for(i=0;i<nodes.length;i++)nodes[i].text(_ltString(translated[i]));return _ltString(doc.body().html());
}
function _ltRemove(doc,selectors){for(var i=0;selectors&&i<selectors.length;i++)try{doc.select(String(selectors[i])).remove();}catch(e){}}
function _ltExtract(doc,selectors){var i,j,selected,el;for(i=0;selectors&&i<selectors.length;i++){try{selected=doc.select(String(selectors[i]));}catch(e){continue;}for(j=0;j<selected.size();j++){el=selected.get(j);el.replaceWith(new org.jsoup.nodes.TextNode(_ltString(el.text())));}}}
function _ltSrcset(v){var parts=_ltString(v).split(","),i,c;for(i=parts.length-1;i>=0;i--){c=parts[i].trim().split(/\s+/)[0];if(c)return c;}return"";}
function _ltUsable(v){v=_ltString(v).trim().toLowerCase();return!!v&&v!=="#"&&v.indexOf("javascript:")!==0&&v.indexOf("about:")!==0&&v.indexOf("transparent")<0&&v.indexOf("placeholder")<0&&v.indexOf("spacer")<0;}
function _ltAttr(el,key){var v=_ltString(el.attr(key)).trim();return key.indexOf("srcset")>=0?_ltSrcset(v):v;}
function _ltReplaceAltImages(doc,selectors){var i,j,els,el,src,img;for(i=0;selectors&&i<selectors.length;i++){try{els=doc.select(String(selectors[i]));}catch(e){continue;}for(j=0;j<els.size();j++){el=els.get(j);src=_ltString(el.attr("data-altimg")).trim();if(!src)continue;try{img=doc.createElement("img");img.attr("src",src);el.replaceWith(img);}catch(e){}}}}
function _ltAnchor(href,options){if(options.image_anchor_suffix)return href+_ltString(options.image_anchor_suffix);if(options.image_anchor_options)try{return href+","+JSON.stringify(options.image_anchor_options);}catch(e){}return href;}
var _LT_LAZY=["data-src","data-original","data-original-src","data-lazy-src","data-lazy","data-echo","data-img-src","data-image-url","data-image","data-url","data-fallback-src","data-full-src","data-hi-res-src","data-large-file","data-srcset"];
function _ltPrepareImages(doc,base,options){
    options=options||{};var imgs=doc.select("img"),i,k,pk,img,src,loading,parent,href,anchor,picture,source,sourceKeys=["data-srcset","srcset","data-src","src"],lazy,candidate,attrs,attr;
    for(i=0;i<imgs.size();i++){
        img=imgs.get(i);src=_ltString(img.attr("src")).trim();loading=_ltString(img.attr("loading")).toLowerCase();parent=img.parent();href=parent&&String(parent.tagName()).toLowerCase()==="a"?_ltString(parent.attr("href")).trim():"";anchor=false;picture="";
        if(parent&&String(parent.tagName()).toLowerCase()==="picture"){var sources=parent.select("source");for(pk=0;pk<sources.size()&&!_ltUsable(picture);pk++){source=sources.get(pk);for(k=0;k<sourceKeys.length;k++){picture=_ltAttr(source,sourceKeys[k]);if(_ltUsable(picture))break;}}}
        if(options.image_anchor_mode==="href"&&loading==="lazy"&&href){src=_ltAnchor(href,options);anchor=true;}
        if(!anchor&&_ltUsable(picture))src=picture;
        if(loading==="lazy"&&!anchor){lazy="";for(k=0;k<_LT_LAZY.length;k++){candidate=_ltAttr(img,_LT_LAZY[k]);if(_ltUsable(candidate)){lazy=candidate;break;}}if(lazy)src=lazy;}
        if(!_ltUsable(src)){for(k=0;k<_LT_LAZY.length&&!_ltUsable(src);k++)src=_ltAttr(img,_LT_LAZY[k]);if(!_ltUsable(src))src=_ltAttr(img,"srcset");}
        if(!_ltUsable(src)&&href)src=options.image_anchor_mode==="href"?_ltAnchor(href,options):href;
        if(src&&/^\/\//.test(src))src="https:"+src;if(src&&base&&/^\//.test(src))src=_ltString(base).replace(/\/$/,"")+src;if(src)img.attr("src",src);
        if(!src){img.remove();continue;}
        attrs=img.attributes().iterator();while(attrs.hasNext()){attr=attrs.next();if(String(attr.getKey()) !== "src"&&String(attr.getKey()) !== "alt")attrs.remove();}
    }
}
function _ltCodecogs(doc,selector){var formulas,el,tex,tm,img,i;try{formulas=doc.select(selector); }catch(e){return;}for(i=0;i<formulas.size();i++){el=formulas.get(i);tex=_ltString(el.attr("data-tex")||el.attr("data-original-tex")||el.attr("alttext"));if(!tex){tm=el.select("tex-math").first();tex=tm?_ltString(tm.text()):"";}if(!tex)continue;try{img=doc.createElement("img");img.attr("src","https://latex.codecogs.com/svg.latex?"+encodeURIComponent(tex));img.attr("alt",tex);el.replaceWith(img);}catch(e){}}}
function _ltWiris(doc,selector,j){var formulas,el,mathml,body,opt,response,svg,imageSrc,speech,img,label,i;try{formulas=doc.select(selector||"math");}catch(e){return;}for(i=0;i<formulas.size();i++){el=formulas.get(i);mathml=_ltString(el.outerHtml());if(!mathml)continue;imageSrc="";try{body="mml="+encodeURIComponent(mathml);opt=JSON.stringify({method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body});response=j.ajax("https://www.wiris.net/demo/editor/render?format=svg,"+opt);svg=_ltString(response).trim();if(svg.indexOf("<svg")>=0&&j.base64Encode)imageSrc="data:image/svg+xml;base64,"+j.base64Encode(svg);}catch(e){try{j.log("WIRIS POST failed: "+e);}catch(ignore){}}if(!imageSrc)continue;try{speech=_ltString(el.attr("data-semantic-speech")||el.text()).replace(/\s+/g," ").trim();img=doc.createElement("img");img.attr("src",imageSrc);img.attr("alt",speech);el.replaceWith(img);if(speech){label=doc.createElement("span");label.addClass("formula-speech");label.addClass("notranslate");label.text(" "+speech+" ");img.after(label);}}catch(e){}}}
function TH(html,j,cache,options){
    options=options||{};if(html==null||!_ltString(html).trim())return html;var doc=org.jsoup.Jsoup.parse(_ltString(html)),mode=options.formula_mode,selector=options.formula_selector;
    _ltRemove(doc,options.remove_selector||[]);if(!mode&&typeof formula_mode!=="undefined")mode=formula_mode;if(!selector&&typeof formula_selector!=="undefined")selector=formula_selector;
    if(mode==="codecogs")_ltCodecogs(doc,selector||"math");else if(mode==="wiris")_ltWiris(doc,selector||"math",j);
    _ltExtract(doc,options.extract_selector||(typeof extract_selector!=="undefined"?extract_selector:[]));_ltReplaceAltImages(doc,options.image_alt_selector||[]);_ltPrepareImages(doc,options.image_base_url||"",options);return TC(doc.body().html(),j,cache,options);
}