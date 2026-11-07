/* legado-shared-runtime v3: public common only; no site code or credentials. */
var LEGADO_SHARED_RUNTIME="3";
var LEGADO_TRANSLATION_RUNTIME="3";
function _ltString(v){return v==null?"":String(v);}
function _ltCacheGet(c,k){return c?c.get(k):null;}
function _ltCachePut(c,k,v,s){if(c)c.put(k,v,s);}
function _ltLang(j){return _ltString(j.get("TARGET_LANG")).trim()||"zh-Hans";}
function _ltJavaString(v){return v!=null&&typeof v.getClass==="function"&&String(v.getClass().getName())==="java.lang.String";}
function _ltText(v){return typeof v==="string"||v instanceof String||_ltJavaString(v);}
function _ltArray(v){return Object.prototype.toString.call(v)==="[object Array]";}
function _ltBody(r){return r==null?"":_ltText(r)?String(r):_ltString(r.body());}
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
function _ltOptions(body){return useHtmlRuleJson({headers:{Authorization:"Bearer ","Content-Type":"application/json"},method:"post",body:JSON.stringify(body)});}
function _ltUrl(lang,body){return"https://edge.microsoft.com/translate/translatetext?to="+encodeURIComponent(lang)+","+_ltOptions(body);}
/* Only external I/O failures preserve the original text. Programming errors,
 * bad selectors and broken caller objects keep their original exception. */
function _ltRequests(j,urls){
    try{return j.ajaxAll(urls,false);}
    catch(e){
        _ltNetworkError(e,j);
        return [];
    }
}
function _ltNetworkError(e,j){
    if(!e||!e.javaException||!(e.javaException instanceof Packages.java.io.IOException))throw e;
    j.log("Common service unavailable: "+String(e.javaException.getClass().getSimpleName()));
}
/* Invalid external JSON is a service response, not a caller/cached-data error.
 * Convert before the catch so a broken caller's toString is never hidden. */
function _ltServiceJson(body,j){
    body=_ltString(body);
    try{return JSON.parse(body);}catch(e){
        if(!(e instanceof SyntaxError))throw e;
        if(j)j.log("Common service returned invalid JSON");
        return null;
    }
}
function _ltTexts(response){
    var data=_ltServiceJson(_ltBody(response));
    if(!_ltArray(data))return null;
    var out=[],i,translations;
    for(i=0;i<data.length;i++){
        translations=data[i]&&data[i].translations;
        if(!_ltArray(translations)||!translations[0]||!_ltText(translations[0].text))return null;
        out[i]=String(translations[0].text);
    }
    return out;
}
function _ltJoin(values){var out=[],i;for(i=0;i<values.length;i++)out.push(_ltMarker(i+1)+"\n"+values[i]);return out.join("\n");}
function _ltFallbackValues(j,lang,values){
    var out=values.slice(0),urls=[],i,start,end,res,texts;
    for(i=0;i<values.length;i++)urls.push(_ltUrl(lang,[values[i]]));
    for(start=0;start<urls.length;start+=4){
        end=Math.min(start+4,urls.length);res=[];
        res=_ltRequests(j,urls.slice(start,end));
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
        responses=_ltRequests(j,urls.slice(wave,end));
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
    if(stringInput)data=JSON.parse(_ltString(json));
    if(keys!=null){if(!_ltArray(keys))throw new TypeError("TJ keys must be an array");allow={};for(var a=0;a<keys.length;a++)allow["$"+_ltString(keys[a])]=true;if(!keys.length)return json;}
    function walk(v,parent,key){
        if(_ltText(v)){if(!_ltSkipKey(key)&&(allow==null||allow["$"+key])){refs.push({parent:parent,key:key});values.push(_ltString(v));}return;}
        if(_ltArray(v)){for(var i=0;i<v.length;i++)walk(v[i],v,i);return;}
        if(v&&typeof v==="object")for(var name in v)if(Object.prototype.hasOwnProperty.call(v,name))walk(v[name],v,name);
    }
    walk(data,null,"");
    if(values.length){var translated=TT(values,j,cache);for(var i=0;i<refs.length;i++)if(refs[i].parent==null)data=translated[i];else refs[i].parent[refs[i].key]=translated[i];}
    return stringInput?JSON.stringify(data):data;
}
function _ltExcluded(node,selectors){var p=node.parent(),i;while(p){if(p.hasClass("notranslate"))return true;for(i=0;selectors&&i<selectors.length;i++)if(p.is(String(selectors[i])))return true;p=p.parent();}return false;}
function TC(html,j,cache,options){
    options=options||{};if(html==null||!_ltString(html).trim())return html;
    var doc=org.jsoup.Jsoup.parseBodyFragment(_ltString(html)),els=doc.select("*"),nodes=[],values=[],i,k,tn,v;
    for(i=0;i<els.size();i++){tn=els.get(i).textNodes();for(k=0;k<tn.size();k++){v=_ltString(tn.get(k).getWholeText());if(v.trim()&&!_ltExcluded(tn.get(k),options.notranslate_selector||[])){nodes.push(tn.get(k));values.push(v);}}}
    var translated=TT(values,j,cache);for(i=0;i<nodes.length;i++)nodes[i].text(_ltString(translated[i]));return _ltString(doc.body().html());
}
function _ltRemove(doc,selectors){for(var i=0;selectors&&i<selectors.length;i++)doc.select(String(selectors[i])).remove();}
function _ltExtract(doc,selectors){
    var i,j,selected,el;
    for(i=0;selectors&&i<selectors.length;i++){
        selected=doc.select(String(selectors[i]));
        for(j=0;j<selected.size();j++){
            el=selected.get(j);
            // usehtml is a protection wrapper, not a request to flatten its
            // DOM. Ordinary extraction (notably tex-math) stays text-only.
            if(_ltString(el.tagName()).toLowerCase()==="usehtml")el.unwrap();
            else el.replaceWith(new org.jsoup.nodes.TextNode(_ltString(el.text())));
        }
    }
}
function ltExtract(html,j,selectors){
    if(html==null)return html;
    var nodeInput=typeof html.select==="function",doc=nodeInput?html:org.jsoup.Jsoup.parseBodyFragment(_ltString(html));
    _ltExtract(doc,selectors||[]);
    return nodeInput?doc:_ltString(doc.body().html());
}
function _ltSrcset(value){
    var s=_ltString(value),at=0,start,url,descriptor,match,score,best="",bestScore=-1;
    while(at<s.length){
        while(at<s.length&&/[\s,]/.test(s.charAt(at)))at++;
        start=at;
        var data=s.substring(at,at+5).toLowerCase()==="data:";
        while(at<s.length&&!/\s/.test(s.charAt(at))&&(data||s.charAt(at)!==","))at++;
        url=s.substring(start,at).replace(/,+$/,"");
        start=at;
        while(at<s.length&&s.charAt(at)!==",")at++;
        descriptor=s.substring(start,at).trim();at++;
        match=descriptor.match(/^([0-9]+(?:\.[0-9]+)?)[wx]$/);
        score=match?parseFloat(match[1]):0;
        if(_ltUsable(url)&&score>=bestScore){best=url;bestScore=score;}
    }
    return best;
}
function _ltUsable(v){v=_ltString(v).trim().toLowerCase();return!!v&&v!=="#"&&v.indexOf("javascript:")!==0&&v.indexOf("about:")!==0&&v.indexOf("transparent")<0&&v.indexOf("placeholder")<0&&v.indexOf("spacer")<0;}
function _ltAttr(el,key){var v=_ltString(el.attr(key)).trim();return key.indexOf("srcset")>=0?_ltSrcset(v):v;}
function _ltReplaceAltImages(doc,selectors){var i,j,els,el,src,img;for(i=0;selectors&&i<selectors.length;i++){els=doc.select(String(selectors[i]));for(j=0;j<els.size();j++){el=els.get(j);src=_ltString(el.attr("data-altimg")).trim();if(!src)continue;img=doc.createElement("img");img.attr("src",src);el.replaceWith(img);}}}
function _ltAnchor(href,options){if(options.image_anchor_suffix)return href+_ltString(options.image_anchor_suffix);return options.image_anchor_options?href+","+useHtmlRuleJson(options.image_anchor_options):href;}
var _LT_LAZY=["data-src","data-original","data-original-src","data-lazy-src","data-lazy","data-echo","data-img-src","data-image-url","data-image","data-url","data-fallback-src","data-full-src","data-hi-res-src","data-large-file","data-srcset"];
function _ltPrepareImages(doc,options){
    options=options||{};var imgs=doc.select("img"),i,k,pk,img,src,loading,parent,href,anchor,picture,source,sourceKeys=["data-srcset","srcset","data-src","src"],lazy,candidate,attrs,attr;
    for(i=0;i<imgs.size();i++){
        img=imgs.get(i);src=_ltString(img.attr("src")).trim();loading=_ltString(img.attr("loading")).toLowerCase();parent=img.parent();href=parent&&String(parent.tagName()).toLowerCase()==="a"?_ltString(parent.attr("href")).trim():"";anchor=false;picture="";
        if(parent&&String(parent.tagName()).toLowerCase()==="picture"){var sources=parent.select("source");for(pk=0;pk<sources.size()&&!_ltUsable(picture);pk++){source=sources.get(pk);for(k=0;k<sourceKeys.length;k++){picture=_ltAttr(source,sourceKeys[k]);if(_ltUsable(picture))break;}}}
        if(options.image_anchor_mode==="href"&&loading==="lazy"&&_ltUsable(href)){src=_ltAnchor(href,options);anchor=true;}
        if(!anchor&&_ltUsable(picture))src=picture;
        if(!anchor&&!_ltUsable(picture)){lazy="";for(k=0;k<_LT_LAZY.length;k++){candidate=_ltAttr(img,_LT_LAZY[k]);if(_ltUsable(candidate)){lazy=candidate;break;}}if(!lazy)lazy=_ltAttr(img,"srcset");if(_ltUsable(lazy))src=lazy;}
        if(!_ltUsable(src)){for(k=0;k<_LT_LAZY.length&&!_ltUsable(src);k++)src=_ltAttr(img,_LT_LAZY[k]);if(!_ltUsable(src))src=_ltAttr(img,"srcset");}
        if(!_ltUsable(src)&&href)src=options.image_anchor_mode==="href"?_ltAnchor(href,options):href;
        // Legado's HtmlFormatter resolves the final image src against the
        // response URL, including URL options. Leave relative src untouched.
        if(src)img.attr("src",src);
        if(!src){img.remove();continue;}
        attrs=img.attributes().iterator();while(attrs.hasNext()){attr=attrs.next();if(String(attr.getKey()) !== "src"&&String(attr.getKey()) !== "alt")attrs.remove();}
    }
}
/* Image-only processing must not enable translation or HTML on another source. */
function ltPrepareImages(html,j,options){
    if(html==null||!_ltString(html).trim())return html;
    options=options||{};
    var nodeInput=typeof html.select==="function";
    var doc=nodeInput?html:org.jsoup.Jsoup.parseBodyFragment(_ltString(html));
    _ltReplaceAltImages(doc,options.image_alt_selector||[]);_ltPrepareImages(doc,options);
    return nodeInput?doc:_ltString(doc.body().html());
}
function _ltCodecogs(doc,selector){var formulas=doc.select(selector),el,tex,img,i;for(i=0;i<formulas.size();i++){el=formulas.get(i);tex=_ltCodecogsTex(el);if(!tex)continue;img=doc.createElement("img");img.attr("src",_ltFormulaSvgUrl(tex));img.attr("alt",tex);el.replaceWith(img);}}
function _ltFormulaEscaped(tex,index){var n=0;while(index>0&&tex.charAt(--index)==="\\")n++;return n%2===1;}
function _ltFormulaTex(value){
    var tex=_ltString(value).trim(),n=tex.length;
    if(n>=4&&tex.substring(0,2)==="$$"&&tex.substring(n-2)==="$$"&&!_ltFormulaEscaped(tex,n-2))return tex.substring(2,n-2).trim();
    if(n>=2&&tex.charAt(0)==="$"&&tex.charAt(1)!=="$"&&tex.charAt(n-1)==="$"&&(tex.charAt(n-2)!=="$"||_ltFormulaEscaped(tex,n-2))&&!_ltFormulaEscaped(tex,n-1))return tex.substring(1,n-1).trim();
    if(n>=4&&(tex.substring(0,2)==="\\("&&tex.substring(n-2)==="\\)"||tex.substring(0,2)==="\\["&&tex.substring(n-2)==="\\]")&&!_ltFormulaEscaped(tex,n-2))return tex.substring(2,n-2).trim();
    return tex;
}
function _ltCodecogsSpeechText(response){
    var doc=org.jsoup.Jsoup.parse(_ltBody(response));if(!doc.select("math").size())return"";return _ltString(doc.select("span.cc-speech").text()).replace(/\s+/g," ").trim();
}
function _ltCodecogsSpeech(texes,j,cache){
    var out={},seen={},pending=[],urls=[],i,tex,key,cached,wave,end,res,speech;
    for(i=0;i<texes.length;i++){
        tex=texes[i];key="$"+tex;if(!tex||seen[key])continue;seen[key]=true;
        cached=_ltCacheGet(cache,"codecogs_speech:v2:"+tex);
        if(cached!=null&&_ltString(cached).trim()){out[key]=_ltString(cached);continue;}
        pending.push(tex);urls.push("https://latex.codecogs.com/mathml.latex?"+encodeURIComponent(tex));
    }
    for(wave=0;wave<urls.length;wave+=4){
        if(wave)Packages.java.lang.Thread.sleep(500);
        end=Math.min(wave+4,urls.length);res=[];
        // ajaxAll returns a Java array on the phone, not a java.util.List.
        // A failed wave falls back locally; never retry per formula node.
        res=_ltRequests(j,urls.slice(wave,end));
        for(i=0;i<res.length&&wave+i<end;i++){
            speech=_ltCodecogsSpeechText(res[i]);if(!speech)continue;
            tex=pending[wave+i];out["$"+tex]=speech;_ltCachePut(cache,"codecogs_speech:v2:"+tex,speech,2592000);
        }
    }
    return out;
}
function _ltCodecogsTex(el){
    var tex=_ltString(el.attr("data-tex")).trim()||_ltString(el.attr("data-original-tex")).trim()||_ltString(el.attr("alttext")).trim(),tm;
    if(!tex){tm=el.select("tex-math").first();tex=tm?_ltString(tm.text()):"";}
    return _ltFormulaTex(tex);
}
function _ltCodecogsWithSpeech(doc,selector,j,cache){
    var formulas,items=[],texes=[],el,tex,tm,semantic,math,fallback,speeches,img,label,i;
    formulas=doc.select(selector);
    for(i=0;i<formulas.size();i++){
        el=formulas.get(i);
        // Only a convertible outer container owns nested math. A wrapper
        // without TeX must not prevent a child with alttext from converting.
        var parent=el.parent(),nested=false;
        while(parent){if(parent.is(selector)&&_ltCodecogsTex(parent)){nested=true;break;}parent=parent.parent();}
        if(nested)continue;
        tex=_ltCodecogsTex(el);if(!tex)continue;
        semantic=_ltString(el.attr("data-semantic-speech")).trim();math=el.select("math");
        fallback=semantic||_ltString(math.text()).trim()||_ltString(el.select("span.mi, mi").text()).trim()||tex;
        items.push({el:el,tex:tex,fallback:fallback});texes.push(tex);
    }
    speeches=_ltCodecogsSpeech(texes,j,cache);
    for(i=0;i<items.length;i++){
        el=items[i].el;tex=items[i].tex;
        img=doc.createElement("img");img.attr("src",_ltFormulaSvgUrl(tex));img.attr("alt",tex);
        label=doc.createElement("span");label.addClass("formula-speech");label.addClass("notranslate");label.text(" "+(speeches["$"+tex]||items[i].fallback)+" ");
        el.replaceWith(img);img.after(label);
    }
}
function _ltWirisSvg(mathml,j){
    var options={method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"mml="+encodeURIComponent(String(mathml))};
    var svg=_ltBody(_ltRequests(j,["https://www.wiris.net/demo/editor/render?format=svg,"+useHtmlRuleJson(options)])[0]).trim();
    return svg.indexOf("<svg")<0?"":"data:image/svg+xml;base64,"+j.base64Encode(svg);
}
function _ltWiris(doc,selector,j){
    var formulas=doc.select(selector||"math"),i;
    for(i=0;i<formulas.size();i++){
        var el=formulas.get(i),math=el.select("math").first()||el;
        var imageSrc=_ltWirisSvg(String(math.outerHtml()),j);
        if(!imageSrc)continue;
        var speech=_ltString(el.attr("data-semantic-speech")||el.text()).replace(/\s+/g," ").trim();
        var img=doc.createElement("img");img.attr("src",imageSrc);img.attr("alt",speech);el.replaceWith(img);
        if(speech){var label=doc.createElement("span");label.addClass("formula-speech");label.addClass("notranslate");label.text(" "+speech+" ");img.after(label);}
    }
}
function TH(html,j,cache,options){
    options=options||{};if(html==null||!_ltString(html).trim())return html;var doc=typeof html.select==="function"?html:org.jsoup.Jsoup.parseBodyFragment(_ltString(html)),mode=options.formula_mode||"none",selector=options.formula_selector;
    if(options.readable)doc=_ltReadableDocument(doc,options.remove_selector||[]);
    _ltRemove(doc,options.remove_selector||[]);
    if(mode==="codecogs"){if(options.formula_speech===true)_ltCodecogsWithSpeech(doc,selector||"math",j,cache);else _ltCodecogs(doc,selector||"math");}else if(mode==="wiris")_ltWiris(doc,selector||"math",j);
    _ltExtract(doc,options.extract_selector||[]);_ltReplaceAltImages(doc,options.image_alt_selector||[]);_ltPrepareImages(doc,options);return TC(doc.body().html(),j,cache,options);
}

/* Encode literal JSON data without exposing HTML/@/{{...}} to rule expansion. */
function useHtmlRuleJson(value) {
    var json = JSON.stringify(value);
    if (json == null) return json;
    return json.replace(/"(?:\\.|[^"\\])*"/g, function (literal) {
        return literal.replace(/[<>&@{}]/g, function (character) {
            return '\\u' + ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
        });
    });
}

