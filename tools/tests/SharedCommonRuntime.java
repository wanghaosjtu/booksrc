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
        check("1".equals(String.valueOf(eval("__ltCommonApi.version"))), "version is checked");
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
    public static void main(String[] args) throws Exception {
        if (args.length < 4 || args.length > 5) throw new IllegalArgumentException("legacy common loader engine [IEEE capture]");
        String legacy = read(args[0]), common = read(args[1]), loader = read(args[2]);
        SharedCommonRuntime first = new SharedCommonRuntime(args[3]);
        first.loader(common, loader, "strong");
        SharedCommonRuntime second = new SharedCommonRuntime(args[3]);
        second.loader(common, loader, "em");
        SharedCommonRuntime parser = new SharedCommonRuntime(args[3]);
        parser.encoding(legacy, common, args.length == 5 ? read(args[4]) : null);
        System.out.println("{\"status\":\"PASS\",\"checks\":" + (first.checks + second.checks + parser.checks)
            + ",\"engine\":\"actual-Rhino\",\"parser\":\"actual-Kotlin-RuleAnalyzer\",\"phoneNetworkVerified\":false}");
    }
}
