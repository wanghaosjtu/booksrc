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

/** Real engine/DOM/parser; importScript is stubbed, not a phone network test. */
public final class SharedCommonRuntime {
    private final Object context, scope;
    private final Method evaluate, put;
    private int checks;
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
        check(Boolean.TRUE.equals(eval("__ltCommonApi===null&&imports===0")), "no eager import at library initialization");
        check("zh:Hello".equals(String.valueOf(eval("TT('Hello',first,cc)"))), "TT bridge translates with first caller");
        check("fr:World".equals(String.valueOf(eval("TT('World',second,cc)"))), "API does not capture first caller");
        check(Boolean.TRUE.equals(eval("JSON.parse(TJ('{\"name\":\"Book\",\"href\":\"https://example.test/x\"}',second,cc)).href==='https://example.test/x'")), "TJ preserves URL");
        String html = String.valueOf(eval("TH('<p><strong>A</strong><em>B</em></p>',second,cc)"));
        String other = selector.equals("strong") ? "em" : "strong";
        Document dom = Jsoup.parseBodyFragment(html);
        check(dom.select(selector).size() == 0 && dom.select(other).size() == 1, "factory inherits only this source's inline selector");
        check(Boolean.TRUE.equals(eval("imports===1")), "repeated successful use imports once");
        check("2".equals(String.valueOf(eval("__ltCommonApi.version"))), "version is checked");
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
            + "var imageOptions={image_base_url:String(__imageBase),image_anchor_mode:'href',image_anchor_options:{webView:true}};");
        check(Boolean.TRUE.equals(eval("ltPrepareImages(imageDoc,null,imageOptions)===imageDoc")), "image-only helper preserves DOM identity and metadata");
        Document doc = Jsoup.parseBodyFragment(String.valueOf(eval("String(imageDoc.body().html())")));
        String[] urls = {
            "http://cdn.example.test/a.svg",
            "http://example.test/assets/root.svg?sig=a%2Fb&n=1+2",
            "http://example.test/journal/2026/figures/relative.svg",
            "http://example.test/journal/parent.svg",
            "http://example.test/journal/lazy.svg",
            "http://example.test/journal/2026/large.svg",
            "http://example.test/journal/picture.svg",
            "http://example.test/journal/anchor.svg,{\"webView\":true}",
            "https://signed.example.test/a.svg?sig=a%2Fb+1&expire=23",
            "data:image/png;base64,aGVsbG8="
        };
        check(doc.select("img").size() == 12, "all images keep their positions/count");
        for (int i=0;i<urls.length;i++) check(doc.select("img").get(i).attr("src").equals(urls[i]), "image URI case " + i);
        String paragraph = doc.select("p").first().html();
        check(paragraph.indexOf("BEFORE") < paragraph.indexOf("<img") && paragraph.indexOf("<img") < paragraph.indexOf("AFTER"), "image remains between its surrounding text");
        check(Boolean.TRUE.equals(eval("String(imageDoc.select('img').get(10).attr('src'))==='http://example.test/journal/2026/'+signedRelative")), "relative signed URL retains exact query and request-options suffix");
        check(Boolean.TRUE.equals(eval("String(imageDoc.select('img').get(10).attr('alt'))===String(__formula)")), "TeX/backslashes in alt remain literal");
        check(Boolean.TRUE.equals(eval("String(imageDoc.select('img').get(11).attr('src'))===codecogs")), "CodeCogs SVG alias and options are not rewritten");
        check(doc.select("img[data-src],img[srcset]").isEmpty(), "cleanup happens only after selecting real image URLs");
        bind("__extractHtml", "<usehtml><h1>Heading</h1><p>A<b>B</b><img src='../x.svg'>C</p></usehtml><inline-formula><tex-math>d\\mathrm{snr}</tex-math></inline-formula>");
        String extracted = String.valueOf(eval("ltExtract(String(__extractHtml),null,['usehtml','inline-formula tex-math'])"));
        Document ex = Jsoup.parseBodyFragment(extracted);
        check(ex.select("usehtml").isEmpty(), "usehtml extraction unwraps protection tag");
        check(ex.select("h1,b,img").size() == 3, "HTML extraction preserves structure and images");
        check(ex.select("tex-math").isEmpty() && ex.select("inline-formula").text().equals("d\\mathrm{snr}"), "ordinary TeX extraction stays text-only");
        bind("__repeatHtml", "<usehtml><h1>literal $& $1 d\\mathrm{snr}</h1><p>BEFORE<img src='../repeat.svg'>AFTER</p></usehtml><blockquote><h2>Nested heading</h2>Quote</blockquote>");
        String first = String.valueOf(eval("var firstHtml=ltUseHtmlBlocks(String(__repeatHtml),String(__imageBase));firstHtml"));
        String second = String.valueOf(eval("ltUseHtmlBlocks(firstHtml,String(__imageBase))"));
        Document one = Jsoup.parseBodyFragment(first), two = Jsoup.parseBodyFragment(second);
        check(one.select("usehtml img,usehtml usehtml").isEmpty() && two.select("usehtml img,usehtml usehtml").isEmpty(), "repeated HTML processing never nests protection tags or images");
        check(one.select("usehtml").size() == two.select("usehtml").size(), "repeat preserves block count");
        check(one.select("h1").text().equals("literal $& $1 d\\mathrm{snr}"), "replacement tokens and TeX text are literal");
        check(one.select("img").first().attr("src").equals("http://example.test/journal/repeat.svg"), "HTML helper resolves image against actual chapter URL");
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
                check(Boolean.TRUE.equals(one.eval("imports===0&&__ltCommonApi===null")), "source "+i+" initializes lazily in actual Rhino");
                String html=String.valueOf(one.eval("ltPrepareImages('<p><img src=\"../image.svg\"></p>',java,{image_base_url:'https://example.test/chapters/page.html'})"));
                check(Jsoup.parseBodyFragment(html).select("img").attr("src").equals("https://example.test/image.svg"), "source "+i+" can call common image API");
                check(Boolean.TRUE.equals(one.eval("imports===1&&__ltCommonApi.version==='2'")), "source "+i+" uses pinned compatible common");
                check(Boolean.TRUE.equals(one.eval("typeof java.importScript==='function'")), "source "+i+" keeps the app's injected java helper");
            } catch (RuntimeException | AssertionError error) {
                // Local public fixture only. Diagnose the factory separately,
                // without weakening the production loader's redaction.
                Throwable diagnostic=error;
                String details="";
                try {
                    details=String.valueOf(one.eval("var diagnosticApi=__ltBuildCommon(String(__commonText));"
                        + "JSON.stringify({imports:imports,importer:typeof java.importScript,version:diagnosticApi.version,"
                        + "api:[typeof diagnosticApi.TT,typeof diagnosticApi.TJ,typeof diagnosticApi.TC,typeof diagnosticApi.TH,"
                        + "typeof diagnosticApi.ltUseHtmlBlocks,typeof diagnosticApi.ltPrepareImages,typeof diagnosticApi.ltExtract]})"));
                }
                catch (RuntimeException factoryError) { diagnostic=factoryError; }
                throw new AssertionError("source "+i+" ("+id+") failed: "+diagnostic.getMessage()+" "+details,error);
            }
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
        parser.allLibraries(common,read(args[4]),args[3]);
        System.out.println("{\"status\":\"PASS\",\"checks\":" + (first.checks + second.checks + parser.checks)
            + ",\"engine\":\"actual-Rhino\",\"parser\":\"actual-Kotlin-RuleAnalyzer\",\"phoneNetworkVerified\":false}");
    }
}