/* Cache/export sees .svg; AnalyzeUrl's image request uses the real endpoint. */
function _ltFormulaSvgUrl(tex) {
    return "https://latex.codecogs.com/svg.latex.svg?" + encodeURIComponent(tex)
        + "," + JSON.stringify({js: "String(result).replace('/svg.latex.svg?', '/svg.latex?')"});
}

/* Preserve semantic HTML without forcing formula images into setTypeHtml. */
function ltUseHtmlBlocks(html,j,options) {
    var s = _ltString(html);
    if (!s) return s;
    var doc, blocks, i, el, one, key, out, prefix = "LDUHM";
    var store = [];
    doc = org.jsoup.Jsoup.parseBodyFragment(s);
    doc.outputSettings().prettyPrint(false);
    doc.select("usehtml").unwrap();
    _ltPrepareImages(doc,options||{});
    blocks = doc.select("h1,h2,h3,h4,h5,h6,blockquote");
    // Do not accidentally replace user text which happens to resemble a marker.
    while (s.indexOf(prefix) >= 0) prefix += "X";
    for (i = 0; i < blocks.size(); i++) {
        el = blocks.get(i);
        if (el.select("img").size() > 0) continue;
        one = String(el.outerHtml()).replace(/[\r\n]+/g, " ");
        if (!one.replace(/^\s+|\s+$/g, "")) continue;
        key = prefix + store.length + "LDUHE";
        store.push(one);
        el.replaceWith(new org.jsoup.nodes.TextNode(key));
    }
    out = String(doc.body().html());
    for (i = 0; i < store.length; i++) {
        var marker = new RegExp("[\\r\\n]*" + prefix + i + "LDUHE[\\r\\n]*", "g");
        // A callback keeps literal $&, $1 and TeX backslashes out of String's
        // replacement syntax, and repeated calls never nest usehtml wrappers.
        out = out.replace(marker, (function (block) {
            return function () { return "\n<usehtml>" + block + "</usehtml>\n"; };
        })(store[i]));
    }
    return out;
}

/* Login forms are data. Actions receive the current caller explicitly. */
function _ltFormValue(form,key) {
    var value=typeof form.get==="function"?form.get(key):form[key];
    return _ltString(value);
}
function _ltSetTargetLang(j,form) {
    var languages={"简体中文":"zh-Hans","繁体中文":"zh-Hant","文言文":"lzh"};
    j.put("TARGET_LANG",languages[_ltFormValue(form,"翻译语言")]||"zh-Hans");
}
function _ltSetRenderMode(j,form) {
    var value=(_ltFormValue(form,"渲染模式")||"HTML").toUpperCase();
    j.put("RENDER_MODE",value==="HTML"?"html":"text");
}
function _ltLogin(j,form,options) {
    options=options||{};
    if(options.language)_ltSetTargetLang(j,form);
    if(options.render)_ltSetRenderMode(j,form);
    var fields=options.fields||{};
    for(var key in fields)if(Object.prototype.hasOwnProperty.call(fields,key))j.put(key,_ltFormValue(form,fields[key]));
}
function _ltOpen(j,s,book,target) {
    if(target==="source")return j.startBrowser(String(s.bookSourceUrl),String(s.bookSourceName));
    if(target==="toc")return j.startBrowser(String(book.tocUrl),String(book.name));
    if(target==="book")return j.startBrowser(String(book.bookUrl),String(book.name));
    return j.startBrowser(String(target),"");
}
var _LT_LOGIN_ROWS={
    language:{name:"翻译语言",type:"select",chars:["简体中文","繁体中文","文言文"],default:"简体中文",action:"common(java).setTargetLang(java,result)"},
    render:{name:"渲染模式",type:"toggle",chars:["TEXT","HTML"],default:"HTML",action:"common(java).setRenderMode(java,result)",style:{layout_justifySelf:"right"}},
    source:{name:"SourceUrl",type:"button",action:"common(java).open(java,source,null,'source')"},
    toc:{name:"ToC",type:"button",action:"common(java).open(java,source,book,'toc')"},
    library:{name:"文献虫",type:"none",action:'common(java).open(java,source,null,"http://b.r88r.top/e/action/ListInfo/?classid=89")'},
    proxy:{name:"proxyUrl",type:"select",chars:["http://dept-haow:9090","http://secure-proxy4.qualcomm.com:9090",""],default:""},
    chunkSize:{name:"chunkSize",type:"text"},
    typesenseKey:{name:"typesenseApiKey",type:"text"}
};
function _ltLoginUi(rows) {
    rows=rows||["language","source","toc","library","proxy"];
    var out=[];
    for(var i=0;i<rows.length;i++){
        var row=typeof rows[i]==="string"?_LT_LOGIN_ROWS[rows[i]]:rows[i];
        if(!row)throw new Error("Unknown common login row: "+rows[i]);
        out.push(row);
    }
    return JSON.stringify(out);
}

