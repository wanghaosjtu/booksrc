import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/** Independent rule tests, not an APK or a substitute for Android UI tests. */
public final class UseHtmlValidation {
    private final Object context;
    private final Object scope;
    private final Method evaluate;
    private final Method putProperty;
    private int checks;

    private UseHtmlValidation(String engine, String runtime) throws Exception {
        Class<?> contextClass = Class.forName(engine + ".Context");
        context = contextClass.getMethod("enter").invoke(null);
        contextClass.getMethod("setOptimizationLevel", int.class).invoke(context, -1);
        scope = contextClass.getMethod("initStandardObjects").invoke(context);
        evaluate = scopeMethod(contextClass, "evaluateString",
            String.class, String.class, int.class, Object.class);
        putProperty = scopeMethod(Class.forName(engine + ".ScriptableObject"),
            "putProperty", String.class, Object.class);
        evaluate.invoke(context, scope, runtime, "legado-usehtml-validation.js", 1, null);
    }

    private Method scopeMethod(Class<?> owner, String name, Class<?>... rest) throws Exception {
        // Old Rhino uses Scriptable; current HtmlUnit uses VarScope.
        for (Method method : owner.getMethods()) {
            Class<?>[] parameters = method.getParameterTypes();
            if (!method.getName().equals(name) || parameters.length != rest.length + 1 ||
                    !parameters[0].isInstance(scope)) continue;
            boolean matches = true;
            for (int i = 0; i < rest.length; i++) matches &= parameters[i + 1].equals(rest[i]);
            if (matches) return method;
        }
        throw new NoSuchMethodException(owner.getName() + "." + name + " with compatible scope");
    }

    private String wrap(String html, String url) throws Exception {
        putProperty.invoke(null, scope, "__html", html);
        putProperty.invoke(null, scope, "__url", url);
        return String.valueOf(evaluate.invoke(context, scope,
            "useHtmlValidation(__html, __url)", "usehtml-test", 1, null));
    }

