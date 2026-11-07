import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import io.legado.app.model.analyzeRule.RuleAnalyzer;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import io.legado.app.utils.HtmlFormatter;
import io.legado.app.utils.NetworkUtils;

/** Real engine/DOM/parser; importScript is stubbed, not a phone network test. */
public final class SharedCommonRuntime {
    private final Object context, scope;
    private final Method evaluate, put;
    private int checks, compiledScripts;
    private SharedCommonRuntime(String engine) throws Exception {
        Class<?> cx = Class.forName(engine + ".Context");
        context = cx.getMethod("enter").invoke(null);
        cx.getMethod("setOptimizationLevel", int.class).invoke(context, -1);
        scope = cx.getMethod("initStandardObjects").invoke(context);
        evaluate = compatible(cx, "evaluateString", String.class, String.class, int.class, Object.class);
        put = compatible(Class.forName(engine + ".ScriptableObject"), "putProperty", String.class, Object.class);
        // Rhino installs all top-level Java package aliases when the first
        // package is accessed. Do this before injecting the app's `java`
        // helper, or a site's `Jsoup = org.jsoup.Jsoup` would replace our stub
        // with the java.* package. That is a harness initialization artifact.
        eval("void org.jsoup.Jsoup;");
    }
    private Method compatible(Class<?> owner, String name, Class<?>... rest) throws Exception {
        for (Method method : owner.getMethods()) {
            Class<?>[] types = method.getParameterTypes();
            if (!method.getName().equals(name) || types.length != rest.length + 1 || !types[0].isInstance(scope)) continue;
            boolean match = true;
            for (int i = 0; i < rest.length; i++) match &= types[i + 1].equals(rest[i]);
            if (match) return method;
        }
        throw new NoSuchMethodException(name);
    }
    private Object eval(String code) {
        try { return evaluate.invoke(context, scope, code, "shared-common-test", 1, null); }
        catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new RuntimeException(cause);
        } catch (ReflectiveOperationException error) { throw new RuntimeException(error); }
    }
    private void bind(String key, String value) throws Exception { put.invoke(null, scope, key, value); }
    private void check(boolean condition, String description) { checks++; if (!condition) throw new AssertionError(description); }
    private String expand(String value, List<String> expressions) {
        return new RuleAnalyzer(value, false).innerRule("{{", "}}", code -> {
            expressions.add(code); return String.valueOf(eval(code));
        });
    }
    private static String read(String name) throws Exception { return new String(Files.readAllBytes(Paths.get(name)), StandardCharsets.UTF_8); }
    private void loader(String common, String loader, String selector) throws Exception {
        bind("__commonText", common);
        eval("var extract_selector=['" + selector + "'];var formula_mode='none';var formula_selector='';" + loader);
        eval("var imports=0;var cc={get:function(){return null;},put:function(){}};"
            + "function caller(lang){return {importScript:function(){imports++;return String(__commonText);},"
            + "get:function(k){return k==='TARGET_LANG'?lang:null;},log:function(){},"
            + "ajaxAll:function(urls){var out=[];for(var i=0;i<urls.length;i++){var url=String(urls[i]);"
            + "var options=JSON.parse(url.slice(url.indexOf(',')+1));var values=JSON.parse(options.body);var res=[];"
            + "for(var n=0;n<values.length;n++)res.push({translations:[{text:values[n].replace(/(<\\|L\\d+\\|>\\n)/g,'$1'+lang+':')}]});"
            + "out.push(JSON.stringify(res));}return out;}};}var first=caller('zh');var second=caller('fr');");
        check(Boolean.TRUE.equals(eval("typeof commonJs==='undefined'&&imports===0")), "no eager import at library initialization");
        check("zh:Hello".equals(String.valueOf(eval("common(first).TT('Hello',first,cc)"))), "common API translates with first caller");
        check("fr:World".equals(String.valueOf(eval("common(second).TT('World',second,cc)"))), "API does not capture first caller");
        check(Boolean.TRUE.equals(eval("JSON.parse(common(second).TJ('{\"name\":\"Book\",\"href\":\"https://example.test/x\"}',second,cc)).href==='https://example.test/x'")), "TJ preserves URL");
        String untouched = String.valueOf(eval("common(second).TH('<p><strong>A</strong><em>B</em></p>',second,cc)"));
        check(Jsoup.parseBodyFragment(untouched).select("strong,em").size()==2,"common does not implicitly capture the source selector");
        String html = String.valueOf(eval("common(second).TH('<p><strong>A</strong><em>B</em></p>',second,cc,{extract_selector:extract_selector})"));
        String other = selector.equals("strong") ? "em" : "strong";
        Document dom = Jsoup.parseBodyFragment(html);
        check(dom.select(selector).size() == 0 && dom.select(other).size() == 1, "explicit options select only the current source's DOM");
        check(Boolean.TRUE.equals(eval("imports===1")), "repeated successful use imports once");
        check("3".equals(String.valueOf(eval("commonJs.version"))), "published v3 API loaded");
    }
    private void encoding(String legacy, String common, String capture) throws Exception {
        eval(legacy);
        String formula = "{{d\\mathrm{snr}\n}}";
        if (capture != null) {
            bind("__capture", capture);
            String article = String.valueOf(eval("JSON.parse(String(__capture)).body"));
            for (org.jsoup.nodes.Element el : Jsoup.parseBodyFragment(article).select("tex-math")) {
                if (el.wholeText().replaceAll("\\s+", "").contains("{{d\\mathrm{snr}")) { formula = el.wholeText(); break; }
            }
            check(!formula.equals("{{d\\mathrm{snr}\n}}"), "actual article formula located");
        }
        bind("__formula", formula);
        String old = String.valueOf(eval("_ltUrl('zh-Hans',[String(__formula)])"));
        boolean failed = false;
        try { expand(old, new ArrayList<>()); } catch (RuntimeException expected) { failed = true; }
        check(failed, "legacy serializer reproduces formula parsing failure");
        eval(common);
        String safe = String.valueOf(eval("_ltUrl('zh-Hans',[String(__formula)])"));
        List<String> expressions = new ArrayList<>();
        check(expand(safe, expressions).equals(safe) && expressions.isEmpty(), "new serializer never dispatches formula as JavaScript");
        bind("__safe", safe);
        check(Boolean.TRUE.equals(eval("JSON.parse(JSON.parse(String(__safe).slice(String(__safe).indexOf(',')+1)).body)[0]===String(__formula)")), "raw formula and line breaks round trip exactly");
        String alias = String.valueOf(eval("_ltFormulaSvgUrl(String(__formula))"));
        bind("__alias", alias);
        check(alias.contains("/svg.latex.svg?"), "export-facing SVG suffix");
        check(Boolean.TRUE.equals(eval("var at=String(__alias).indexOf(',{');var result=String(__alias).slice(0,at);var opt=JSON.parse(String(__alias).slice(at+1));eval(opt.js)===('https://latex.codecogs.com/svg.latex?'+encodeURIComponent(String(__formula)))")), "request alias restores exact endpoint and TeX");
        String html = "<h1>learn snr \\mathrm{snr}</h1><p>before <img src=\"https://example.test/formula.svg\"> after</p><blockquote><img src=\"https://example.test/x.svg\"></blockquote><p>LDUHM0LDUHE</p>";
        bind("__html", html);
        String output = String.valueOf(eval("ltUseHtmlBlocks(String(__html))"));
        Document doc = Jsoup.parseBodyFragment(output);
        check(doc.select("usehtml h1").size() == 1, "headings retain semantic HTML");
        check(doc.select("usehtml img").isEmpty(), "images never enter HTML width-limited path");
        check(doc.select("h1").first().text().equals("learn snr \\mathrm{snr}"), "heading text/backslashes preserved");
        check(doc.select("p").last().text().equals("LDUHM0LDUHE"), "user text cannot collide with placeholder markers");
        check(doc.select("img").size() == 2, "image count unchanged");
        check(output.contains("\n<usehtml>") && !output.contains("\\n<usehtml>"), "real newlines rather than literal escapes");
    }
    private void imagesAndExtraction() throws Exception {
        String base = "http://example.test/journal/2026/chapter.html,{\"webView\":true}";
        String html = "<p>BEFORE<img src='//cdn.example.test/a.svg'>AFTER</p>"
            + "<img src='/assets/root.svg?sig=a%2Fb&amp;n=1+2'>"
            + "<img src='figures/relative.svg'><img src='../parent.svg'>"
            + "<img src='thumbnail.svg' data-src='../lazy.svg'>"
            + "<img src='small.svg' srcset='large.svg 2x, small.svg 1x'>"
            + "<picture><source data-srcset='low.svg 1x, ../picture.svg 2x'><img src='placeholder.gif'></picture>"
            + "<a href='../anchor.svg'><img src='thumb.svg' loading='lazy'></a>"
            + "<img src='https://signed.example.test/a.svg?sig=a%2Fb+1&amp;expire=23'>"
            + "<img src='data:image/png;base64,aGVsbG8='>";
        bind("__imageHtml", html); bind("__imageBase", base);
        eval("var imageDoc=org.jsoup.Jsoup.parseBodyFragment(String(__imageHtml));"
            + "var rawOptions=JSON.stringify({js:'String(result)',headers:{'X-Sign':String(__formula)}});"
            + "var signedRelative='images/signed.svg?sig=a%2Fb+1&expiry=23,'+rawOptions;"
            + "imageDoc.body().appendElement('img').attr('src',signedRelative).attr('alt',String(__formula));"
            + "var codecogs=_ltFormulaSvgUrl(String(__formula));imageDoc.body().appendElement('img').attr('src',codecogs);"
            + "var imageOptions={image_anchor_mode:'href',image_anchor_options:{webView:true}};");
        check(Boolean.TRUE.equals(eval("ltPrepareImages(imageDoc,null,imageOptions)===imageDoc")), "image-only helper preserves DOM identity and metadata");
        Document doc = Jsoup.parseBodyFragment(String.valueOf(eval("String(imageDoc.body().html())")));
        String[] urls = {
            "//cdn.example.test/a.svg",
            "/assets/root.svg?sig=a%2Fb&n=1+2",
            "figures/relative.svg",
            "../parent.svg",
            "../lazy.svg",
            "large.svg",
            "../picture.svg",
            "../anchor.svg,{\"webView\":true}",
            "https://signed.example.test/a.svg?sig=a%2Fb+1&expire=23",
            "data:image/png;base64,aGVsbG8="
        };
        check(doc.select("img").size() == 12, "all images keep their positions/count");
        for (int i=0;i<urls.length;i++) check(doc.select("img").get(i).attr("src").equals(urls[i]), "image URI case " + i);
        String paragraph = doc.select("p").first().html();
        check(paragraph.indexOf("BEFORE") < paragraph.indexOf("<img") && paragraph.indexOf("<img") < paragraph.indexOf("AFTER"), "image remains between its surrounding text");
        check(Boolean.TRUE.equals(eval("String(imageDoc.select('img').get(10).attr('src'))===signedRelative")), "relative signed URL retains exact query and request-options suffix");
        check(Boolean.TRUE.equals(eval("String(imageDoc.select('img').get(10).attr('alt'))===String(__formula)")), "TeX/backslashes in alt remain literal");
        check(Boolean.TRUE.equals(eval("String(imageDoc.select('img').get(11).attr('src'))===codecogs")), "CodeCogs SVG alias and options are not rewritten");
        check(doc.select("img[data-src],img[srcset]").isEmpty(), "cleanup happens only after selecting real image URLs");
        String formatted=HtmlFormatter.INSTANCE.formatKeepImg(String.valueOf(eval("String(imageDoc.body().html())")),new java.net.URL("http://example.test/journal/2026/chapter.html"));
        Document nativeDoc=Jsoup.parseBodyFragment(formatted);
        String[] absolute={"http://cdn.example.test/a.svg","http://example.test/assets/root.svg?sig=a%2Fb&n=1+2",
            "http://example.test/journal/2026/figures/relative.svg","http://example.test/journal/parent.svg",
            "http://example.test/journal/lazy.svg","http://example.test/journal/2026/large.svg",
            "http://example.test/journal/picture.svg","http://example.test/journal/anchor.svg,{\"webView\":true}",urls[8],urls[9]};
        for(int i=0;i<absolute.length;i++)check(nativeDoc.select("img").get(i).attr("src").equals(absolute[i]),"actual HtmlFormatter + native NetworkUtils resolve image case "+i);
        check(nativeDoc.select("img").get(10).attr("src").startsWith("http://example.test/journal/2026/images/signed.svg?sig=a%2Fb+1&expiry=23,"),"native formatter preserves signed query/options");
        bind("__extractHtml", "<usehtml><h1>Heading</h1><p>A<b>B</b><img src='../x.svg'>C</p></usehtml><inline-formula><tex-math>d\\mathrm{snr}</tex-math></inline-formula>");
        String extracted = String.valueOf(eval("ltExtract(String(__extractHtml),null,['usehtml','inline-formula tex-math'])"));
        Document ex = Jsoup.parseBodyFragment(extracted);
        check(ex.select("usehtml").isEmpty(), "usehtml extraction unwraps protection tag");
        check(ex.select("h1,b,img").size() == 3, "HTML extraction preserves structure and images");
        check(ex.select("tex-math").isEmpty() && ex.select("inline-formula").text().equals("d\\mathrm{snr}"), "ordinary TeX extraction stays text-only");
        bind("__repeatHtml", "<usehtml><h1>literal $& $1 d\\mathrm{snr}</h1><p>BEFORE<img src='../repeat.svg'>AFTER</p></usehtml><blockquote><h2>Nested heading</h2>Quote</blockquote>");
        String first = String.valueOf(eval("var firstHtml=ltUseHtmlBlocks(String(__repeatHtml),null);firstHtml"));
        String second = String.valueOf(eval("ltUseHtmlBlocks(firstHtml,null)"));
        Document one = Jsoup.parseBodyFragment(first), two = Jsoup.parseBodyFragment(second);
        check(one.select("usehtml img,usehtml usehtml").isEmpty() && two.select("usehtml img,usehtml usehtml").isEmpty(), "repeated HTML processing never nests protection tags or images");
        check(one.select("usehtml").size() == two.select("usehtml").size(), "repeat preserves block count");
        check(one.select("h1").text().equals("literal $& $1 d\\mathrm{snr}"), "replacement tokens and TeX text are literal");
        check(one.select("img").first().attr("src").equals("../repeat.svg"), "HTML helper leaves image resolution to native formatter");
        check(one.select("p").text().equals(two.select("p").text()), "repeat preserves surrounding prose");
    }
    private void allLibraries(String common, String canonical, String engine) throws Exception {
        bind("__allSources", canonical);
        int total=((Number)eval("JSON.parse(String(__allSources)).length")).intValue();
        check(total >= 108, "complete canonical inventory required");
        for(int i=0;i<total;i++){
            String lib=String.valueOf(eval("JSON.parse(String(__allSources))["+i+"].jsLib"));
            String id=String.valueOf(eval("JSON.parse(String(__allSources))["+i+"].bookSourceUrl"));
            SharedCommonRuntime one=new SharedCommonRuntime(engine);
            one.bind("__commonText",common);
            one.eval("var imports=0;var java={importScript:function(){imports++;return String(__commonText);},"
                + "get:function(){return '';},put:function(){},log:function(){}};"
                + "var cache={get:function(){return null;},put:function(){}};"
                + "var source={getLoginInfoMap:function(){return {get:function(){return '';}};},getVariable:function(){return '';},getKey:function(){return 'fixture';}};");
            try {
                one.eval(lib);
                check(Boolean.TRUE.equals(one.eval("imports===0&&typeof commonJs==='undefined'")), "source "+i+" initializes lazily in actual Rhino");
                String html=String.valueOf(one.eval("common(java).ltPrepareImages('<p><img src=\"../image.svg\"></p>',java)"));
                check(Jsoup.parseBodyFragment(html).select("img").attr("src").equals("../image.svg"), "source "+i+" can call common image API");
                check(Boolean.TRUE.equals(one.eval("imports===1&&commonJs.version==='3'")), "source "+i+" uses pinned common");
                check(Boolean.TRUE.equals(one.eval("typeof java.importScript==='function'")), "source "+i+" keeps the app's injected java helper");
            } catch (RuntimeException | AssertionError error) {
                throw new AssertionError("source "+i+" ("+id+") failed: "+error.getMessage(),error);
            }
            one.bind("__source",String.valueOf(eval("JSON.stringify(JSON.parse(String(__allSources))["+i+"])")));
            one.eval("var fixture=JSON.parse(String(__source));var scripts=[];"
                + "function collect(o,p){for(var k in o){var v=o[k],f=p+'.'+k;if(v&&typeof v==='object'){collect(v,f);continue;}if(typeof v!=='string'||!v)continue;"
                + "if(k==='jsLib'||k==='bookSourceComment')continue;"
                + "if(k==='loginCheckJs'||k==='webJs'){scripts.push({field:f,code:v});continue;}"
                + "if(k==='loginUrl'&&!/^https?:/.test(v)){scripts.push({field:f,code:v.replace(/^\\s*(?:<js>|@js:)/,'').replace(/<\\/js>\\s*$/,'')});continue;}"
                + "if(v.indexOf('@js:')===0){scripts.push({field:f,code:v.substring(4)});continue;}var re=/<js>([\\s\\S]*?)<\\/js>/gi,m;while((m=re.exec(v)))scripts.push({field:f,code:m[1]});}}collect(fixture,'source');"
                + "if(fixture.loginUi&&fixture.loginUi.indexOf('@js:')===0){var rows=JSON.parse(eval(fixture.loginUi.substring(4)));for(var r=0;r<rows.length;r++)if(rows[r].action)scripts.push({field:'loginUi.action.'+r,code:rows[r].action});}");
            int count=((Number)one.eval("scripts.length")).intValue();
            Method compile=Class.forName(engine+".Context").getMethod("compileString",String.class,String.class,int.class,Object.class);
            for(int n=0;n<count;n++){
                String code=String.valueOf(one.eval("scripts["+n+"].code.replace(/\\{\\{[\\s\\S]*?\\}\\}/g,'1')"));
                String field=String.valueOf(one.eval("scripts["+n+"].field"));
                try{compile.invoke(one.context,code,"source-"+i+"-"+field,1,null);compiledScripts++;check(true,"source "+i+" "+field+" actual Rhino compilation");}
                catch(InvocationTargetException error){throw new AssertionError("source "+i+" "+field+" syntax failed",error.getCause());}
            }
        }
    }
    private void readableAndFormulas() throws Exception {
        String paragraph="Readable main text, with punctuation; preserve scientific words and the original article paragraphs. ".repeat(5);
        String article="<article class='article-body'><h1>Readable title</h1><p>"+paragraph+"x \\neq y and d\\mathrm{snr}</p><div class='social-share'>NOISE</div></article>";
        bind("__readable", "<html><body><nav>NAVIGATION</nav>"+article+"</body></html>");
        Document ssr=Jsoup.parseBodyFragment(String.valueOf(eval("String(_ltReadableDocument(org.jsoup.Jsoup.parse(String(__readable)),['nav']).body().html())")));
        check(ssr.select("h1").text().equals("Readable title"),"Jsoup readability retains semantic title");
        check(!ssr.text().contains("NOISE")&&!ssr.text().contains("NAVIGATION"),"Jsoup readability removes site-independent noise");
        bind("__rscArticle",article);
        String rsc=String.valueOf(eval("'<next-route-announcer></next-route-announcer><script>self.__next_f.push([1,'+JSON.stringify(String(__rscArticle))+']);</script>'"));
        bind("__rscPage",rsc);
        Document restored=Jsoup.parseBodyFragment(String.valueOf(eval("String(_ltReadableDocument(org.jsoup.Jsoup.parse(String(__rscPage)),['script']).body().html())")));
        check(restored.select("h1").text().equals("Readable title"),"Next.js payload is captured before scripts are removed");
        check(restored.text().contains("x \\neq y and d\\mathrm{snr}"),"Next.js recovery preserves TeX and does not create false newlines");
        eval("var wirisPayload='';var wj={ajaxAll:function(urls){var u=String(urls[0]);var o=JSON.parse(u.slice(u.indexOf(',')+1));wirisPayload=decodeURIComponent(o.body.substring(4));return ['<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>'];},base64Encode:function(s){return String(Packages.java.util.Base64.getEncoder().encodeToString(new Packages.java.lang.String(s).getBytes('UTF-8')));},get:function(){return 'en';},log:function(){}};");
        bind("__math", "<span class='formula' data-semantic-speech='x'><math xmlns='http://www.w3.org/1998/Math/MathML'><mi>x</mi></math></span>");
        Document formula=Jsoup.parseBodyFragment(String.valueOf(eval("var fd=org.jsoup.Jsoup.parseBodyFragment(String(__math));_ltWiris(fd,'span.formula',wj);String(fd.body().html())")));
        check(formula.select("img[src]").size()==1&&formula.select("img").attr("src").startsWith("data:image/svg+xml;base64,"),"shared WIRIS returns SVG data without rasterizing formulas");
        check(String.valueOf(eval("wirisPayload")).startsWith("<math")&&!String.valueOf(eval("wirisPayload")).contains("<span"),"WIRIS receives actual MathML, not an HTML wrapper");
        check(formula.select(".formula-speech.notranslate").text().equals("x"),"shared WIRIS preserves the speech label");
        eval("var invalidSelector=false;try{TH('<p>text</p>',first,cc,{remove_selector:['[']});}catch(e){invalidSelector=true;}");
        check(Boolean.TRUE.equals(eval("invalidSelector")),"bad CSS selectors surface instead of becoming empty content");
    }
    private void serviceJson() throws Exception {
        check(Boolean.TRUE.equals(eval("_ltServiceJson('{\"title\":\"article\"}').title==='article'")),"service JSON preserves valid response data");
        check(Boolean.TRUE.equals(eval("_ltServiceJson('<html>blocked</html>')===null")),"malformed external JSON is a service fallback");
        for(String kind:new String[]{"SyntaxError","TypeError"}){
            check(Boolean.TRUE.equals(eval("(function(){var original=new "+kind+"('conversion bug');try{_ltServiceJson({toString:function(){throw original;}});}catch(e){return e===original;}return false;})()")),"service JSON preserves original caller "+kind);
        }
        for(String value:new String[]{"null","undefined"}){
            check(Boolean.TRUE.equals(eval("(function(){var original="+value+";try{_ltNetworkError(original,null);}catch(e){return e===original;}return false;})()")),"network guard keeps literal "+value);
        }
    }
    private void nativeSourceOutputs() throws Exception {
        eval("var nativeSources=JSON.parse(String(__allSources)),heroRule='',coverRule='';"
            +"for(var i=0;i<nativeSources.length;i++){var s=nativeSources[i];if(s.bookSourceName==='Carnegie Mosco')heroRule=s.ruleContent.content;if(s.bookSourceName==='中国社会科学期刊')coverRule=s.ruleBookInfo.coverUrl;}"
            +"heroRule=heroRule.match(/<js>([\\s\\S]*?)<\\/js>/)[1];coverRule=coverRule.match(/<js>([\\s\\S]*?)<\\/js>/)[1];"
            +"var java={},cache={get:function(){return null;},put:function(){}};function common(){return {challenge:function(){return false;},finish:function(doc){return String(doc.body().html());}};}");
        String base="http://carnegie.ru/chapters/current/page.html";
        bind("baseUrl",base);
        bind("result","<div class='article-body'><div class='zone-title background-cover' style='background-image:url(../hero.svg)'>Hero</div><p>Article text</p></div>");
        Document hero=Jsoup.parseBodyFragment(String.valueOf(eval("eval(heroRule);result")));
        check(hero.select("img").attr("src").equals("../hero.svg"),"source hero output stays relative");
        check(Jsoup.parseBodyFragment(HtmlFormatter.INSTANCE.formatKeepImg(hero.body().html(),new java.net.URL(base))).select("img").attr("src").equals("http://carnegie.ru/chapters/hero.svg"),"native formatter resolves the same-page hero");
        base="https://www.cssn.cn/dkzgxp/topic/page.html";
        String[] relative={"//cdn.example.test/cover.svg","/assets/cover.svg","covers/cover.svg?sig=a%2Fb+1"};
        String[] absolute={"https://cdn.example.test/cover.svg","https://www.cssn.cn/assets/cover.svg","https://www.cssn.cn/dkzgxp/topic/covers/cover.svg?sig=a%2Fb+1"};
        bind("baseUrl",base);
        for(int i=0;i<relative.length;i++){
            bind("result","<div class='list_text_left'><div class='list_img'><img data-src='"+relative[i]+"' src='placeholder.svg'></div></div>");
            String raw=String.valueOf(eval("eval(coverRule);result"));
            check(raw.equals(relative[i]),"source cover raw case "+i);
            check(NetworkUtils.INSTANCE.getAbsoluteURL(base,raw).equals(absolute[i]),"native BookInfo URL method resolves cover case "+i);
        }
    }
    public static void main(String[] args) throws Exception {
        if (args.length < 5 || args.length > 6) throw new IllegalArgumentException("legacy common loader engine canonical [IEEE capture]");
        String legacy = read(args[0]), common = read(args[1]), loader = read(args[2]);
        SharedCommonRuntime first = new SharedCommonRuntime(args[3]);
        first.loader(common, loader, "strong");
        SharedCommonRuntime second = new SharedCommonRuntime(args[3]);
        second.loader(common, loader, "em");
        SharedCommonRuntime parser = new SharedCommonRuntime(args[3]);
        parser.encoding(legacy, common, args.length == 6 ? read(args[5]) : null);
        parser.imagesAndExtraction();
        // The parser scope has common functions; set deterministic callers.
        parser.eval("var first={get:function(){return 'en';},ajaxAll:function(){return [];},log:function(){}};var cc={get:function(){return null;},put:function(){}};");
        parser.readableAndFormulas();
        parser.serviceJson();
        parser.allLibraries(common,read(args[4]),args[3]);
        parser.nativeSourceOutputs();
        System.out.println("{\"status\":\"PASS\",\"checks\":" + (first.checks + second.checks + parser.checks)
            + ",\"engine\":\"actual-Rhino\",\"parser\":\"actual-Kotlin-RuleAnalyzer\",\"nativeFormatter\":true,\"nativeNetworkMethods\":true,\"compiledScripts\":"+parser.compiledScripts+",\"phoneNetworkVerified\":false}");
    }
}