/* loginCheckJs receives Legado's StrResponse, not an arbitrary JSON value. */
function _ltChallenge(body,kind) {
    var t=_ltString(body).toLowerCase();
    if(kind==="dom"){
        var d=org.jsoup.Jsoup.parse(t),title=_ltString(d.title()),text=_ltString(d.body().text());
        return /^(just a moment|attention required|access denied)/.test(title)
            ||d.select("#challenge-running,#challenge-stage,#cf-challenge-running").size()>0
            ||(text.length<1200&&/enable javascript and cookies|verify you are human|performing security verification/.test(text));
    }
    if(kind==="waf")return /max challenge attempts exceeded|aws waf|awswaf|access denied|the request could not be satisfied|unusual traffic detected|temporarily unavailable/.test(t);
    if(kind==="fastly")return /client challenge|fastly|verify you are human|access denied|captcha|temporarily unavailable/.test(t);
    if(kind==="imageCaptcha")return /bobcmn|what code is in the image|id="ans"|support id|data processing\.\.\. please, wait|captcha/.test(t);
    if(kind==="chineseCaptcha")return /安全验证|人机识别|captcha|clickword|verify\/home|errorpage/.test(t)||(/access denied/.test(t)&&/cloudflare|ray id/.test(t));
    if(kind==="genericVerification")return /cloudflare|captcha|verify you are human|access denied|security check|robot check|请验证|验证码|访问过于频繁/.test(t);
    var cf=/cf-chl-/.test(t),denied=/access denied/.test(t);
    if(kind==="iris")return /just a moment|enable javascript and cookies|verify you are human/.test(t)||(cf&&/challenge/.test(t))||(denied&&/ray id/.test(t));
    if(kind==="strictCloudflare")return /just a moment|performing security verification|verify you are human|enable javascript and cookies to continue/.test(t)||(cf&&/challenge/.test(t))||(denied&&/ray id/.test(t));
    if(kind==="akamai")return _ltChallenge(t,"strictCloudflare")||/challenge-platform|errors\.edgesuite\.net/.test(t)||(denied&&/cloudflare/.test(t))||(/akamai/.test(t)&&/reference #/.test(t));
    if(kind&&kind!=="cloudflare")throw new Error("Unknown challenge kind: "+kind);
    return /just a moment|performing security verification|verify you are human|enable javascript and cookies/.test(t)
        ||(cf&&/challenge|verify/.test(t))||(denied&&/ray id|cloudflare/.test(t));
}
function _ltCheck(response,j,options) {
    options=options||{};
    var kind=options.kind,name=options.name||"站点";
    function blocked(value){
        return _ltChallenge(value.body(),kind)||(options.codes||[]).indexOf(value.code())>=0
            ||!!(options.redirectHost&&/\/(loi|doi|journal)(\/|$)/i.test(String(j.url))&&new RegExp(options.redirectHost+"/?$","i").test(String(value.url())));
    }
    if(!blocked(response))return response;
    if(options.manual)throw new Error(name+" 需要手动认证；请通过书源登录的 SourceUrl 刷新后重试");
    var url=options.requestUrl?String(j.url):String(response.url());
    var verified=j.startBrowserAwait(url,options.title||name+"人工验证",!!options.refetchAfterSuccess);
    if(options.refetch)verified=j.connect(url,null,options.timeout||20000);
    if(blocked(verified))throw new Error(name+" 人工验证后仍被阻断");
    return verified;
}

/* Internal requests and cross-page assets still need an absolute URL. Final
 * book/chapter/cover/img output uses Legado's own URL resolution instead. */
function _ltResolveRequest(value,base){
    var path=_ltString(_ltArray(value)?value[0]:value).trim();
    if(!path||/^(?:javascript:|data:|mailto:|#)/i.test(path))return "";
    return String(new Packages.java.net.URL(new Packages.java.net.URL(String(base).replace(/,\s*\{[\s\S]*$/,"")),path));
}
function _ltClean(doc,selectors) {
    _ltRemove(doc,selectors||["script","noscript","style","nav","aside","footer","form","iframe","template"]);
    var elements=doc.getAllElements();
    for(var i=0;i<elements.size();i++){
        var attrs=elements.get(i).attributes().iterator();
        while(attrs.hasNext()){
            var attr=attrs.next();
            if(/^on/i.test(String(attr.getKey()))||/^javascript:/i.test(String(attr.getValue())))attrs.remove();
        }
    }
    return doc;
}
function _ltFinish(doc,j,cache,translate){
    _ltClean(doc);ltPrepareImages(doc,j);
    var html=String(doc.body().html());
    return translate?TC(html,j,cache,{notranslate_selector:[".notranslate","math",".MathJax_Display"]}):html;
}

/* Jsoup paragraph scoring; recover Next.js payloads before removing scripts.
 * No fixed site selectors, and no exception-to-empty-content fallback. */
function _ltRscHtml(payload){
    var strings=String(payload).match(/"(?:\\.|[^"\\])*"/g)||[],html=[],i,k;
    for(i=0;i<strings.length;i++){
        var text=JSON.parse(strings[i]);
        // An RSC wire row can contain another serialized HTML string. Decode
        // JSON string literals only; never replace raw TeX backslashes or eval
        // page scripts. Plain HTML does not need this second wire layer.
        if(/^(?:[0-9a-f]+:|[\[{])/i.test(text)){
            var nested=text.match(/"(?:\\.|[^"\\])*"/g)||[],parts=[];
            for(k=0;k<nested.length;k++){
                var value=JSON.parse(nested[k]);
                if(/<(?:article|div|p|pre|blockquote|td)\b/i.test(value))parts.push(value);
            }
            if(parts.length)text=parts.join("\n");
        }
        if(/<(?:article|div|p|pre|blockquote|td)\b/i.test(text))html.push(text);
    }
    return html.join("\n");
}
function _ltReadableDocument(doc,remove){
    var scripts=doc.select("script"),payload="",i;
    for(i=0;i<scripts.size();i++){
        var data=String(scripts.get(i).data());
        if(data.indexOf("__next_f.push")>=0)payload+=data+"\n";
    }
    _ltRemove(doc,remove);
    var positive=/article|body|content|entry|hentry|main|page|post|richtext|story|text/i;
    var negative=/comment|footer|nav|menu|related|sidebar|social|share|promo|subscribe|advert|banner|breadcrumb|cookie|modal|pagination|toolbar/i;
    var attr="data-legado-readability-score";
    function classes(el){return String(el.className())+" "+String(el.id());}
    function add(el,score){
        if(el==null||negative.test(classes(el)))return;
        var tag=String(el.tagName()).toLowerCase();if(tag==="html"||tag==="body")return;
        el.attr(attr,String((parseFloat(String(el.attr(attr)))||0)+score));
    }
    function extract(input){
        var paragraphs=input.select("p,pre,blockquote,td"),i,text,score;
        for(i=0;i<paragraphs.size();i++){
            var p=paragraphs.get(i);if(negative.test(classes(p)))continue;
            text=String(p.text()).trim();if(text.length<40)continue;
            score=1+Math.min(3,Math.floor(text.length/100))+Math.min(3,(text.match(/[,，;；:：]/g)||[]).length);
            add(p.parent(),score);add(p.parent()==null?null:p.parent().parent(),score/2);
        }
        var candidates=input.select("["+attr+"]"),best=null,bestScore=0;
        for(i=0;i<candidates.size();i++){
            var candidate=candidates.get(i),length=String(candidate.text()).trim().length;if(length<200)continue;
            var density=String(candidate.select("a").text()).trim().length/length,value=classes(candidate);
            score=(parseFloat(String(candidate.attr(attr)))||0)*(1-Math.min(0.9,density))+(positive.test(value)?25:0)-(negative.test(value)?40:0);
            if(score>bestScore){best=candidate;bestScore=score;}
        }
        if(best==null)return null;
        var readable=best.clone();readable.removeAttr(attr);
        var scored=readable.select("["+attr+"]");for(i=0;i<scored.size();i++)scored.get(i).removeAttr(attr);
        readable.select("script,noscript,style,svg,nav,aside,header,footer,form,button,input,iframe,[hidden],[aria-hidden=true]").remove();
        var descendants=readable.select("*");for(i=descendants.size()-1;i>=0;i--)if(negative.test(classes(descendants.get(i))))descendants.get(i).remove();
        return String(readable.text()).trim().length>=200?readable:null;
    }
    var readable=extract(doc);
    if(readable==null&&payload.length>=100){
        var html=_ltRscHtml(payload);
        var next=org.jsoup.Jsoup.parse('<article class="legado-next-payload">'+html+'</article>');
        if(String(next.select("article.legado-next-payload").text()).trim().length>=200)readable=extract(next);
    }
    return readable==null?doc:org.jsoup.Jsoup.parseBodyFragment(String(readable.outerHtml()));
}

/* A WebView only prepares the DOM. TH/TC performs translation once in Rhino. */
function _ltWebClean(doc,options) {
    options=options||{};
    var selectors=options.remove||["script","noscript","style","nav","aside"];
    for(var i=0;i<selectors.length;i++){
        var nodes=doc.querySelectorAll(selectors[i]);
        for(var k=0;k<nodes.length;k++)nodes[k].parentNode.removeChild(nodes[k]);
    }
    if(options.readable){
        var article=_ltBrowserReadable(doc.cloneNode(true));
        if(!article)throw new Error("Readability found no article; inspect the source's page/selector");
        doc.body.innerHTML=article.content;
    }
    if(options.title){
        var title=doc.createElement("title");title.textContent=doc.title;doc.body.insertBefore(title,doc.body.firstChild);
    }
    return doc.body.outerHTML;
}

function _ltBrowserReadable(doc) {
/*eslint-env es6:false*/
    /*
     * Copyright (c) 2010 Arc90 Inc
     *
     * Licensed under the Apache License, Version 2.0 (the "License");
     * you may not use this file except in compliance with the License.
     * You may obtain a copy of the License at
     *
     *     http://www.apache.org/licenses/LICENSE-2.0
     *
     * Unless required by applicable law or agreed to in writing, software
     * distributed under the License is distributed on an "AS IS" BASIS,
     * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
     * See the License for the specific language governing permissions and
     * limitations under the License.
     */

    /*
     * This code is heavily based on Arc90's readability.js (1.7.1) script
     * available at: http://code.google.com/p/arc90labs-readability
     */

    /**
     * Public constructor.
     * @param {HTMLDocument} doc     The document to parse.
     * @param {Object}       options The options object.
     */
    function Readability(doc, options) {
	// In some older versions, people passed a URI as the first argument. Cope:
	if (options && options.documentElement) {
	    doc = options;
	    options = arguments[2];
	} else if (!doc || !doc.documentElement) {
	    throw new Error("First argument to Readability constructor should be a document object.");
	}
	options = options || {};

	this._doc = doc;
	this._articleTitle = null;
	this._articleByline = null;
	this._articleDir = null;
	this._articleSiteName = null;
	this._attempts = [];

	// Configurable options
	this._debug = !!options.debug;
	this._maxElemsToParse = options.maxElemsToParse || this.DEFAULT_MAX_ELEMS_TO_PARSE;
	this._nbTopCandidates = options.nbTopCandidates || this.DEFAULT_N_TOP_CANDIDATES;
	this._charThreshold = options.charThreshold || this.DEFAULT_CHAR_THRESHOLD;
	this._classesToPreserve = this.CLASSES_TO_PRESERVE.concat(options.classesToPreserve || []);

	// Start with all flags set
	this._flags = this.FLAG_STRIP_UNLIKELYS |
            this.FLAG_WEIGHT_CLASSES |
            this.FLAG_CLEAN_CONDITIONALLY;

	var logEl;

	// Control whether log messages are sent to the console
	if (this._debug) {
	    logEl = function(e) {
		var rv = e.nodeName + " ";
		if (e.nodeType == e.TEXT_NODE) {
		    return rv + '("' + e.textContent + '")';
		}
		var classDesc = e.className && ("." + e.className.replace(/ /g, "."));
		var elDesc = "";
		if (e.id)
		    elDesc = "(#" + e.id + classDesc + ")";
		else if (classDesc)
		    elDesc = "(" + classDesc + ")";
		return rv + elDesc;
	    };
	    this.log = function () {
		if (typeof dump !== "undefined") {
		    var msg = Array.prototype.map.call(arguments, function(x) {
			return (x && x.nodeName) ? logEl(x) : x;
		    }).join(" ");
		    dump("Reader: (Readability) " + msg + "\n");
		} else if (typeof console !== "undefined") {
		    var args = ["Reader: (Readability) "].concat(arguments);
		    console.log.apply(console, args);
		}
	    };
	} else {
	    this.log = function () {};
	}
    }

    Readability.prototype = {
	FLAG_STRIP_UNLIKELYS: 0x1,
	FLAG_WEIGHT_CLASSES: 0x2,
	FLAG_CLEAN_CONDITIONALLY: 0x4,

	// https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
	ELEMENT_NODE: 1,
	TEXT_NODE: 3,

	// Max number of nodes supported by this parser. Default: 0 (no limit)
	DEFAULT_MAX_ELEMS_TO_PARSE: 0,

	// The number of top candidates to consider when analysing how
	// tight the competition is among candidates.
	DEFAULT_N_TOP_CANDIDATES: 5,

	// Element tags to score by default.
	DEFAULT_TAGS_TO_SCORE: "section,h2,h3,h4,h5,h6,p,td,pre".toUpperCase().split(","),

	// The default number of chars an article must have in order to return a result
	DEFAULT_CHAR_THRESHOLD: 500,

	// All of the regular expressions in use within readability.
	// Defined up here so we don't instantiate them repeatedly in loops.
	REGEXPS: {
	    // NOTE: These two regular expressions are duplicated in
	    // Readability-readerable.js. Please keep both copies in sync.
	    unlikelyCandidates: /-ad-|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|foot|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
	    okMaybeItsACandidate: /and|article|body|column|main|shadow/i,

	    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
	    negative: /hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
	    extraneous: /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
	    byline: /byline|author|dateline|writtenby|p-author/i,
	    replaceFonts: /<(\/?)font[^>]*>/gi,
	    normalize: /\s{2,}/g,
	    videos: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
	    nextLink: /(next|weiter|continue|>([^\|]|$)|禄([^\|]|$))/i,
	    prevLink: /(prev|earl|old|new|<|芦)/i,
	    whitespace: /^\s*$/,
	    hasContent: /\S$/,
	},

	DIV_TO_P_ELEMS: [ "A", "BLOCKQUOTE", "DL", "DIV", "IMG", "OL", "P", "PRE", "TABLE", "UL", "SELECT" ],

	ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P"],

	PRESENTATIONAL_ATTRIBUTES: [ "align", "background", "bgcolor", "border", "cellpadding", "cellspacing", "frame", "hspace", "rules", "style", "valign", "vspace" ],

	DEPRECATED_SIZE_ATTRIBUTE_ELEMS: [ "TABLE", "TH", "TD", "HR", "PRE" ],

	// The commented out elements qualify as phrasing content but tend to be
	// removed by readability when put into paragraphs, so we ignore them here.
	PHRASING_ELEMS: [
	    // "CANVAS", "IFRAME", "SVG", "VIDEO",
	    "ABBR", "AUDIO", "B", "BDO", "BR", "BUTTON", "CITE", "CODE", "DATA",
	    "DATALIST", "DFN", "EM", "EMBED", "I", "IMG", "INPUT", "KBD", "LABEL",
	    "MARK", "MATH", "METER", "NOSCRIPT", "OBJECT", "OUTPUT", "PROGRESS", "Q",
	    "RUBY", "SAMP", "SCRIPT", "SELECT", "SMALL", "SPAN", "STRONG", "SUB",
	    "SUP", "TEXTAREA", "TIME", "VAR", "WBR"
	],

	// These are the classes that readability sets itself.
	CLASSES_TO_PRESERVE: [ "page" ],

	/**
	 * Run any post-process modifications to article content as necessary.
	 *
	 * @param Element
	 * @return void
	 **/
	_postProcessContent: function(articleContent) {
	    // Readability cannot open relative uris so we convert them to absolute uris.
	    this._fixRelativeUris(articleContent);

	    // Remove classes.
	    this._cleanClasses(articleContent);
	},

	/**
	 * Iterates over a NodeList, calls `filterFn` for each node and removes node
	 * if function returned `true`.
	 *
	 * If function is not passed, removes all the nodes in node list.
	 *
	 * @param NodeList nodeList The nodes to operate on
	 * @param Function filterFn the function to use as a filter
	 * @return void
	 */
	_removeNodes: function(nodeList, filterFn) {
	    for (var i = nodeList.length - 1; i >= 0; i--) {
		var node = nodeList[i];
		var parentNode = node.parentNode;
		if (parentNode) {
		    if (!filterFn || filterFn.call(this, node, i, nodeList)) {
			parentNode.removeChild(node);
		    }
		}
	    }
	},

	/**
	 * Iterates over a NodeList, and calls _setNodeTag for each node.
	 *
	 * @param NodeList nodeList The nodes to operate on
	 * @param String newTagName the new tag name to use
	 * @return void
	 */
	_replaceNodeTags: function(nodeList, newTagName) {
	    for (var i = nodeList.length - 1; i >= 0; i--) {
		var node = nodeList[i];
		this._setNodeTag(node, newTagName);
	    }
	},

	/**
	 * Iterate over a NodeList, which doesn't natively fully implement the Array
	 * interface.
	 *
	 * For convenience, the current object context is applied to the provided
	 * iterate function.
	 *
	 * @param  NodeList nodeList The NodeList.
	 * @param  Function fn       The iterate function.
	 * @return void
	 */
	_forEachNode: function(nodeList, fn) {
	    Array.prototype.forEach.call(nodeList, fn, this);
	},

	/**
	 * Iterate over a NodeList, return true if any of the provided iterate
	 * function calls returns true, false otherwise.
	 *
	 * For convenience, the current object context is applied to the
	 * provided iterate function.
	 *
	 * @param  NodeList nodeList The NodeList.
	 * @param  Function fn       The iterate function.
	 * @return Boolean
	 */
	_someNode: function(nodeList, fn) {
	    return Array.prototype.some.call(nodeList, fn, this);
	},

	/**
	 * Iterate over a NodeList, return true if all of the provided iterate
	 * function calls return true, false otherwise.
	 *
	 * For convenience, the current object context is applied to the
	 * provided iterate function.
	 *
	 * @param  NodeList nodeList The NodeList.
	 * @param  Function fn       The iterate function.
	 * @return Boolean
	 */
	_everyNode: function(nodeList, fn) {
	    return Array.prototype.every.call(nodeList, fn, this);
	},

	/**
	 * Concat all nodelists passed as arguments.
	 *
	 * @return ...NodeList
	 * @return Array
	 */
	_concatNodeLists: function() {
	    var slice = Array.prototype.slice;
	    var args = slice.call(arguments);
	    var nodeLists = args.map(function(list) {
		return slice.call(list);
	    });
	    return Array.prototype.concat.apply([], nodeLists);
	},

	_getAllNodesWithTag: function(node, tagNames) {
	    if (node.querySelectorAll) {
		return node.querySelectorAll(tagNames.join(","));
	    }
	    return [].concat.apply([], tagNames.map(function(tag) {
		var collection = node.getElementsByTagName(tag);
		return Array.isArray(collection) ? collection : Array.from(collection);
	    }));
	},

	/**
	 * Removes the class="" attribute from every element in the given
	 * subtree, except those that match CLASSES_TO_PRESERVE and
	 * the classesToPreserve array from the options object.
	 *
	 * @param Element
	 * @return void
	 */
	_cleanClasses: function(node) {
	    var classesToPreserve = this._classesToPreserve;
	    var className = (node.getAttribute("class") || "")
		.split(/\s+/)
		.filter(function(cls) {
		    return classesToPreserve.indexOf(cls) != -1;
		})
		.join(" ");

	    if (className) {
		node.setAttribute("class", className);
	    } else {
		node.removeAttribute("class");
	    }

	    for (node = node.firstElementChild; node; node = node.nextElementSibling) {
		this._cleanClasses(node);
	    }
	},

	/**
	 * Converts each <a> and <img> uri in the given element to an absolute URI,
	 * ignoring #ref URIs.
	 *
	 * @param Element
	 * @return void
	 */
	_fixRelativeUris: function(articleContent) {
	    var baseURI = this._doc.baseURI;
	    var documentURI = this._doc.documentURI;
	    function toAbsoluteURI(uri) {
		// Leave hash links alone if the base URI matches the document URI:
		if (baseURI == documentURI && uri.charAt(0) == "#") {
		    return uri;
		}
		// Otherwise, resolve against base URI:
		try {
		    return new URL(uri, baseURI).href;
		} catch (ex) {
		    // Something went wrong, just return the original:
		}
		return uri;
	    }

	    var links = this._getAllNodesWithTag(articleContent, ["a"]);
	    this._forEachNode(links, function(link) {
		var href = link.getAttribute("href");
		if (href) {
		    // Replace links with javascript: URIs with text content, since
		    // they won't work after scripts have been removed from the page.
		    if (href.indexOf("javascript:") === 0) {
			var text = this._doc.createTextNode(link.textContent);
			link.parentNode.replaceChild(text, link);
		    } else {
			link.setAttribute("href", toAbsoluteURI(href));
		    }
		}
	    });

	    var imgs = this._getAllNodesWithTag(articleContent, ["img"]);
	    this._forEachNode(imgs, function(img) {
		var src = img.getAttribute("src");
		if (src) {
		    img.setAttribute("src", toAbsoluteURI(src));
		}
	    });
	},

	/**
	 * Get the article title as an H1.
	 *
	 * @return void
	 **/
	_getArticleTitle: function() {
	    var doc = this._doc;
	    var curTitle = "";
	    var origTitle = "";

	    try {
		curTitle = origTitle = doc.title.trim();

		// If they had an element with id "title" in their HTML
		if (typeof curTitle !== "string")
		    curTitle = origTitle = this._getInnerText(doc.getElementsByTagName("title")[0]);
	    } catch (e) {/* ignore exceptions setting the title. */}

	    var titleHadHierarchicalSeparators = false;
	    function wordCount(str) {
		return str.split(/\s+/).length;
	    }

	    // If there's a separator in the title, first remove the final part
	    if ((/ [\|\-\\\/>禄] /).test(curTitle)) {
		titleHadHierarchicalSeparators = / [\\\/>禄] /.test(curTitle);
		curTitle = origTitle.replace(/(.*)[\|\-\\\/>禄] .*/gi, "$1");

		// If the resulting title is too short (3 words or fewer), remove
		// the first part instead:
		if (wordCount(curTitle) < 3)
		    curTitle = origTitle.replace(/[^\|\-\\\/>禄]*[\|\-\\\/>禄](.*)/gi, "$1");
	    } else if (curTitle.indexOf(": ") !== -1) {
		// Check if we have an heading containing this exact string, so we
		// could assume it's the full title.
		var headings = this._concatNodeLists(
		    doc.getElementsByTagName("h1"),
		    doc.getElementsByTagName("h2")
		);
		var trimmedTitle = curTitle.trim();
		var match = this._someNode(headings, function(heading) {
		    return heading.textContent.trim() === trimmedTitle;
		});

		// If we don't, let's extract the title out of the original title string.
		if (!match) {
		    curTitle = origTitle.substring(origTitle.lastIndexOf(":") + 1);

		    // If the title is now too short, try the first colon instead:
		    if (wordCount(curTitle) < 3) {
			curTitle = origTitle.substring(origTitle.indexOf(":") + 1);
			// But if we have too many words before the colon there's something weird
			// with the titles and the H tags so let's just use the original title instead
		    } else if (wordCount(origTitle.substr(0, origTitle.indexOf(":"))) > 5) {
			curTitle = origTitle;
		    }
		}
	    } else if (curTitle.length > 150 || curTitle.length < 15) {
		var hOnes = doc.getElementsByTagName("h1");

		if (hOnes.length === 1)
		    curTitle = this._getInnerText(hOnes[0]);
	    }

	    curTitle = curTitle.trim().replace(this.REGEXPS.normalize, " ");
	    // If we now have 4 words or fewer as our title, and either no
	    // 'hierarchical' separators (\, /, > or 禄) were found in the original
	    // title or we decreased the number of words by more than 1 word, use
	    // the original title.
	    var curTitleWordCount = wordCount(curTitle);
	    if (curTitleWordCount <= 4 &&
		(!titleHadHierarchicalSeparators ||
		 curTitleWordCount != wordCount(origTitle.replace(/[\|\-\\\/>禄]+/g, "")) - 1)) {
		curTitle = origTitle;
	    }

	    return curTitle;
	},

	/**
	 * Prepare the HTML document for readability to scrape it.
	 * This includes things like stripping javascript, CSS, and handling terrible markup.
	 *
	 * @return void
	 **/
	_prepDocument: function() {
	    var doc = this._doc;

	    // Remove all style tags in head
	    this._removeNodes(doc.getElementsByTagName("style"));

	    if (doc.body) {
		this._replaceBrs(doc.body);
	    }

	    this._replaceNodeTags(doc.getElementsByTagName("font"), "SPAN");
	},

	/**
	 * Finds the next element, starting from the given node, and ignoring
	 * whitespace in between. If the given node is an element, the same node is
	 * returned.
	 */
	_nextElement: function (node) {
	    var next = node;
	    while (next
		   && (next.nodeType != this.ELEMENT_NODE)
		   && this.REGEXPS.whitespace.test(next.textContent)) {
		next = next.nextSibling;
	    }
	    return next;
	},

	/**
	 * Replaces 2 or more successive <br> elements with a single <p>.
	 * Whitespace between <br> elements are ignored. For example:
	 *   <div>foo<br>bar<br> <br><br>abc</div>
	 * will become:
	 *   <div>foo<br>bar<p>abc</p></div>
	 */
	_replaceBrs: function (elem) {
	    this._forEachNode(this._getAllNodesWithTag(elem, ["br"]), function(br) {
		var next = br.nextSibling;

		// Whether 2 or more <br> elements have been found and replaced with a
		// <p> block.
		var replaced = false;

		// If we find a <br> chain, remove the <br>s until we hit another element
		// or non-whitespace. This leaves behind the first <br> in the chain
		// (which will be replaced with a <p> later).
		while ((next = this._nextElement(next)) && (next.tagName == "BR")) {
		    replaced = true;
		    var brSibling = next.nextSibling;
		    next.parentNode.removeChild(next);
		    next = brSibling;
		}

		// If we removed a <br> chain, replace the remaining <br> with a <p>. Add
		// all sibling nodes as children of the <p> until we hit another <br>
		// chain.
		if (replaced) {
		    var p = this._doc.createElement("p");
		    br.parentNode.replaceChild(p, br);

		    next = p.nextSibling;
		    while (next) {
			// If we've hit another <br><br>, we're done adding children to this <p>.
			if (next.tagName == "BR") {
			    var nextElem = this._nextElement(next.nextSibling);
			    if (nextElem && nextElem.tagName == "BR")
				break;
			}

			if (!this._isPhrasingContent(next))
			    break;

			// Otherwise, make this node a child of the new <p>.
			var sibling = next.nextSibling;
			p.appendChild(next);
			next = sibling;
		    }

		    while (p.lastChild && this._isWhitespace(p.lastChild)) {
			p.removeChild(p.lastChild);
		    }

		    if (p.parentNode.tagName === "P")
			this._setNodeTag(p.parentNode, "DIV");
		}
	    });
	},

	_setNodeTag: function (node, tag) {
	    this.log("_setNodeTag", node, tag);
	    if (node.__JSDOMParser__) {
		node.localName = tag.toLowerCase();
		node.tagName = tag.toUpperCase();
		return node;
	    }

	    var replacement = node.ownerDocument.createElement(tag);
	    while (node.firstChild) {
		replacement.appendChild(node.firstChild);
	    }
	    node.parentNode.replaceChild(replacement, node);
	    if (node.readability)
		replacement.readability = node.readability;

	    for (var i = 0; i < node.attributes.length; i++) {
		try {
		    replacement.setAttribute(node.attributes[i].name, node.attributes[i].value);
		} catch (ex) {
		    /* it's possible for setAttribute() to throw if the attribute name
		     * isn't a valid XML Name. Such attributes can however be parsed from
		     * source in HTML docs, see https://github.com/whatwg/html/issues/4275,
		     * so we can hit them here and then throw. We don't care about such
		     * attributes so we ignore them.
		     */
		}
	    }
	    return replacement;
	},

	/**
	 * Prepare the article node for display. Clean out any inline styles,
	 * iframes, forms, strip extraneous <p> tags, etc.
	 *
	 * @param Element
	 * @return void
	 **/
	_prepArticle: function(articleContent) {
	    this._cleanStyles(articleContent);

	    // Check for data tables before we continue, to avoid removing items in
	    // those tables, which will often be isolated even though they're
	    // visually linked to other content-ful elements (text, images, etc.).
	    this._markDataTables(articleContent);

	    // Clean out junk from the article content
	    this._cleanConditionally(articleContent, "form");
	    this._cleanConditionally(articleContent, "fieldset");
	    this._clean(articleContent, "object");
	    this._clean(articleContent, "embed");
	    this._clean(articleContent, "h1");
	    this._clean(articleContent, "footer");
	    this._clean(articleContent, "link");
	    this._clean(articleContent, "aside");

	    // Clean out elements have "share" in their id/class combinations from final top candidates,
	    // which means we don't remove the top candidates even they have "share".
	    this._forEachNode(articleContent.children, function(topCandidate) {
		this._cleanMatchedNodes(topCandidate, /share/);
	    });

	    // If there is only one h2 and its text content substantially equals article title,
	    // they are probably using it as a header and not a subheader,
	    // so remove it since we already extract the title separately.
	    var h2 = articleContent.getElementsByTagName("h2");
	    if (h2.length === 1) {
		var lengthSimilarRate = (h2[0].textContent.length - this._articleTitle.length) / this._articleTitle.length;
		if (Math.abs(lengthSimilarRate) < 0.5) {
		    var titlesMatch = false;
		    if (lengthSimilarRate > 0) {
			titlesMatch = h2[0].textContent.includes(this._articleTitle);
		    } else {
			titlesMatch = this._articleTitle.includes(h2[0].textContent);
		    }
		    if (titlesMatch) {
			this._clean(articleContent, "h2");
		    }
		}
	    }

	    this._clean(articleContent, "iframe");
	    this._clean(articleContent, "input");
	    this._clean(articleContent, "textarea");
	    this._clean(articleContent, "select");
	    this._clean(articleContent, "button");
	    this._cleanHeaders(articleContent);

	    // Do these last as the previous stuff may have removed junk
	    // that will affect these
	    this._cleanConditionally(articleContent, "table");
	    this._cleanConditionally(articleContent, "ul");
	    this._cleanConditionally(articleContent, "div");

	    // Remove extra paragraphs
	    this._removeNodes(articleContent.getElementsByTagName("p"), function (paragraph) {
		var imgCount = paragraph.getElementsByTagName("img").length;
		var embedCount = paragraph.getElementsByTagName("embed").length;
		var objectCount = paragraph.getElementsByTagName("object").length;
		// At this point, nasty iframes have been removed, only remain embedded video ones.
		var iframeCount = paragraph.getElementsByTagName("iframe").length;
		var totalCount = imgCount + embedCount + objectCount + iframeCount;

		return totalCount === 0 && !this._getInnerText(paragraph, false);
	    });

	    this._forEachNode(this._getAllNodesWithTag(articleContent, ["br"]), function(br) {
		var next = this._nextElement(br.nextSibling);
		if (next && next.tagName == "P")
		    br.parentNode.removeChild(br);
	    });

	    // Remove single-cell tables
	    this._forEachNode(this._getAllNodesWithTag(articleContent, ["table"]), function(table) {
		var tbody = this._hasSingleTagInsideElement(table, "TBODY") ? table.firstElementChild : table;
		if (this._hasSingleTagInsideElement(tbody, "TR")) {
		    var row = tbody.firstElementChild;
		    if (this._hasSingleTagInsideElement(row, "TD")) {
			var cell = row.firstElementChild;
			cell = this._setNodeTag(cell, this._everyNode(cell.childNodes, this._isPhrasingContent) ? "P" : "DIV");
			table.parentNode.replaceChild(cell, table);
		    }
		}
	    });
	},

	/**
	 * Initialize a node with the readability object. Also checks the
	 * className/id for special names to add to its score.
	 *
	 * @param Element
	 * @return void
	 **/
	_initializeNode: function(node) {
	    node.readability = {"contentScore": 0};

	    switch (node.tagName) {
	    case "DIV":
		node.readability.contentScore += 5;
		break;

	    case "PRE":
	    case "TD":
	    case "BLOCKQUOTE":
		node.readability.contentScore += 3;
		break;

	    case "ADDRESS":
	    case "OL":
	    case "UL":
	    case "DL":
	    case "DD":
	    case "DT":
	    case "LI":
	    case "FORM":
		node.readability.contentScore -= 3;
		break;

	    case "H1":
	    case "H2":
	    case "H3":
	    case "H4":
	    case "H5":
	    case "H6":
	    case "TH":
		node.readability.contentScore -= 5;
		break;
	    }

	    node.readability.contentScore += this._getClassWeight(node);
	},

	_removeAndGetNext: function(node) {
	    var nextNode = this._getNextNode(node, true);
	    node.parentNode.removeChild(node);
	    return nextNode;
	},

	/**
	 * Traverse the DOM from node to node, starting at the node passed in.
	 * Pass true for the second parameter to indicate this node itself
	 * (and its kids) are going away, and we want the next node over.
	 *
	 * Calling this in a loop will traverse the DOM depth-first.
	 */
	_getNextNode: function(node, ignoreSelfAndKids) {
	    // First check for kids if those aren't being ignored
	    if (!ignoreSelfAndKids && node.firstElementChild) {
		return node.firstElementChild;
	    }
	    // Then for siblings...
	    if (node.nextElementSibling) {
		return node.nextElementSibling;
	    }
	    // And finally, move up the parent chain *and* find a sibling
	    // (because this is depth-first traversal, we will have already
	    // seen the parent nodes themselves).
	    do {
		node = node.parentNode;
	    } while (node && !node.nextElementSibling);
	    return node && node.nextElementSibling;
	},

	_checkByline: function(node, matchString) {
	    if (this._articleByline) {
		return false;
	    }

	    if (node.getAttribute !== undefined) {
		var rel = node.getAttribute("rel");
	    }

	    if ((rel === "author" || this.REGEXPS.byline.test(matchString)) && this._isValidByline(node.textContent)) {
		this._articleByline = node.textContent.trim();
		return true;
	    }

	    return false;
	},

	_getNodeAncestors: function(node, maxDepth) {
	    maxDepth = maxDepth || 0;
	    var i = 0, ancestors = [];
	    while (node.parentNode) {
		ancestors.push(node.parentNode);
		if (maxDepth && ++i === maxDepth)
		    break;
		node = node.parentNode;
	    }
	    return ancestors;
	},

	/***
	 * grabArticle - Using a variety of metrics (content score, classname, element types), find the content that is
	 *         most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
	 *
	 * @param page a document to run upon. Needs to be a full document, complete with body.
	 * @return Element
	 **/
	_grabArticle: function (page) {
	    this.log("**** grabArticle ****");
	    var doc = this._doc;
	    var isPaging = (page !== null ? true: false);
	    page = page ? page : this._doc.body;

	    // We can't grab an article if we don't have a page!
	    if (!page) {
		this.log("No body found in document. Abort.");
		return null;
	    }

	    var pageCacheHtml = page.innerHTML;

	    while (true) {
		var stripUnlikelyCandidates = this._flagIsActive(this.FLAG_STRIP_UNLIKELYS);

		// First, node prepping. Trash nodes that look cruddy (like ones with the
		// class name "comment", etc), and turn divs into P tags where they have been
		// used inappropriately (as in, where they contain no other block level elements.)
		var elementsToScore = [];
		var node = this._doc.documentElement;

		while (node) {
		    var matchString = node.className + " " + node.id;

		    if (!this._isProbablyVisible(node)) {
			this.log("Removing hidden node - " + matchString);
			node = this._removeAndGetNext(node);
			continue;
		    }

		    // Check to see if this node is a byline, and remove it if it is.
		    if (this._checkByline(node, matchString)) {
			node = this._removeAndGetNext(node);
			continue;
		    }

		    // Remove unlikely candidates
		    if (stripUnlikelyCandidates) {
			if (this.REGEXPS.unlikelyCandidates.test(matchString) &&
			    !this.REGEXPS.okMaybeItsACandidate.test(matchString) &&
			    node.tagName !== "BODY" &&
			    node.tagName !== "A") {
			    this.log("Removing unlikely candidate - " + matchString);
			    node = this._removeAndGetNext(node);
			    continue;
			}
		    }

		    // Remove DIV, SECTION, and HEADER nodes without any content(e.g. text, image, video, or iframe).
		    if ((node.tagName === "DIV" || node.tagName === "SECTION" || node.tagName === "HEADER" ||
			 node.tagName === "H1" || node.tagName === "H2" || node.tagName === "H3" ||
			 node.tagName === "H4" || node.tagName === "H5" || node.tagName === "H6") &&
			this._isElementWithoutContent(node)) {
			node = this._removeAndGetNext(node);
			continue;
		    }

		    if (this.DEFAULT_TAGS_TO_SCORE.indexOf(node.tagName) !== -1) {
			elementsToScore.push(node);
		    }

		    // Turn all divs that don't have children block level elements into p's
		    if (node.tagName === "DIV") {
			// Put phrasing content into paragraphs.
			var p = null;
			var childNode = node.firstChild;
			while (childNode) {
			    var nextSibling = childNode.nextSibling;
			    if (this._isPhrasingContent(childNode)) {
				if (p !== null) {
				    p.appendChild(childNode);
				} else if (!this._isWhitespace(childNode)) {
				    p = doc.createElement("p");
				    node.replaceChild(p, childNode);
				    p.appendChild(childNode);
				}
			    } else if (p !== null) {
				while (p.lastChild && this._isWhitespace(p.lastChild)) {
				    p.removeChild(p.lastChild);
				}
				p = null;
			    }
			    childNode = nextSibling;
			}

			// Sites like http://mobile.slate.com encloses each paragraph with a DIV
			// element. DIVs with only a P element inside and no text content can be
			// safely converted into plain P elements to avoid confusing the scoring
			// algorithm with DIVs with are, in practice, paragraphs.
			if (this._hasSingleTagInsideElement(node, "P") && this._getLinkDensity(node) < 0.25) {
			    var newNode = node.children[0];
			    node.parentNode.replaceChild(newNode, node);
			    node = newNode;
			    elementsToScore.push(node);
			} else if (!this._hasChildBlockElement(node)) {
			    node = this._setNodeTag(node, "P");
			    elementsToScore.push(node);
			}
		    }
		    node = this._getNextNode(node);
		}

		/**
		 * Loop through all paragraphs, and assign a score to them based on how content-y they look.
		 * Then add their score to their parent node.
		 *
		 * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
		 **/
		var candidates = [];
		this._forEachNode(elementsToScore, function(elementToScore) {
		    if (!elementToScore.parentNode || typeof(elementToScore.parentNode.tagName) === "undefined")
			return;

		    // If this paragraph is less than 25 characters, don't even count it.
		    var innerText = this._getInnerText(elementToScore);
		    if (innerText.length < 25)
			return;

		    // Exclude nodes with no ancestor.
		    var ancestors = this._getNodeAncestors(elementToScore, 3);
		    if (ancestors.length === 0)
			return;

		    var contentScore = 0;

		    // Add a point for the paragraph itself as a base.
		    contentScore += 1;

		    // Add points for any commas within this paragraph.
		    contentScore += innerText.split(",").length;

		    // For every 100 characters in this paragraph, add another point. Up to 3 points.
		    contentScore += Math.min(Math.floor(innerText.length / 100), 3);

		    // Initialize and score ancestors.
		    this._forEachNode(ancestors, function(ancestor, level) {
			if (!ancestor.tagName || !ancestor.parentNode || typeof(ancestor.parentNode.tagName) === "undefined")
			    return;

			if (typeof(ancestor.readability) === "undefined") {
			    this._initializeNode(ancestor);
			    candidates.push(ancestor);
			}

			// Node score divider:
			// - parent:             1 (no division)
			// - grandparent:        2
			// - great grandparent+: ancestor level * 3
			if (level === 0)
			    var scoreDivider = 1;
			else if (level === 1)
			    scoreDivider = 2;
			else
			    scoreDivider = level * 3;
			ancestor.readability.contentScore += contentScore / scoreDivider;
		    });
		});

		// After we've calculated scores, loop through all of the possible
		// candidate nodes we found and find the one with the highest score.
		var topCandidates = [];
		for (var c = 0, cl = candidates.length; c < cl; c += 1) {
		    var candidate = candidates[c];

		    // Scale the final candidates score based on link density. Good content
		    // should have a relatively small link density (5% or less) and be mostly
		    // unaffected by this operation.
		    var candidateScore = candidate.readability.contentScore * (1 - this._getLinkDensity(candidate));
		    candidate.readability.contentScore = candidateScore;

		    this.log("Candidate:", candidate, "with score " + candidateScore);

		    for (var t = 0; t < this._nbTopCandidates; t++) {
			var aTopCandidate = topCandidates[t];

			if (!aTopCandidate || candidateScore > aTopCandidate.readability.contentScore) {
			    topCandidates.splice(t, 0, candidate);
			    if (topCandidates.length > this._nbTopCandidates)
				topCandidates.pop();
			    break;
			}
		    }
		}

		var topCandidate = topCandidates[0] || null;
		var neededToCreateTopCandidate = false;
		var parentOfTopCandidate;

		// If we still have no top candidate, just use the body as a last resort.
		// We also have to copy the body node so it is something we can modify.
		if (topCandidate === null || topCandidate.tagName === "BODY") {
		    // Move all of the page's children into topCandidate
		    topCandidate = doc.createElement("DIV");
		    neededToCreateTopCandidate = true;
		    // Move everything (not just elements, also text nodes etc.) into the container
		    // so we even include text directly in the body:
		    var kids = page.childNodes;
		    while (kids.length) {
			this.log("Moving child out:", kids[0]);
			topCandidate.appendChild(kids[0]);
		    }

		    page.appendChild(topCandidate);

		    this._initializeNode(topCandidate);
		} else if (topCandidate) {
		    // Find a better top candidate node if it contains (at least three) nodes which belong to `topCandidates` array
		    // and whose scores are quite closed with current `topCandidate` node.
		    var alternativeCandidateAncestors = [];
		    for (var i = 1; i < topCandidates.length; i++) {
			if (topCandidates[i].readability.contentScore / topCandidate.readability.contentScore >= 0.75) {
			    alternativeCandidateAncestors.push(this._getNodeAncestors(topCandidates[i]));
			}
		    }
		    var MINIMUM_TOPCANDIDATES = 3;
		    if (alternativeCandidateAncestors.length >= MINIMUM_TOPCANDIDATES) {
			parentOfTopCandidate = topCandidate.parentNode;
			while (parentOfTopCandidate.tagName !== "BODY") {
			    var listsContainingThisAncestor = 0;
			    for (var ancestorIndex = 0; ancestorIndex < alternativeCandidateAncestors.length && listsContainingThisAncestor < MINIMUM_TOPCANDIDATES; ancestorIndex++) {
				listsContainingThisAncestor += Number(alternativeCandidateAncestors[ancestorIndex].includes(parentOfTopCandidate));
			    }
			    if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
				topCandidate = parentOfTopCandidate;
				break;
			    }
			    parentOfTopCandidate = parentOfTopCandidate.parentNode;
			}
		    }
		    if (!topCandidate.readability) {
			this._initializeNode(topCandidate);
		    }

		    // Because of our bonus system, parents of candidates might have scores
		    // themselves. They get half of the node. There won't be nodes with higher
		    // scores than our topCandidate, but if we see the score going *up* in the first
		    // few steps up the tree, that's a decent sign that there might be more content
		    // lurking in other places that we want to unify in. The sibling stuff
		    // below does some of that - but only if we've looked high enough up the DOM
		    // tree.
		    parentOfTopCandidate = topCandidate.parentNode;
		    var lastScore = topCandidate.readability.contentScore;
		    // The scores shouldn't get too low.
		    var scoreThreshold = lastScore / 3;
		    while (parentOfTopCandidate.tagName !== "BODY") {
			if (!parentOfTopCandidate.readability) {
			    parentOfTopCandidate = parentOfTopCandidate.parentNode;
			    continue;
			}
			var parentScore = parentOfTopCandidate.readability.contentScore;
			if (parentScore < scoreThreshold)
			    break;
			if (parentScore > lastScore) {
			    // Alright! We found a better parent to use.
			    topCandidate = parentOfTopCandidate;
			    break;
			}
			lastScore = parentOfTopCandidate.readability.contentScore;
			parentOfTopCandidate = parentOfTopCandidate.parentNode;
		    }

		    // If the top candidate is the only child, use parent instead. This will help sibling
		    // joining logic when adjacent content is actually located in parent's sibling node.
		    parentOfTopCandidate = topCandidate.parentNode;
		    while (parentOfTopCandidate.tagName != "BODY" && parentOfTopCandidate.children.length == 1) {
			topCandidate = parentOfTopCandidate;
			parentOfTopCandidate = topCandidate.parentNode;
		    }
		    if (!topCandidate.readability) {
			this._initializeNode(topCandidate);
		    }
		}

		// Now that we have the top candidate, look through its siblings for content
		// that might also be related. Things like preambles, content split by ads
		// that we removed, etc.
		var articleContent = doc.createElement("DIV");
		if (isPaging)
		    articleContent.id = "readability-content";

		var siblingScoreThreshold = Math.max(10, topCandidate.readability.contentScore * 0.2);
		// Keep potential top candidate's parent node to try to get text direction of it later.
		parentOfTopCandidate = topCandidate.parentNode;
		var siblings = parentOfTopCandidate.children;

		for (var s = 0, sl = siblings.length; s < sl; s++) {
		    var sibling = siblings[s];
		    var append = false;

		    this.log("Looking at sibling node:", sibling, sibling.readability ? ("with score " + sibling.readability.contentScore) : "");
		    this.log("Sibling has score", sibling.readability ? sibling.readability.contentScore : "Unknown");

		    if (sibling === topCandidate) {
			append = true;
		    } else {
			var contentBonus = 0;

			// Give a bonus if sibling nodes and top candidates have the example same classname
			if (sibling.className === topCandidate.className && topCandidate.className !== "")
			    contentBonus += topCandidate.readability.contentScore * 0.2;

			if (sibling.readability &&
			    ((sibling.readability.contentScore + contentBonus) >= siblingScoreThreshold)) {
			    append = true;
			} else if (sibling.nodeName === "P") {
			    var linkDensity = this._getLinkDensity(sibling);
			    var nodeContent = this._getInnerText(sibling);
			    var nodeLength = nodeContent.length;

			    if (nodeLength > 80 && linkDensity < 0.25) {
				append = true;
			    } else if (nodeLength < 80 && nodeLength > 0 && linkDensity === 0 &&
				       nodeContent.search(/\.( |$)/) !== -1) {
				append = true;
			    }
			}
		    }

		    if (append) {
			this.log("Appending node:", sibling);

			if (this.ALTER_TO_DIV_EXCEPTIONS.indexOf(sibling.nodeName) === -1) {
			    // We have a node that isn't a common block level element, like a form or td tag.
			    // Turn it into a div so it doesn't get filtered out later by accident.
			    this.log("Altering sibling:", sibling, "to div.");

			    sibling = this._setNodeTag(sibling, "DIV");
			}

			articleContent.appendChild(sibling);
			// siblings is a reference to the children array, and
			// sibling is removed from the array when we call appendChild().
			// As a result, we must revisit this index since the nodes
			// have been shifted.
			s -= 1;
			sl -= 1;
		    }
		}

		if (this._debug)
		    this.log("Article content pre-prep: " + articleContent.innerHTML);
		// So we have all of the content that we need. Now we clean it up for presentation.
		this._prepArticle(articleContent);
		if (this._debug)
		    this.log("Article content post-prep: " + articleContent.innerHTML);

		if (neededToCreateTopCandidate) {
		    // We already created a fake div thing, and there wouldn't have been any siblings left
		    // for the previous loop, so there's no point trying to create a new div, and then
		    // move all the children over. Just assign IDs and class names here. No need to append
		    // because that already happened anyway.
		    topCandidate.id = "readability-page-1";
		    topCandidate.className = "page";
		} else {
		    var div = doc.createElement("DIV");
		    div.id = "readability-page-1";
		    div.className = "page";
		    var children = articleContent.childNodes;
		    while (children.length) {
			div.appendChild(children[0]);
		    }
		    articleContent.appendChild(div);
		}

		if (this._debug)
		    this.log("Article content after paging: " + articleContent.innerHTML);

		var parseSuccessful = true;

		// Now that we've gone through the full algorithm, check to see if
		// we got any meaningful content. If we didn't, we may need to re-run
		// grabArticle with different flags set. This gives us a higher likelihood of
		// finding the content, and the sieve approach gives us a higher likelihood of
		// finding the -right- content.
		var textLength = this._getInnerText(articleContent, true).length;
		if (textLength < this._charThreshold) {
		    parseSuccessful = false;
		    page.innerHTML = pageCacheHtml;

		    if (this._flagIsActive(this.FLAG_STRIP_UNLIKELYS)) {
			this._removeFlag(this.FLAG_STRIP_UNLIKELYS);
			this._attempts.push({articleContent: articleContent, textLength: textLength});
		    } else if (this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) {
			this._removeFlag(this.FLAG_WEIGHT_CLASSES);
			this._attempts.push({articleContent: articleContent, textLength: textLength});
		    } else if (this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) {
			this._removeFlag(this.FLAG_CLEAN_CONDITIONALLY);
			this._attempts.push({articleContent: articleContent, textLength: textLength});
		    } else {
			this._attempts.push({articleContent: articleContent, textLength: textLength});
			// No luck after removing flags, just return the longest text we found during the different loops
			this._attempts.sort(function (a, b) {
			    return b.textLength - a.textLength;
			});

			// But first check if we actually have something
			if (!this._attempts[0].textLength) {
			    return null;
			}

			articleContent = this._attempts[0].articleContent;
			parseSuccessful = true;
		    }
		}

		if (parseSuccessful) {
		    // Find out text direction from ancestors of final top candidate.
		    var ancestors = [parentOfTopCandidate, topCandidate].concat(this._getNodeAncestors(parentOfTopCandidate));
		    this._someNode(ancestors, function(ancestor) {
			if (!ancestor.tagName)
			    return false;
			var articleDir = ancestor.getAttribute("dir");
			if (articleDir) {
			    this._articleDir = articleDir;
			    return true;
			}
			return false;
		    });
		    return articleContent;
		}
	    }
	},

	/**
	 * Check whether the input string could be a byline.
	 * This verifies that the input is a string, and that the length
	 * is less than 100 chars.
	 *
	 * @param possibleByline {string} - a string to check whether its a byline.
	 * @return Boolean - whether the input string is a byline.
	 */
	_isValidByline: function(byline) {
	    if (typeof byline == "string" || byline instanceof String) {
		byline = byline.trim();
		return (byline.length > 0) && (byline.length < 100);
	    }
	    return false;
	},

	/**
	 * Attempts to get excerpt and byline metadata for the article.
	 *
	 * @return Object with optional "excerpt" and "byline" properties
	 */
	_getArticleMetadata: function() {
	    var metadata = {};
	    var values = {};
	    var metaElements = this._doc.getElementsByTagName("meta");

	    // property is a space-separated list of values
	    var propertyPattern = /\s*(dc|dcterm|og|twitter)\s*:\s*(author|creator|description|title|site_name)\s*/gi;

	    // name is a single value
	    var namePattern = /^\s*(?:(dc|dcterm|og|twitter|weibo:(article|webpage))\s*[\.:]\s*)?(author|creator|description|title|site_name)\s*$/i;

	    // Find description tags.
	    this._forEachNode(metaElements, function(element) {
		var elementName = element.getAttribute("name");
		var elementProperty = element.getAttribute("property");
		var content = element.getAttribute("content");
		var matches = null;
		var name = null;

		if (elementProperty) {
		    matches = elementProperty.match(propertyPattern);
		    if (matches) {
			for (var i = matches.length - 1; i >= 0; i--) {
			    // Convert to lowercase, and remove any whitespace
			    // so we can match below.
			    name = matches[i].toLowerCase().replace(/\s/g, "");
			    // multiple authors
			    values[name] = content.trim();
			}
		    }
		}
		if (!matches && elementName && namePattern.test(elementName)) {
		    name = elementName;
		    if (content) {
			// Convert to lowercase, remove any whitespace, and convert dots
			// to colons so we can match below.
			name = name.toLowerCase().replace(/\s/g, "").replace(/\./g, ":");
			values[name] = content.trim();
		    }
		}
	    });

	    // get title
	    metadata.title = values["dc:title"] ||
                values["dcterm:title"] ||
                values["og:title"] ||
                values["weibo:article:title"] ||
                values["weibo:webpage:title"] ||
                values["title"] ||
                values["twitter:title"];

	    if (!metadata.title) {
		metadata.title = this._getArticleTitle();
	    }

	    // get author
	    metadata.byline = values["dc:creator"] ||
                values["dcterm:creator"] ||
                values["author"];

	    // get description
	    metadata.excerpt = values["dc:description"] ||
                values["dcterm:description"] ||
                values["og:description"] ||
                values["weibo:article:description"] ||
                values["weibo:webpage:description"] ||
                values["description"] ||
                values["twitter:description"];

	    // get site name
	    metadata.siteName = values["og:site_name"];

	    return metadata;
	},

	/**
	 * Removes script tags from the document.
	 *
	 * @param Element
	 **/
	_removeScripts: function(doc) {
	    this._removeNodes(doc.getElementsByTagName("script"), function(scriptNode) {
		scriptNode.nodeValue = "";
		scriptNode.removeAttribute("src");
		return true;
	    });
	    this._removeNodes(doc.getElementsByTagName("noscript"));
	},

	/**
	 * Check if this node has only whitespace and a single element with given tag
	 * Returns false if the DIV node contains non-empty text nodes
	 * or if it contains no element with given tag or more than 1 element.
	 *
	 * @param Element
	 * @param string tag of child element
	 **/
	_hasSingleTagInsideElement: function(element, tag) {
	    // There should be exactly 1 element child with given tag
	    if (element.children.length != 1 || element.children[0].tagName !== tag) {
		return false;
	    }

	    // And there should be no text nodes with real content
	    return !this._someNode(element.childNodes, function(node) {
		return node.nodeType === this.TEXT_NODE &&
		    this.REGEXPS.hasContent.test(node.textContent);
	    });
	},

	_isElementWithoutContent: function(node) {
	    return node.nodeType === this.ELEMENT_NODE &&
		node.textContent.trim().length == 0 &&
		(node.children.length == 0 ||
		 node.children.length == node.getElementsByTagName("br").length + node.getElementsByTagName("hr").length);
	},

	/**
	 * Determine whether element has any children block level elements.
	 *
	 * @param Element
	 */
	_hasChildBlockElement: function (element) {
	    return this._someNode(element.childNodes, function(node) {
		return this.DIV_TO_P_ELEMS.indexOf(node.tagName) !== -1 ||
		    this._hasChildBlockElement(node);
	    });
	},

	/***
	 * Determine if a node qualifies as phrasing content.
	 * https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/Content_categories#Phrasing_content
	 **/
	_isPhrasingContent: function(node) {
	    return node.nodeType === this.TEXT_NODE || this.PHRASING_ELEMS.indexOf(node.tagName) !== -1 ||
		((node.tagName === "A" || node.tagName === "DEL" || node.tagName === "INS") &&
		 this._everyNode(node.childNodes, this._isPhrasingContent));
	},

	_isWhitespace: function(node) {
	    return (node.nodeType === this.TEXT_NODE && node.textContent.trim().length === 0) ||
		(node.nodeType === this.ELEMENT_NODE && node.tagName === "BR");
	},

	/**
	 * Get the inner text of a node - cross browser compatibly.
	 * This also strips out any excess whitespace to be found.
	 *
	 * @param Element
	 * @param Boolean normalizeSpaces (default: true)
	 * @return string
	 **/
	_getInnerText: function(e, normalizeSpaces) {
	    normalizeSpaces = (typeof normalizeSpaces === "undefined") ? true : normalizeSpaces;
	    var textContent = e.textContent.trim();

	    if (normalizeSpaces) {
		return textContent.replace(this.REGEXPS.normalize, " ");
	    }
	    return textContent;
	},

	/**
	 * Get the number of times a string s appears in the node e.
	 *
	 * @param Element
	 * @param string - what to split on. Default is ","
	 * @return number (integer)
	 **/
	_getCharCount: function(e, s) {
	    s = s || ",";
	    return this._getInnerText(e).split(s).length - 1;
	},

	/**
	 * Remove the style attribute on every e and under.
	 * TODO: Test if getElementsByTagName(*) is faster.
	 *
	 * @param Element
	 * @return void
	 **/
	_cleanStyles: function(e) {
	    if (!e || e.tagName.toLowerCase() === "svg")
		return;

	    // Remove `style` and deprecated presentational attributes
	    for (var i = 0; i < this.PRESENTATIONAL_ATTRIBUTES.length; i++) {
		e.removeAttribute(this.PRESENTATIONAL_ATTRIBUTES[i]);
	    }

	    if (this.DEPRECATED_SIZE_ATTRIBUTE_ELEMS.indexOf(e.tagName) !== -1) {
		e.removeAttribute("width");
		e.removeAttribute("height");
	    }

	    var cur = e.firstElementChild;
	    while (cur !== null) {
		this._cleanStyles(cur);
		cur = cur.nextElementSibling;
	    }
	},

	/**
	 * Get the density of links as a percentage of the content
	 * This is the amount of text that is inside a link divided by the total text in the node.
	 *
	 * @param Element
	 * @return number (float)
	 **/
	_getLinkDensity: function(element) {
	    var textLength = this._getInnerText(element).length;
	    if (textLength === 0)
		return 0;

	    var linkLength = 0;

	    // XXX implement _reduceNodeList?
	    this._forEachNode(element.getElementsByTagName("a"), function(linkNode) {
		linkLength += this._getInnerText(linkNode).length;
	    });

	    return linkLength / textLength;
	},

	/**
	 * Get an elements class/id weight. Uses regular expressions to tell if this
	 * element looks good or bad.
	 *
	 * @param Element
	 * @return number (Integer)
	 **/
	_getClassWeight: function(e) {
	    if (!this._flagIsActive(this.FLAG_WEIGHT_CLASSES))
		return 0;

	    var weight = 0;

	    // Look for a special classname
	    if (typeof(e.className) === "string" && e.className !== "") {
		if (this.REGEXPS.negative.test(e.className))
		    weight -= 25;

		if (this.REGEXPS.positive.test(e.className))
		    weight += 25;
	    }

	    // Look for a special ID
	    if (typeof(e.id) === "string" && e.id !== "") {
		if (this.REGEXPS.negative.test(e.id))
		    weight -= 25;

		if (this.REGEXPS.positive.test(e.id))
		    weight += 25;
	    }

	    return weight;
	},

	/**
	 * Clean a node of all elements of type "tag".
	 * (Unless it's a youtube/vimeo video. People love movies.)
	 *
	 * @param Element
	 * @param string tag to clean
	 * @return void
	 **/
	_clean: function(e, tag) {
	    var isEmbed = ["object", "embed", "iframe"].indexOf(tag) !== -1;

	    this._removeNodes(e.getElementsByTagName(tag), function(element) {
		// Allow youtube and vimeo videos through as people usually want to see those.
		if (isEmbed) {
		    var attributeValues = [].map.call(element.attributes, function(attr) {
			return attr.value;
		    }).join("|");

		    // First, check the elements attributes to see if any of them contain youtube or vimeo
		    if (this.REGEXPS.videos.test(attributeValues))
			return false;

		    // Then check the elements inside this element for the same.
		    if (this.REGEXPS.videos.test(element.innerHTML))
			return false;
		}

		return true;
	    });
	},

	/**
	 * Check if a given node has one of its ancestor tag name matching the
	 * provided one.
	 * @param  HTMLElement node
	 * @param  String      tagName
	 * @param  Number      maxDepth
	 * @param  Function    filterFn a filter to invoke to determine whether this node 'counts'
	 * @return Boolean
	 */
	_hasAncestorTag: function(node, tagName, maxDepth, filterFn) {
	    maxDepth = maxDepth || 3;
	    tagName = tagName.toUpperCase();
	    var depth = 0;
	    while (node.parentNode) {
		if (maxDepth > 0 && depth > maxDepth)
		    return false;
		if (node.parentNode.tagName === tagName && (!filterFn || filterFn(node.parentNode)))
		    return true;
		node = node.parentNode;
		depth++;
	    }
	    return false;
	},

	/**
	 * Return an object indicating how many rows and columns this table has.
	 */
	_getRowAndColumnCount: function(table) {
	    var rows = 0;
	    var columns = 0;
	    var trs = table.getElementsByTagName("tr");
	    for (var i = 0; i < trs.length; i++) {
		var rowspan = trs[i].getAttribute("rowspan") || 0;
		if (rowspan) {
		    rowspan = parseInt(rowspan, 10);
		}
		rows += (rowspan || 1);

		// Now look for column-related info
		var columnsInThisRow = 0;
		var cells = trs[i].getElementsByTagName("td");
		for (var j = 0; j < cells.length; j++) {
		    var colspan = cells[j].getAttribute("colspan") || 0;
		    if (colspan) {
			colspan = parseInt(colspan, 10);
		    }
		    columnsInThisRow += (colspan || 1);
		}
		columns = Math.max(columns, columnsInThisRow);
	    }
	    return {rows: rows, columns: columns};
	},

	/**
	 * Look for 'data' (as opposed to 'layout') tables, for which we use
	 * similar checks as
	 * https://dxr.mozilla.org/mozilla-central/rev/71224049c0b52ab190564d3ea0eab089a159a4cf/accessible/html/HTMLTableAccessible.cpp#920
	 */
	_markDataTables: function(root) {
	    var tables = root.getElementsByTagName("table");
	    for (var i = 0; i < tables.length; i++) {
		var table = tables[i];
		var role = table.getAttribute("role");
		if (role == "presentation") {
		    table._readabilityDataTable = false;
		    continue;
		}
		var datatable = table.getAttribute("datatable");
		if (datatable == "0") {
		    table._readabilityDataTable = false;
		    continue;
		}
		var summary = table.getAttribute("summary");
		if (summary) {
		    table._readabilityDataTable = true;
		    continue;
		}

		var caption = table.getElementsByTagName("caption")[0];
		if (caption && caption.childNodes.length > 0) {
		    table._readabilityDataTable = true;
		    continue;
		}

		// If the table has a descendant with any of these tags, consider a data table:
		var dataTableDescendants = ["col", "colgroup", "tfoot", "thead", "th"];
		var descendantExists = function(tag) {
		    return !!table.getElementsByTagName(tag)[0];
		};
		if (dataTableDescendants.some(descendantExists)) {
		    this.log("Data table because found data-y descendant");
		    table._readabilityDataTable = true;
		    continue;
		}

		// Nested tables indicate a layout table:
		if (table.getElementsByTagName("table")[0]) {
		    table._readabilityDataTable = false;
		    continue;
		}

		var sizeInfo = this._getRowAndColumnCount(table);
		if (sizeInfo.rows >= 10 || sizeInfo.columns > 4) {
		    table._readabilityDataTable = true;
		    continue;
		}
		// Now just go by size entirely:
		table._readabilityDataTable = sizeInfo.rows * sizeInfo.columns > 10;
	    }
	},

	/**
	 * Clean an element of all tags of type "tag" if they look fishy.
	 * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
	 *
	 * @return void
	 **/
	_cleanConditionally: function(e, tag) {
	    if (!this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY))
		return;

	    var isList = tag === "ul" || tag === "ol";

	    // Gather counts for other typical elements embedded within.
	    // Traverse backwards so we can remove nodes at the same time
	    // without effecting the traversal.
	    //
	    // TODO: Consider taking into account original contentScore here.
	    this._removeNodes(e.getElementsByTagName(tag), function(node) {
		// First check if we're in a data table, in which case don't remove us.
		var isDataTable = function(t) {
		    return t._readabilityDataTable;
		};

		if (this._hasAncestorTag(node, "table", -1, isDataTable)) {
		    return false;
		}

		var weight = this._getClassWeight(node);
		var contentScore = 0;

		this.log("Cleaning Conditionally", node);

		if (weight + contentScore < 0) {
		    return true;
		}

		if (this._getCharCount(node, ",") < 10) {
		    // If there are not very many commas, and the number of
		    // non-paragraph elements is more than paragraphs or other
		    // ominous signs, remove the element.
		    var p = node.getElementsByTagName("p").length;
		    var img = node.getElementsByTagName("img").length;
		    var li = node.getElementsByTagName("li").length - 100;
		    var input = node.getElementsByTagName("input").length;

		    var embedCount = 0;
		    var embeds = node.getElementsByTagName("embed");
		    for (var ei = 0, il = embeds.length; ei < il; ei += 1) {
			if (!this.REGEXPS.videos.test(embeds[ei].src))
			    embedCount += 1;
		    }

		    var linkDensity = this._getLinkDensity(node);
		    var contentLength = this._getInnerText(node).length;

		    var haveToRemove =
			(img > 1 && p / img < 0.5 && !this._hasAncestorTag(node, "figure")) ||
			(!isList && li > p) ||
			(input > Math.floor(p/3)) ||
			(!isList && contentLength < 25 && (img === 0 || img > 2) && !this._hasAncestorTag(node, "figure")) ||
			(!isList && weight < 25 && linkDensity > 0.2) ||
			(weight >= 25 && linkDensity > 0.5) ||
			((embedCount === 1 && contentLength < 75) || embedCount > 1);
		    return haveToRemove;
		}
		return false;
	    });
	},

	/**
	 * Clean out elements whose id/class combinations match specific string.
	 *
	 * @param Element
	 * @param RegExp match id/class combination.
	 * @return void
	 **/
	_cleanMatchedNodes: function(e, regex) {
	    var endOfSearchMarkerNode = this._getNextNode(e, true);
	    var next = this._getNextNode(e);
	    while (next && next != endOfSearchMarkerNode) {
		if (regex.test(next.className + " " + next.id)) {
		    next = this._removeAndGetNext(next);
		} else {
		    next = this._getNextNode(next);
		}
	    }
	},

	/**
	 * Clean out spurious headers from an Element. Checks things like classnames and link density.
	 *
	 * @param Element
	 * @return void
	 **/
	_cleanHeaders: function(e) {
	    for (var headerIndex = 1; headerIndex < 3; headerIndex += 1) {
		this._removeNodes(e.getElementsByTagName("h" + headerIndex), function (header) {
		    return this._getClassWeight(header) < 0;
		});
	    }
	},

	_flagIsActive: function(flag) {
	    return (this._flags & flag) > 0;
	},

	_removeFlag: function(flag) {
	    this._flags = this._flags & ~flag;
	},

	_isProbablyVisible: function(node) {
	    return (!node.style || node.style.display != "none") && !node.hasAttribute("hidden");
	},

	/**
	 * Runs readability.
	 *
	 * Workflow:
	 *  1. Prep the document by removing script tags, css, etc.
	 *  2. Build readability's DOM tree.
	 *  3. Grab the article content from the current dom tree.
	 *  4. Replace the current DOM tree with the new one.
	 *  5. Read peacefully.
	 *
	 * @return void
	 **/
	parse: function () {
	    // Avoid parsing too large documents, as per configuration option
	    if (this._maxElemsToParse > 0) {
		var numTags = this._doc.getElementsByTagName("*").length;
		if (numTags > this._maxElemsToParse) {
		    throw new Error("Aborting parsing document; " + numTags + " elements found");
		}
	    }

	    // Remove script tags from the document.
	    this._removeScripts(this._doc);

	    this._prepDocument();

	    var metadata = this._getArticleMetadata();
	    this._articleTitle = metadata.title;

	    var articleContent = this._grabArticle();
	    if (!articleContent)
		return null;

	    this.log("Grabbed: " + articleContent.innerHTML);

	    this._postProcessContent(articleContent);

	    // If we haven't found an excerpt in the article's metadata, use the article's
	    // first paragraph as the excerpt. This is used for displaying a preview of
	    // the article's content.
	    if (!metadata.excerpt) {
		var paragraphs = articleContent.getElementsByTagName("p");
		if (paragraphs.length > 0) {
		    metadata.excerpt = paragraphs[0].textContent.trim();
		}
	    }

	    var textContent = articleContent.textContent;
	    return {
		title: this._articleTitle,
		byline: metadata.byline || this._articleByline,
		dir: this._articleDir,
		content: articleContent.innerHTML,
		textContent: textContent,
		length: textContent.length,
		excerpt: metadata.excerpt,
		siteName: metadata.siteName || this._articleSiteName
	    };
	}
    };
    return new Readability(doc).parse();
}

/* Direct eval returns this API. The two-line loader deliberately lets syntax,
 * importer and DOM errors propagate with their original message/line number. */
({version:LEGADO_SHARED_RUNTIME,TT:TT,TJ:TJ,TC:TC,TH:TH,
  ltPrepareImages:ltPrepareImages,ltExtract:ltExtract,ltUseHtmlBlocks:ltUseHtmlBlocks,
  setTargetLang:_ltSetTargetLang,setRenderMode:_ltSetRenderMode,login:_ltLogin,loginUi:_ltLoginUi,open:_ltOpen,
  challenge:_ltChallenge,check:_ltCheck,clean:_ltClean,finish:_ltFinish,resolveRequest:_ltResolveRequest,networkError:_ltNetworkError,serviceJson:_ltServiceJson,wirisSvg:_ltWirisSvg,webClean:_ltWebClean});