    private void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }

    private void run(String fixture) throws Exception {
        String base = "https://carnegieendowment.org/research/2026/11/article";
        String output = wrap(fixture, base);
        Document document = Jsoup.parse(output);
        check(output.startsWith("<usehtml>") && output.endsWith("</usehtml>"), "single outer wrapper");
        check(document.select("usehtml").size() == 1, "no nested wrappers");
        check(output.indexOf('\n') < 0 && output.indexOf('\r') < 0, "one cache line");
        check(!output.contains("<html") && !output.contains("<head") && !output.contains("<title"), "body fragment only");
        for (int i = 1; i <= 6; i++) check(document.select("h" + i).size() == 1, "preserves h" + i);
        check(document.select("strong").size() == 1 && document.select("em").size() == 1,
            "preserves emphasis markup; this does not prove native drawing support");
        check(document.select("ul > li").size() == 3 && document.select("ol > li").size() == 2, "list hierarchy");
        check(document.select("blockquote > p").size() == 1, "quote hierarchy");
        check(document.select("pre").first().wholeText().contains("PRE 第一行\nPRE 第二行"), "text-node newlines");
        check(document.text().contains("A & B，<h1> 是文字"), "entities decode once");
        check(document.text().contains("😀"), "Unicode round trip");
        check(document.select("img").first().attr("src").equals(
            "https://carnegieendowment.org/research/2026/figures/usehtml.png"), "relative image");
        check(document.select("a").get(1).attr("href").equals(
            "https://carnegieendowment.org/research/2026/research"), "relative link");
        check(document.select("a").get(2).attr("href").equals("#usehtml-first"), "local anchor");
        check(wrap(output, base).equals(output), "idempotent wrapping");
        check(wrap(null, base).isEmpty() && wrap("  \n", base).isEmpty(), "empty input");
        check(wrap("<script>bad()</script><style>bad{}</style>", base).isEmpty(), "unsafe-only input is not a successful chapter");
        check(Jsoup.parse(wrap("First\n\nSecond &amp; third", base)).select("p").size() == 2, "plain-text paragraph fallback");

        String urls = "<base href='https://wrong.example/'><p>URL checks</p>" +
            "<img src='/root.jpg'><img src='//cdn.example/p.png'>" +
            "<img src='../figure.png,{\"width\":\"50%\",\"style\":\"text\"}'>" +
            "<img src='https://cdn.example/encoded%2F.png?a=1&amp;b=2'>" +
            "<a href='mailto:reader@example.org'>Mail</a>";
        Document resolved = Jsoup.parse(wrap(urls, base + ",{\"webView\":true}"));
        check(resolved.select("img").get(0).attr("src").equals("https://carnegieendowment.org/root.jpg"), "untrusted base ignored");
        check(resolved.select("img").get(1).attr("src").equals("https://cdn.example/p.png"), "protocol-relative image");
        check(resolved.select("img").get(2).attr("src").equals(
            "https://carnegieendowment.org/research/2026/figure.png,{\"width\":\"50%\",\"style\":\"text\"}"), "Legado image options preserved");
        check(resolved.select("img").get(3).attr("src").equals(
            "https://cdn.example/encoded%2F.png?a=1&b=2"), "encoded paths and query entities");
        check(resolved.select("a").first().attr("href").equals("mailto:reader@example.org"), "mail link preserved");

        String unsafe = "<p onclick='bad()' style='background:url(https://wrong.example/a)'>Safe</p>" +
            "<script>bad()</script><iframe srcdoc='bad'></iframe>" +
            "<img src='javascript:bad()' onerror='bad()' srcset='https://wrong.example/a 1x'>" +
            "<a href='javascript:bad()'>Link</a>";
        Document cleaned = Jsoup.parse(wrap(unsafe, base));
        check(cleaned.select("script,iframe,[onclick],[onerror],[srcdoc],[srcset],[style]").isEmpty(), "active markup removed");
        check(!cleaned.select("img").first().hasAttr("src") && !cleaned.select("a").first().hasAttr("href"), "unsafe URI schemes removed");
        check(Jsoup.parse(wrap("<p>X</p><img src='data:image/png;base64,AA=='>", base)).select("img").first()
            .attr("src").equals("data:image/png;base64,AA=="), "inline image kept");

        // Exercise the exact appended rule block, including Legado's result/baseUrl bindings.
        putProperty.invoke(null, scope, "result", fixture);
        putProperty.invoke(null, scope, "baseUrl", base);
        String bound = String.valueOf(evaluate.invoke(context, scope,
            "result = useHtmlValidation(result, baseUrl); result;", "content-rule-tail", 1, null));
        check(bound.equals(output), "appended rule uses the preceding result");
        System.out.println("{\"status\":\"PASS\",\"checks\":" + checks +
            ",\"kind\":\"offline-rule\",\"jsoup\":\"" + Jsoup.class.getPackage().getImplementationVersion() + "\"}");
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 2 && args[0].equals("inspect")) {
            Document doc = Jsoup.parse(new String(Files.readAllBytes(Paths.get(args[1])), StandardCharsets.UTF_8),
                "https://carnegieendowment.org/research");
            System.out.println("title=" + doc.title());
            System.out.println("textLength=" + doc.body().text().length());
            int links = 0;
            for (Element a : doc.select("a[href]")) {
                String url = a.absUrl("href");
                if (url.matches("https://carnegieendowment\\.org/(?:[a-z]{2}/)?(?:research|posts)/.*") && links++ < 12)
                    System.out.println(url);
            }
            for (Element image : doc.select("img[src]")) {
                String url = image.absUrl("src");
                if (url.startsWith("https://")) { System.out.println("image=" + url); break; }
            }
            return;
        }
        if (args.length != 3) throw new IllegalArgumentException("runtime fixture engine-package");
        String runtime = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        String fixture = new String(Files.readAllBytes(Paths.get(args[1])), StandardCharsets.UTF_8);
        new UseHtmlValidation(args[2], runtime).run(fixture);
    }
}
